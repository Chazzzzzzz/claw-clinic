import type { PluginApi, Evidence } from "../types.js";
import { ClawClinicClient } from "../client.js";
import { collectAllEvidence } from "../evidence.js";
import { validateLocally } from "../validation.js";
import { ClinicNotifier } from "../notifier.js";
import { runTreatmentLoop } from "../treatment-loop.js";

export function registerDiagnoseTool(api: PluginApi, client: ClawClinicClient): void {
  api.registerTool({
    name: "clinic_diagnose",
    description:
      "Full diagnostic workflow: validates locally, collects evidence (config, logs, connectivity, environment, runtime), " +
      "sends to backend for AI diagnosis, then auto-executes treatment steps. Pauses if user input is needed.",
    parameters: {
      type: "object",
      properties: {
        symptoms: {
          type: "string",
          description: "Description of the issue (e.g., 'agent cannot connect to AI provider')",
        },
        channelId: {
          type: "string",
          description: "Chat channel ID to send progress updates to",
        },
      },
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      // Handle command-dispatch: tool format ({ command, commandName, skillName })
      // as well as normal tool call format ({ symptoms, channelId })
      const rawCommand = params.command as string | undefined;
      const symptoms = rawCommand?.trim() || (params.symptoms as string | undefined);
      const channelId = (params.channelId as string) || _id;
      const notifier = new ClinicNotifier(api, channelId
        ? { mode: "chat", channelId }
        : { mode: "tool" });

      try {
        // ── Step 1: Local quick validation ───────────────────
        await notifier.status("Running local validation...");
        const localResult = await validateLocally(api.config);

        if (localResult.quickIssues.length > 0) {
          await notifier.status(`Local check found ${localResult.quickIssues.length} issue(s): ${localResult.quickIssues.join("; ")}`);
        } else {
          await notifier.status("Local validation passed — no obvious issues.");
        }

        // ── Step 2: Collect all evidence ─────────────────────
        await notifier.status("Collecting evidence (config, logs, connectivity, environment, runtime)...");
        const evidence: Evidence[] = await collectAllEvidence(api.config);

        // Add behavior evidence if symptoms provided
        if (symptoms) {
          evidence.push({ type: "behavior", description: symptoms });
        }

        // Include local validation issues as additional behavior evidence
        if (localResult.quickIssues.length > 0) {
          evidence.push({
            type: "behavior",
            description: "Local validation issues detected",
            symptoms: localResult.quickIssues,
          });
        }

        await notifier.status(`Collected ${evidence.length} evidence items: ${evidence.map((e) => e.type).join(", ")}`);

        // ── Step 3: Send to backend for diagnosis ────────────
        await notifier.status("Sending to backend for AI diagnosis...");
        const diagnosis = await client.diagnose(
          evidence,
          symptoms,
        );

        // Build diagnosis summary
        const parts: string[] = [];
        parts.push(`SESSION: ${diagnosis.sessionId}`);
        parts.push("");

        if (diagnosis.diagnosis) {
          const d = diagnosis.diagnosis;
          parts.push(`DIAGNOSIS: ${d.name} (${d.icd_ai_code})`);
          parts.push(`SEVERITY: ${d.severity}`);
          parts.push(`CONFIDENCE: ${(d.confidence * 100).toFixed(0)}%`);
          parts.push(`REASONING: ${d.reasoning}`);

          await notifier.status(`Diagnosis: ${d.name} (${d.severity}, ${(d.confidence * 100).toFixed(0)}% confidence)`);
        } else {
          parts.push("DIAGNOSIS: No issues detected.");
          await notifier.success("No issues detected. Your agent appears healthy.");
          return { content: [{ type: "text", text: parts.join("\n") }] };
        }

        // ── Step 4: Auto-execute treatment loop ──────────────
        if (diagnosis.treatmentPlan.length > 0) {
          await notifier.status(`Starting treatment (${diagnosis.treatmentPlan.length} steps)...`);

          const loopResult = await runTreatmentLoop({
            client,
            sessionId: diagnosis.sessionId,
            treatmentPlan: diagnosis.treatmentPlan,
            notifier,
            config: api.config,
          });

          parts.push("");
          parts.push(`TREATMENT: ${loopResult.status.toUpperCase()}`);
          parts.push(`Steps completed: ${loopResult.stepsCompleted}/${loopResult.stepsTotal}`);
          parts.push(loopResult.message);

          if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
            parts.push("");
            parts.push(`AWAITING INPUT for step "${loopResult.pendingStep.id}": ${loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description}`);
            parts.push(`To continue, call clinic_treat with sessionId="${diagnosis.sessionId}" and stepId="${loopResult.pendingStep.id}" and the user's input.`);
          }
        }

        // Include notifier buffer for full audit trail
        const progressLog = notifier.getBuffer();
        if (progressLog.length > 0) {
          parts.push("");
          parts.push("PROGRESS LOG:");
          parts.push(...progressLog);
        }

        return { content: [{ type: "text", text: parts.join("\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await notifier.error(message);
        return { content: [{ type: "text", text: `Diagnosis error: ${message}` }] };
      }
    },
  });
}
