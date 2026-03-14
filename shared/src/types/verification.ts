// ─── Verification Types (shared between plugin and workers) ─────

export type VerificationConfidence = "high" | "medium" | "low";

export type VerificationStepType =
  | "check_file"
  | "check_connectivity"
  | "check_config"
  | "check_process"
  | "check_logs"
  | "custom";

/** A verification step returned by the backend /verify endpoint. */
export interface VerificationStep {
  id: string;
  type: VerificationStepType;
  description: string;
  instruction: string;
  confidence: VerificationConfidence;
  params: Record<string, unknown>;
  successCondition: string;
}

/** Response from POST /verify. */
export interface VerificationPlanResponse {
  diseaseCode: string;
  diseaseName: string;
  steps: VerificationStep[];
}
