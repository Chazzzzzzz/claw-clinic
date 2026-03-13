import type { PluginApi, ConnectivityEvidence } from "../types.js";
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

        // Step 2.5: Check connectivity evidence locally for auth failures
        const connEvidence = evidence.find((e): e is ConnectivityEvidence => e.type === "connectivity");
        if (connEvidence) {
          const authFailed = connEvidence.providers.filter((p) => p.authStatus === "failed");
          const serverErrors = connEvidence.providers.filter((p) => p.authStatus === "server_error");
          const rateLimited = connEvidence.providers.filter((p) => p.authStatus === "rate_limited");

          if (authFailed.length > 0) {
            lines.push("\n**Auth Failure Detected Locally**");
            for (const p of authFailed) {
              lines.push(`  - ${p.name}: authentication rejected (HTTP ${p.authStatusCode})`);
              if (p.authError) {
                // Extract just the message from JSON error if possible
                try {
                  const parsed = JSON.parse(p.authError);
                  const msg = parsed?.error?.message || parsed?.error?.type || p.authError;
                  lines.push(`    ${msg}`);
                } catch {
                  lines.push(`    ${p.authError.slice(0, 200)}`);
                }
              }
            }
          }

          if (serverErrors.length > 0) {
            lines.push("\n**Provider Service Errors**");
            for (const p of serverErrors) {
              lines.push(`  - ${p.name}: server error — ${p.authError || "service unavailable"}`);
            }
          }

          if (rateLimited.length > 0) {
            lines.push("\n**Rate Limited**");
            for (const p of rateLimited) {
              lines.push(`  - ${p.name}: rate limited (HTTP 429)`);
            }
          }
        }

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
