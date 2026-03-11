export interface PrescriptionStep {
  action: "instruction" | "config_suggestion" | "manual_steps";
  target: string;
  change: string;
  rationale: string;
  reversible: boolean;
}

export interface Prescription {
  id: string;
  name: string;
  version: string;
  target_disease: string;
  target_frameworks: string[];
  type: "acute" | "chronic" | "preventive";
  risk_level: "low" | "medium" | "high";
  auto_applicable: boolean;
  steps: PrescriptionStep[];
  dosage: {
    parameters: Record<string, unknown>;
    adjustments: string;
  };
  side_effects: string[];
  contraindications: string[];
  efficacy: {
    success_rate: number;
    sample_size: number;
    last_updated: string;
    confidence_interval: string;
  };
  created_by: "system" | "doctor_agent" | "community";
  created_at: string;
}
