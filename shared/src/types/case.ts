export interface TraceRecord {
  step_number: number;
  timestamp?: string;
  type: "reasoning" | "tool_call" | "tool_result" | "error" | "user_input";
  content: {
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    tool_result?: unknown;
    reasoning?: string;
    error?: {
      code: string;
      message: string;
    };
    user_input?: string;
  };
  metrics: {
    tokens_used: number;
    latency_ms: number;
    cost_usd: number;
  };
}

export interface VitalSigns {
  token_burn_rate: number;
  tool_success_rate: number;
  loop_diversity_score: number;
  latency_p95_ms: number;
  context_utilization: number;
  error_rate: number;
}

export interface SymptomVector {
  step_count: number;
  loop_count: number;
  unique_tools: number;
  error_rate: number;
  token_velocity: number;
  tool_success_rate: number;
  latency_p95_ms: number;
  cost_total_usd: number;
  context_utilization: number;
  output_diversity_score: number;
}

export type TriageLevel = "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";

export interface CaseRecord {
  id: string;
  patient: {
    user_id: string;
    api_key_id: string;
    framework: string;
    framework_version?: string;
    llm_provider?: string;
    llm_model?: string;
  };
  intake: {
    timestamp: string;
    source: "mcp" | "api" | "web" | "skill";
    chief_complaint?: string;
    trace_summary: {
      step_count: number;
      total_tokens: number;
      total_cost_usd: number;
      duration_ms: number;
    };
  };
  triage: {
    level: TriageLevel;
    triaged_at: string;
  };
  diagnosis?: {
    primary?: {
      icd_ai_code: string;
      disease_name: string;
      confidence: number;
    };
    differential: Array<{
      icd_ai_code: string;
      disease_name: string;
      confidence: number;
    }>;
    diagnosed_by: "layer1_auto" | "layer2_pattern" | "doctor_agent";
    diagnosed_at: string;
  };
  treatment?: {
    prescription_id: string;
    prescription_type: "standard" | "dynamic";
    applied_at: string;
    auto_applied: boolean;
  };
  outcome: {
    status: "pending" | "resolved" | "partially_resolved" | "failed" | "recurred";
    follow_up_checks: Array<{
      check_number: number;
      scheduled_at: string;
      checked_at?: string;
      symptoms_present?: boolean;
    }>;
    resolved_at?: string;
  };
  billing: {
    free_tier: boolean;
    stripe_payment_intent_id?: string;
    amount_cents?: number;
    captured: boolean;
  };
  created_at: string;
  updated_at: string;
}
