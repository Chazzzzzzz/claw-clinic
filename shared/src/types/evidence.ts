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
