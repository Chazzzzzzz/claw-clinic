import type { Prescription } from "./prescription.js";

export interface Consultation {
  id: string;
  case_id: string;
  user_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  urgency: "IMMEDIATE" | "URGENT" | "STANDARD";
  preliminary_diagnosis?: {
    icd_ai_code: string;
    confidence: number;
  };
  doctor_diagnosis?: {
    primary: {
      icd_ai_code: string;
      disease_name: string;
      confidence: number;
    };
    differential: Array<{
      icd_ai_code: string;
      disease_name: string;
      confidence: number;
    }>;
    reasoning: string;
  };
  doctor_prescription?: Prescription;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}
