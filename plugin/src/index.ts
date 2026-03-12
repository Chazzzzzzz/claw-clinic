import type { PluginApi } from "./types.js";
import { ClawClinicClient } from "./client.js";
import { registerClinicCommand } from "./commands/clinic.js";
import { registerClinicChatCommand } from "./commands/chat-clinic.js";
import { registerDiagnoseTool } from "./tools/diagnose.js";
import { registerTreatTool } from "./tools/treat.js";

export default function register(api: PluginApi): void {
  // Read backend URL from plugin config
  const pluginConfig = (api.config?.plugins as Record<string, unknown>)?.entries as Record<string, unknown> | undefined;
  const clawConfig = (pluginConfig?.["claw-clinic"] as Record<string, unknown>)?.config as Record<string, unknown> | undefined;
  const backendUrl = (clawConfig?.backendUrl as string) || "http://localhost:8080";

  const client = new ClawClinicClient(backendUrl);

  api.logger.info(`Claw Clinic plugin loaded — backend: ${backendUrl}`);

  // Register /clinic chat command (bypasses LLM, runs directly)
  registerClinicChatCommand(api, client);

  // Register CLI commands (openclaw claw-clinic diagnose/treat/health)
  registerClinicCommand(api, client);

  // Register agent-triggered tools
  registerDiagnoseTool(api, client);
  registerTreatTool(api, client);

  // Inject clinic awareness into agent system prompt
  api.on("before_prompt_build", () => {
    return {
      appendSystemContext: [
        "You have access to Claw Clinic diagnostic tools.",
        "If you encounter errors connecting to AI providers, authentication failures,",
        "or configuration issues, use clinic_diagnose which will automatically",
        "validate locally, collect evidence, diagnose the issue, and execute treatment steps.",
        "It will pause and return instructions if user input is needed.",
        "Use clinic_treat only to resume after providing user input for a paused step.",
        "Users can also type /clinic in chat to trigger diagnosis directly.",
      ].join(" "),
    };
  }, { priority: 50 });
}
