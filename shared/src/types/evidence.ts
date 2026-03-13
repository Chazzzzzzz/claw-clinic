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
    /** Result of actual API auth test (not just HEAD ping). */
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
