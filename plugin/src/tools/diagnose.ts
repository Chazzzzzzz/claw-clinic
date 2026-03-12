import type { PluginApi, Evidence } from "../types.js";
import { ClawClinicClient } from "../client.js";
import { collectConfigEvidence } from "../evidence.js";

export function registerDiagnoseTool(api: PluginApi, client: ClawClinicClient): void {
  api.registerTool({
    name: "clinic_diagnose",
    description:
      "Diagnose agent health issues. Collects config evidence automatically and combines with provided symptoms/logs. Returns a diagnosis and treatment plan.",
    parameters: {
      type: "object",
      properties: {
        symptoms: {
          type: "string",
          description: "Description of the issue (e.g., 'agent cannot connect to AI provider')",
        },
        logs: {
          type: "string",
          description: "Relevant error logs or output",
        },
        configDump: {
          type: "object",
          description: "Raw configuration object to inspect",
        },
      },
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      try {
        const evidence: Evidence[] = [];

        // Auto-collect config evidence from plugin context
        const configEvidence = collectConfigEvidence(api.config);
        evidence.push(configEvidence);

        // Add user-provided logs as log evidence
        if (typeof params.logs === "string" && params.logs.trim()) {
          evidence.push({
            type: "log",
            entries: params.logs.split("\n").filter((l: string) => l.trim()),
          });
        }

        // Add user-provided config dump
        if (params.configDump && typeof params.configDump === "object") {
          const dumpEvidence = collectConfigEvidence(params.configDump as Record<string, unknown>);
          if (dumpEvidence.apiKey || dumpEvidence.endpoint) {
            evidence.push(dumpEvidence);
          }
        }

        // Add behavior evidence if symptoms provided
        if (typeof params.symptoms === "string" && params.symptoms.trim()) {
          evidence.push({
            type: "behavior",
            description: params.symptoms,
          });
        }

        const diagnosis = await client.diagnose(
          evidence,
          typeof params.symptoms === "string" ? params.symptoms : undefined,
        );

        // Format response for the agent
        const parts: string[] = [];
        parts.push(`SESSION: ${diagnosis.sessionId}`);
        parts.push("");

        if (diagnosis.diagnosis) {
          const d = diagnosis.diagnosis;
          parts.push(`DIAGNOSIS: ${d.name} (${d.icd_ai_code})`);
          parts.push(`SEVERITY: ${d.severity}`);
          parts.push(`CONFIDENCE: ${(d.confidence * 100).toFixed(0)}%`);
          parts.push(`REASONING: ${d.reasoning}`);
        } else {
          parts.push("DIAGNOSIS: No issues detected.");
        }

        if (diagnosis.treatmentPlan.length > 0) {
          parts.push("");
          parts.push("TREATMENT PLAN:");
          for (const step of diagnosis.treatmentPlan) {
            parts.push(`  STEP ${step.id}: [${step.action}] ${step.description}`);
            if (step.requiresUserInput && step.inputPrompt) {
              parts.push(`    → REQUIRES USER INPUT: ${step.inputPrompt}`);
            }
          }
          parts.push("");
          parts.push(
            "To execute treatment, call clinic_treat for each step in order. " +
            "For steps requiring user input, ask the user first, then pass their response.",
          );
        }

        return { content: [{ type: "text", text: parts.join("\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Diagnosis error: ${message}` }] };
      }
    },
  });
}
