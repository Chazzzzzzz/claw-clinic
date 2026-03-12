import type { PluginApi } from "./types.js";
import { ClawClinicClient } from "./client.js";
import { registerClinicCommand } from "./commands/clinic.js";
import { registerDiagnoseTool } from "./tools/diagnose.js";
import { registerTreatTool } from "./tools/treat.js";

export default function register(api: PluginApi): void {
  // Read backend URL from plugin config
  const pluginConfig = (api.config?.plugins as Record<string, unknown>)?.entries as Record<string, unknown> | undefined;
  const clawConfig = (pluginConfig?.["claw-clinic"] as Record<string, unknown>)?.config as Record<string, unknown> | undefined;
  const backendUrl = (clawConfig?.backendUrl as string) || "http://localhost:8080";

  const client = new ClawClinicClient(backendUrl);

  api.logger.info(`Claw Clinic plugin loaded — backend: ${backendUrl}`);

  // Register user-triggered command
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
        "or configuration issues, use the clinic_diagnose tool to get a diagnosis",
        "and clinic_treat to execute the treatment plan step by step.",
      ].join(" "),
    };
  }, { priority: 50 });
}
