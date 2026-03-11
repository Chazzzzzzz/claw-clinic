import type { DiseaseRecord } from "../types/index.js";
import { extractSymptomVector } from "../utils/symptom-extraction.js";
import { matchDiseases } from "../utils/matching.js";
import {
  generateHealthyTrace,
  generateLoopTrace,
  generateConfabulationTrace,
  generateContextRotTrace,
  generateCostExplosionTrace,
  generateToolFailureTrace,
} from "./trace-generator.js";

export interface EvalReport {
  total_diseases: number;
  tested_diseases: number;
  accuracy: {
    true_positives: number;
    false_positives: number;
    false_negatives: number;
    precision: number;
    recall: number;
    f1_score: number;
  };
  per_disease: Array<{
    icd_ai_code: string;
    name: string;
    detected: boolean;
    confidence: number;
    correct: boolean;
  }>;
  timestamp: string;
}

interface DiseaseTestCase {
  icd_ai_code: string;
  generator: () => import("../types/index.js").TraceRecord[];
  contextWindowSize?: number;
}

/**
 * Run evaluation against all diseases using synthetic traces.
 * Returns an EvalReport with accuracy metrics.
 */
export function runEval(diseases: DiseaseRecord[]): EvalReport {
  // Map disease codes to their trace generators
  const testCases: DiseaseTestCase[] = [
    { icd_ai_code: "E.1.1", generator: () => generateLoopTrace(5) },
    { icd_ai_code: "N.1.1", generator: () => generateConfabulationTrace() },
    { icd_ai_code: "N.2.1", generator: () => generateContextRotTrace(), contextWindowSize: 50000 },
    { icd_ai_code: "C.1.1", generator: () => generateCostExplosionTrace() },
    { icd_ai_code: "O.1.1", generator: () => generateToolFailureTrace() },
  ];

  const perDisease: EvalReport["per_disease"] = [];
  let truePositives = 0;
  let falseNegatives = 0;

  // Test each disease trace
  for (const testCase of testCases) {
    const disease = diseases.find((d) => d.icd_ai_code === testCase.icd_ai_code);
    if (!disease) {
      perDisease.push({
        icd_ai_code: testCase.icd_ai_code,
        name: "Unknown",
        detected: false,
        confidence: 0,
        correct: false,
      });
      falseNegatives++;
      continue;
    }

    const trace = testCase.generator();
    const symptomVector = extractSymptomVector(trace, testCase.contextWindowSize);
    const candidates = matchDiseases(symptomVector, diseases);

    const detected = candidates.some((c) => c.icd_ai_code === testCase.icd_ai_code);
    const matchedCandidate = candidates.find((c) => c.icd_ai_code === testCase.icd_ai_code);
    const confidence = matchedCandidate?.confidence ?? 0;
    // Correct if the disease is in the top result or within the differential
    const correct = detected && candidates.indexOf(matchedCandidate!) < 3;

    if (correct) {
      truePositives++;
    } else {
      falseNegatives++;
    }

    perDisease.push({
      icd_ai_code: testCase.icd_ai_code,
      name: disease.name,
      detected,
      confidence,
      correct,
    });
  }

  // Test healthy trace for false positives
  const healthyTrace = generateHealthyTrace(10);
  const healthyVector = extractSymptomVector(healthyTrace);
  const healthyCandidates = matchDiseases(healthyVector, diseases);
  // Any diagnosis on a healthy trace is a false positive
  const falsePositives = healthyCandidates.length;

  const testedDiseases = testCases.length;

  const precision =
    truePositives + falsePositives > 0
      ? truePositives / (truePositives + falsePositives)
      : 0;
  const recall =
    truePositives + falseNegatives > 0
      ? truePositives / (truePositives + falseNegatives)
      : 0;
  const f1Score =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    total_diseases: diseases.length,
    tested_diseases: testedDiseases,
    accuracy: {
      true_positives: truePositives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      precision,
      recall,
      f1_score: f1Score,
    },
    per_disease: perDisease,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format an EvalReport as a human-readable string.
 */
export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push("=== Claw Clinic Eval Report ===");
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Total diseases in registry: ${report.total_diseases}`);
  lines.push(`Diseases tested: ${report.tested_diseases}`);
  lines.push("");

  lines.push("--- Accuracy ---");
  lines.push(`True Positives:  ${report.accuracy.true_positives}`);
  lines.push(`False Positives: ${report.accuracy.false_positives}`);
  lines.push(`False Negatives: ${report.accuracy.false_negatives}`);
  lines.push(`Precision:       ${(report.accuracy.precision * 100).toFixed(1)}%`);
  lines.push(`Recall:          ${(report.accuracy.recall * 100).toFixed(1)}%`);
  lines.push(`F1 Score:        ${(report.accuracy.f1_score * 100).toFixed(1)}%`);
  lines.push("");

  lines.push("--- Per Disease ---");
  for (const d of report.per_disease) {
    const status = d.correct ? "PASS" : "FAIL";
    lines.push(
      `[${status}] ${d.icd_ai_code} ${d.name} | detected: ${d.detected} | confidence: ${(d.confidence * 100).toFixed(1)}%`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
