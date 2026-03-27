import type { PluginApi } from "./types.js";
import { ClawClinicClient } from "./client.js";
import { registerClinicCommand } from "./commands/clinic.js";
import { registerClinicChatCommand } from "./commands/chat-clinic.js";
import { registerDiagnoseTool } from "./tools/diagnose.js";

export default function register(api: PluginApi): void {
  const pluginConfig = (api.config?.plugins as Record<string, unknown>)?.entries as Record<string, unknown> | undefined;
  const clawConfig = (pluginConfig?.["claw-clinic"] as Record<string, unknown>)?.config as Record<string, unknown> | undefined;
  const backendUrl = (clawConfig?.backendUrl as string) || "http://localhost:8080";

  const client = new ClawClinicClient(backendUrl);

  api.logger.info(`Claw Clinic plugin loaded — backend: ${backendUrl}`);

  registerClinicChatCommand(api, client);
  registerClinicCommand(api, client);
  registerDiagnoseTool(api, client);

  api.on("before_prompt_build", () => {
    return {
      appendSystemContext: [
        "You have access to Claw Clinic diagnostic tools.",
        "If you encounter errors or configuration issues, use clinic_diagnose",
        "which will investigate step by step, running commands on your machine,",
        "and propose fixes for your approval.",
        "Users can also type /clinic in chat to trigger diagnosis directly.",
      ].join(" "),
    };
  }, { priority: 50 });
}
