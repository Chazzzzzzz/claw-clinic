export type Department =
  | "Neurology"
  | "Cardiology"
  | "Immunology"
  | "Orthopedics"
  | "Psychiatry"
  | "Emergency"
  | "MultiAgent"
  | "Dermatology"
  | "Gastroenterology"
  | "Ophthalmology"
  | "Endocrinology"
  | "Oncology"
  | "Configuration";

export type Severity = "Low" | "Moderate" | "High" | "Critical";

export type Prevalence = "Rare" | "Moderate" | "Common" | "Very Common" | "Universal";

export interface DiagnosticCriteria {
  vital_sign_thresholds: Record<string, { min?: number; max?: number }>;
  base_weight: number;
  required_threshold_count: number;
  supporting_symptoms: string[];
  exclusion_criteria: string[];
}

export interface DiseaseRecord {
  icd_ai_code: string;
  name: string;
  department: Department;
  description: string;
  diagnostic_criteria: DiagnosticCriteria;
  severity: Severity;
  prevalence: Prevalence;
  etiology: string[];
  progression: string;
  medical_analogy: {
    human_disease: string;
    explanation: string;
  };
  prescriptions: string[];
  first_documented: string;
  last_updated: string;
  case_count: number;
}
