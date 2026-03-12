// ─── Evidence Types (mirroring shared/ for plugin-side use) ─────

export interface ConfigEvidence {
  type: "config";
  apiKey?: { value?: string; masked: string; provider?: string };
  endpoint?: { url?: string; reachable?: boolean };
  errorLogs?: string[];
  rawConfig?: Record<string, unknown>;
}

export interface LogEvidence {
  type: "log";
  entries: string[];
  errorPatterns?: string[];
}

export interface BehaviorEvidence {
  type: "behavior";
  description: string;
  symptoms?: string[];
}

export type Evidence = ConfigEvidence | LogEvidence | BehaviorEvidence;

// ─── Treatment Types ────────────────────────────────────────────

export interface TreatmentStep {
  id: string;
  action: "prompt_user" | "validate_config" | "update_config" | "test_connection" | "report";
  description: string;
  requiresUserInput: boolean;
  inputPrompt?: string;
}

export interface DiagnosisResponse {
  sessionId: string;
  diagnosis: {
    icd_ai_code: string;
    name: string;
    confidence: number;
    severity: string;
    reasoning: string;
  } | null;
  differential: Array<{
    icd_ai_code: string;
    name: string;
    confidence: number;
  }>;
  treatmentPlan: TreatmentStep[];
  summary: string;
}

export interface TreatmentResponse {
  status: "next" | "resolved" | "failed";
  nextStep?: TreatmentStep;
  message: string;
  sessionId: string;
}

// ─── Plugin API Types (minimal OpenClaw plugin API surface) ─────

export interface PluginApi {
  registerCommand(config: {
    name: string;
    description: string;
    handler: (ctx: CommandContext) => Promise<{ text: string }> | { text: string };
  }): void;
  registerTool(config: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
  }): void;
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => Record<string, string | undefined>,
    options?: { priority?: number },
  ): void;
  logger: {
    info(msg: string): void;
    error(msg: string): void;
    warn(msg: string): void;
    debug(msg: string): void;
  };
  config: Record<string, unknown>;
}

export interface CommandContext {
  senderId: string;
  channel: string;
  args: string[];
  commandBody: string;
  config: Record<string, unknown>;
}
