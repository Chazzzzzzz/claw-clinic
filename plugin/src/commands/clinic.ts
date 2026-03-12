import type { PluginApi, CommandContext } from "../types.js";
import { ClawClinicClient } from "../client.js";
import { collectConfigEvidence } from "../evidence.js";

export function registerClinicCommand(api: PluginApi, client: ClawClinicClient): void {
  api.registerCommand({
    name: "clinic",
    description: "Run a health check on your agent's configuration and connectivity",
    handler: async (ctx: CommandContext) => {
      try {
        // 1. Collect config evidence
        const configEvidence = collectConfigEvidence(ctx.config);

        // 2. Add any user-provided symptoms from command body
        const symptoms = ctx.commandBody?.trim() || undefined;

        // 3. Send to backend for diagnosis
        const diagnosis = await client.diagnose(
          [configEvidence],
          symptoms,
        );

        // 4. Format response
        const lines: string[] = [];

        if (diagnosis.diagnosis) {
          const d = diagnosis.diagnosis;
          lines.push(`**Diagnosis: ${d.name}** (${d.icd_ai_code})`);
          lines.push(`Severity: ${d.severity} | Confidence: ${(d.confidence * 100).toFixed(0)}%`);
          lines.push("");
          lines.push(d.reasoning);
        } else {
          lines.push("**No issues detected.** Your agent appears healthy.");
        }

        if (diagnosis.treatmentPlan.length > 0) {
          lines.push("");
          lines.push("**Treatment Plan:**");
          for (const step of diagnosis.treatmentPlan) {
            lines.push(`- ${step.description}`);
          }
          lines.push("");
          lines.push("Use the agent to execute treatment: ask it to run `clinic_treat`.");
        }

        return { text: lines.join("\n") };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { text: `Clinic error: ${message}` };
      }
    },
  });
}
