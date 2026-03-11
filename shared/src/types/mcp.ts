import type { TraceRecord, VitalSigns, TriageLevel, SymptomVector } from "./case.js";

export interface HealthCheckInput {
  trace: TraceRecord[];
  config?: {
    budget_ceiling_usd?: number;
    context_window_size?: number;
    framework?: string;
    max_iterations?: number;
  };
  consultation_id?: string;
}

export interface DiagnoseInput {
  symptoms?: string;
  trace?: TraceRecord[];
  framework?: string;
}

export interface TreatInput {
  prescription_id: string;
  auto_apply?: boolean;
  case_id: string;
}

export interface ConsultInput {
  case_summary: string;
  trace?: TraceRecord[];
  urgency?: "IMMEDIATE" | "URGENT" | "STANDARD";
}

export interface LookupInput {
  query: string;
}

export interface ImmuneSystemReport {
  vitals: VitalSigns;
  anomalies: Array<{
    type: "LOOP_DETECTED" | "COST_ALERT" | "TOOL_UNHEALTHY" | "HIGH_ERROR_RATE";
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    description: string;
    instruction: string;
  }>;
  triage_level: TriageLevel;
  recommendations: string[];
  emergency_action: "STOP_CURRENT_TASK" | "REDUCE_TOOL_CALLS" | "NONE";
}

export interface DiagnosisCandidate {
  icd_ai_code: string;
  disease_name: string;
  confidence: number;
  matched_thresholds: string[];
  matched_supporting: string[];
  matched_exclusions: string[];
}

export interface DiagnosisResult {
  primary: DiagnosisCandidate | null;
  differential: DiagnosisCandidate[];
  symptom_vector: SymptomVector;
  triage_level: TriageLevel;
  escalate_to_layer3: boolean;
  case_id: string;
}
