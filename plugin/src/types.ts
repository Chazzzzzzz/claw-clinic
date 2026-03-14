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

export interface ConnectivityEvidence {
  type: "connectivity";
  providers: Array<{
    name: string;
    endpoint: string;
    reachable: boolean;
    latencyMs?: number;
    statusCode?: number;
    error?: string;
    authStatus?: "ok" | "failed" | "rate_limited" | "server_error" | "untested";
    authError?: string;
    authStatusCode?: number;
  }>;
  gatewayReachable?: boolean;
  gatewayLatencyMs?: number;
}

export interface EnvironmentEvidence {
  type: "environment";
  os?: string;
  nodeVersion?: string;
  openclawVersion?: string;
  memoryUsageMb?: number;
  uptimeSeconds?: number;
  plugins?: Array<{ id: string; enabled: boolean }>;
}

export interface RuntimeEvidence {
  type: "runtime";
  modelName?: string;
  modelProvider?: string;
  contextWindowSize?: number;
  recentTraceStats?: {
    totalSteps: number;
    errorCount: number;
    avgLatencyMs: number;
    totalTokens: number;
    totalCostUsd: number;
    toolCallCount: number;
    toolSuccessCount: number;
    loopDetected: boolean;
  };
  activeSessions?: number;
  queueDepth?: number;
}

export type Evidence =
  | ConfigEvidence
  | LogEvidence
  | BehaviorEvidence
  | ConnectivityEvidence
  | EnvironmentEvidence
  | RuntimeEvidence;

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

// ─── Verification Types ─────────────────────────────────────────

export interface VerificationStep {
  id: string;
  type: "check_file" | "check_connectivity" | "check_config" | "check_process" | "check_logs" | "custom";
  description: string;
  instruction: string;
  params: Record<string, unknown>;
  successCondition: string;
}

export interface VerificationPlanResponse {
  diseaseCode: string;
  diseaseName: string;
  steps: VerificationStep[];
}

// ─── Plugin API Types (minimal OpenClaw plugin API surface) ─────

export interface CliRegistrationContext {
  program: {
    command(name: string): CliCommand;
  };
}

export interface CliCommand {
  command(name: string): CliCommand;
  description(desc: string): CliCommand;
  argument(name: string, desc: string): CliCommand;
  option(flags: string, desc: string): CliCommand;
  action(fn: (...args: unknown[]) => void | Promise<void>): CliCommand;
}

export interface CommandContext {
  args: string;
  /** Channel/conversation ID — available when invoked from a chat channel. */
  channelId?: string;
}

export interface PluginApi {
  registerCommand(config: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler: (ctx: CommandContext) => Promise<{ text: string }> | { text: string };
  }): void;
  registerCli(
    fn: (ctx: CliRegistrationContext) => void,
    opts?: { commands?: string[] },
  ): void;
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
  sendChatMessage?(channelId: string, text: string): Promise<void>;
  logger: {
    info(msg: string): void;
    error(msg: string): void;
    warn(msg: string): void;
    debug(msg: string): void;
  };
  config: Record<string, unknown>;
}
