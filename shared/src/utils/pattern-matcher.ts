import type {
  TraceRecord,
  DiseaseRecord,
  SymptomVector,
  DiagnosisCandidate,
  DiagnosisResult,
  TriageLevel,
} from "../types/index.js";
import { extractSymptomVector } from "./symptom-extraction.js";
import { matchDiseases } from "./matching.js";
import { createMinimalSymptomVector } from "./heuristic-vector.js";

function generateCaseId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `case_${timestamp}${random}`;
}

function triageLevelFromSeverity(
  severity: string | undefined,
): TriageLevel {
  switch (severity) {
    case "Critical":
      return "RED";
    case "High":
      return "ORANGE";
    case "Moderate":
      return "YELLOW";
    case "Low":
      return "GREEN";
    default:
      return "BLUE";
  }
}

export function diagnose(
  input: {
    symptoms?: string;
    trace?: TraceRecord[];
    framework?: string;
  },
  diseases: DiseaseRecord[],
): DiagnosisResult {
  // Extract symptom vector
  let symptomVector: SymptomVector;

  if (input.trace && input.trace.length > 0) {
    // Default context window size of 128k tokens (standard for most LLMs)
    symptomVector = extractSymptomVector(input.trace, 128000);
  } else if (input.symptoms) {
    symptomVector = createMinimalSymptomVector(input.symptoms);
  } else {
    // Should not reach here due to validation, but handle gracefully
    symptomVector = extractSymptomVector([]);
  }

  // Run disease matching
  const candidates = matchDiseases(symptomVector, diseases, {
    symptoms_text: input.symptoms,
    framework: input.framework,
  });

  // Primary = top result
  const primary: DiagnosisCandidate | null =
    candidates.length > 0 ? candidates[0] : null;

  // Differential = next 2
  const differential = candidates.slice(1, 3);

  // Escalate if primary confidence < 0.6 or no primary found
  const escalateToLayer3 = !primary || primary.confidence < 0.6;

  // Triage level based on primary disease severity
  let triageLevel: TriageLevel = "BLUE";
  if (primary) {
    const matchedDisease = diseases.find(
      (d) => d.icd_ai_code === primary.icd_ai_code,
    );
    triageLevel = triageLevelFromSeverity(matchedDisease?.severity);
  }

  const caseId = generateCaseId();

  return {
    primary,
    differential,
    symptom_vector: symptomVector,
    triage_level: triageLevel,
    escalate_to_layer3: escalateToLayer3,
    case_id: caseId,
  };
}
