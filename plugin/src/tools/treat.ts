import type { PluginApi } from "../types.js";
import { ClawClinicClient } from "../client.js";

export function registerTreatTool(api: PluginApi, client: ClawClinicClient): void {
  api.registerTool({
    name: "clinic_treat",
    description:
      "Execute a treatment step from a diagnosis plan. Call this for each step in the treatment plan returned by clinic_diagnose. " +
      "For steps requiring user input, collect the input first, then pass it in userInput.",
    parameters: {
      type: "object",
      required: ["sessionId", "stepId"],
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID from the diagnosis response",
        },
        stepId: {
          type: "string",
          description: "Step ID to execute",
        },
        userInput: {
          type: "string",
          description: "User-provided input for this step (e.g., a new API key)",
        },
        success: {
          type: "boolean",
          description: "Whether the step was completed successfully (default: true)",
        },
      },
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      try {
        const sessionId = params.sessionId as string;
        const stepId = params.stepId as string;
        const success = params.success !== false;

        const stepResult = {
          success,
          data: params.userInput ? { userInput: params.userInput } : undefined,
          error: success ? undefined : "Step failed",
        };

        const response = await client.treat(sessionId, stepId, stepResult);

        const parts: string[] = [];
        parts.push(`STATUS: ${response.status.toUpperCase()}`);
        parts.push(`MESSAGE: ${response.message}`);

        if (response.status === "next" && response.nextStep) {
          const next = response.nextStep;
          parts.push("");
          parts.push(`NEXT STEP ${next.id}: [${next.action}] ${next.description}`);
          if (next.requiresUserInput && next.inputPrompt) {
            parts.push(`  → REQUIRES USER INPUT: ${next.inputPrompt}`);
          }
        } else if (response.status === "resolved") {
          parts.push("");
          parts.push("The issue has been resolved. The agent should now function normally.");
        } else if (response.status === "failed") {
          parts.push("");
          parts.push("Treatment failed. Consider re-running clinic_diagnose for a fresh assessment.");
        }

        return { content: [{ type: "text", text: parts.join("\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Treatment error: ${message}` }] };
      }
    },
  });
}
