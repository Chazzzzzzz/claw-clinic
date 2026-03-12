import type { PluginApi } from "../types.js";
import { ClawClinicClient } from "../client.js";
import { collectAllEvidence } from "../evidence.js";
import { validateLocally } from "../validation.js";
import { runTreatmentLoop } from "../treatment-loop.js";
import { ClinicNotifier } from "../notifier.js";

/**
 * Register /clinic as a chat command via registerCommand.
 * This bypasses the LLM entirely — works even when AI model is down.
 */
export function registerClinicChatCommand(api: PluginApi, client: ClawClinicClient): void {
  api.registerCommand({
    name: "clinic",
    description: "Run a health check — diagnose and treat agent issues (no AI model needed)",
    acceptsArgs: true,
    handler: async (ctx) => {
      const symptoms = ctx.args?.trim() || undefined;
      const lines: string[] = [];

      try {
        // Step 1: Local validation
        lines.push("Running local validation...");
        const localResult = await validateLocally(api.config);

        if (localResult.quickIssues.length > 0) {
          lines.push(`Found ${localResult.quickIssues.length} issue(s):`);
          for (const issue of localResult.quickIssues) {
            lines.push(`  - ${issue}`);
          }
        } else {
          lines.push("Local validation passed.");
        }

        // Step 2: Collect evidence
        lines.push("\nCollecting evidence...");
        const evidence = await collectAllEvidence(api.config);

        if (symptoms) {
          evidence.push({ type: "behavior", description: symptoms });
        }
        if (localResult.quickIssues.length > 0) {
          evidence.push({ type: "behavior", description: "Local validation issues", symptoms: localResult.quickIssues });
        }

        lines.push(`Collected: ${evidence.map((e) => e.type).join(", ")}`);

        // Step 3: Backend diagnosis
        lines.push("\nSending to backend for diagnosis...");
        let diagnosis;
        try {
          diagnosis = await client.diagnose(evidence, symptoms);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lines.push(`Backend error: ${msg}`);

          // Still report local findings if backend is down
          if (localResult.quickIssues.length > 0) {
            lines.push("\nLocal findings (backend unavailable):");
            for (const issue of localResult.quickIssues) {
              lines.push(`  - ${issue}`);
            }
          }
          return { text: lines.join("\n") };
        }

        if (diagnosis.diagnosis) {
          const d = diagnosis.diagnosis;
          lines.push(`\n**Diagnosis: ${d.name}** (${d.icd_ai_code})`);
          lines.push(`Severity: ${d.severity} | Confidence: ${(d.confidence * 100).toFixed(0)}%`);
          lines.push(`\n${d.reasoning}`);
        } else {
          lines.push("\n**No issues detected.** Your agent appears healthy.");
          return { text: lines.join("\n") };
        }

        // Step 4: Auto-execute treatment
        if (diagnosis.treatmentPlan.length > 0) {
          lines.push(`\nStarting treatment (${diagnosis.treatmentPlan.length} steps)...`);

          const notifier = new ClinicNotifier(api, { mode: "tool" });

          const loopResult = await runTreatmentLoop({
            client,
            sessionId: diagnosis.sessionId,
            treatmentPlan: diagnosis.treatmentPlan,
            notifier,
            config: api.config,
          });

          // Append notifier buffer
          for (const msg of notifier.getBuffer()) {
            lines.push(msg);
          }

          lines.push(`\n**Result:** ${loopResult.status} (${loopResult.stepsCompleted}/${loopResult.stepsTotal} steps)`);
          lines.push(loopResult.message);

          if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
            lines.push(`\nStep "${loopResult.pendingStep.id}" needs your input:`);
            lines.push(loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description);
            lines.push(`\nProvide input with: /clinic_treat ${diagnosis.sessionId} ${loopResult.pendingStep.id} <your input>`);
          }
        }

        return { text: lines.join("\n") };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { text: `Clinic error: ${message}` };
      }
    },
  });
}
