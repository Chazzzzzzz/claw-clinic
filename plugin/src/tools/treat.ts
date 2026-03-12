import type { PluginApi } from "../types.js";
import { ClawClinicClient } from "../client.js";
import { ClinicNotifier } from "../notifier.js";
import { runTreatmentLoop } from "../treatment-loop.js";

export function registerTreatTool(api: PluginApi, client: ClawClinicClient): void {
  api.registerTool({
    name: "clinic_treat",
    description:
      "Execute a treatment step (usually one requiring user input) and automatically continue remaining steps. " +
      "Use this after clinic_diagnose pauses for input.",
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
        channelId: {
          type: "string",
          description: "Chat channel ID for progress updates",
        },
      },
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      const channelId = (params.channelId as string) || _id;
      const notifier = new ClinicNotifier(api, channelId
        ? { mode: "chat", channelId }
        : { mode: "tool" });

      try {
        const sessionId = params.sessionId as string;
        const stepId = params.stepId as string;

        await notifier.status(`Executing step "${stepId}" with user input...`);

        // Execute the step with user input
        const response = await client.treat(sessionId, stepId, {
          success: true,
          data: params.userInput ? { userInput: params.userInput } : undefined,
        });

        const parts: string[] = [];
        parts.push(`STATUS: ${response.status.toUpperCase()}`);
        parts.push(`MESSAGE: ${response.message}`);

        if (response.status === "resolved") {
          await notifier.success("Issue resolved!");
          parts.push("");
          parts.push("The issue has been resolved. The agent should now function normally.");
        } else if (response.status === "failed") {
          await notifier.error(response.message);
          parts.push("");
          parts.push("Treatment failed. Consider re-running clinic_diagnose for a fresh assessment.");
        } else if (response.status === "next" && response.nextStep) {
          // There are remaining steps — auto-continue the treatment loop
          await notifier.status("Continuing with remaining treatment steps...");

          const remaining = [response.nextStep];
          // We don't know the full remaining plan, but the loop will
          // keep calling treat until resolved/failed/paused
          const loopResult = await runTreatmentLoop({
            client,
            sessionId,
            treatmentPlan: remaining,
            notifier,
            config: api.config,
          });

          parts.push("");
          parts.push(`CONTINUATION: ${loopResult.status.toUpperCase()}`);
          parts.push(loopResult.message);

          if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
            parts.push("");
            parts.push(`AWAITING INPUT for step "${loopResult.pendingStep.id}": ${loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description}`);
          }
        }

        return { content: [{ type: "text", text: parts.join("\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await notifier.error(message);
        return { content: [{ type: "text", text: `Treatment error: ${message}` }] };
      }
    },
  });
}
