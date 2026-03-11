// Follow-up Verification Worker
// Checks treatment outcomes at T+24h, T+48h, T+72h
// Compares current symptom vector against original diagnosis

import {
  extractSymptomVector,
  MVP_DISEASES,
  matchDiseases,
} from "@claw-clinic/shared";
import type {
  TraceRecord,
  SymptomVector,
} from "@claw-clinic/shared";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface FollowUpCheck {
  case_id: string;
  check_number: 1 | 2 | 3; // T+24h, T+48h, T+72h
  trace: TraceRecord[];
  original_diagnosis: {
    icd_ai_code: string;
    confidence: number;
  };
}

export interface FollowUpResult {
  case_id: string;
  check_number: number;
  status: "improving" | "stable" | "worsening" | "resolved" | "recurred";
  current_symptoms: string[];
  comparison: {
    original_symptom_vector: SymptomVector;
    current_symptom_vector: SymptomVector;
    changes: Record<
      string,
      { from: number; to: number; direction: "improved" | "worsened" | "unchanged" }
    >;
  };
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine whether a change in a given metric is an improvement or not. */
function classifyChange(
  metricName: string,
  from: number,
  to: number,
): "improved" | "worsened" | "unchanged" {
  const tolerance = 0.05; // ignore changes smaller than 5% relative
  const diff = to - from;
  const relChange = from !== 0 ? Math.abs(diff / from) : Math.abs(diff);

  if (relChange < tolerance) return "unchanged";

  // Metrics where LOWER is better
  const lowerIsBetter = new Set([
    "loop_count",
    "error_rate",
    "cost_total_usd",
    "latency_p95_ms",
    "context_utilization",
    "step_count",
    "token_velocity",
  ]);

  // Metrics where HIGHER is better
  const higherIsBetter = new Set([
    "tool_success_rate",
    "output_diversity_score",
    "unique_tools",
  ]);

  if (lowerIsBetter.has(metricName)) {
    return diff < 0 ? "improved" : "worsened";
  }
  if (higherIsBetter.has(metricName)) {
    return diff > 0 ? "improved" : "worsened";
  }

  return "unchanged";
}

/** List current symptoms based on what thresholds are still exceeded. */
function identifyCurrentSymptoms(sv: SymptomVector): string[] {
  const symptoms: string[] = [];

  if (sv.loop_count >= 3) symptoms.push(`Loop count elevated (${sv.loop_count})`);
  if (sv.error_rate > 0.15) symptoms.push(`High error rate (${(sv.error_rate * 100).toFixed(1)}%)`);
  if (sv.tool_success_rate < 0.5) symptoms.push(`Low tool success rate (${(sv.tool_success_rate * 100).toFixed(1)}%)`);
  if (sv.cost_total_usd > 1.0) symptoms.push(`Elevated cost ($${sv.cost_total_usd.toFixed(2)})`);
  if (sv.context_utilization > 0.85) symptoms.push(`High context utilization (${(sv.context_utilization * 100).toFixed(1)}%)`);
  if (sv.token_velocity > 5000) symptoms.push(`High token velocity (${sv.token_velocity.toFixed(0)} tokens/min)`);
  if (sv.output_diversity_score < 0.3) symptoms.push(`Low output diversity (${(sv.output_diversity_score * 100).toFixed(1)}%)`);
  if (sv.latency_p95_ms > 3000) symptoms.push(`High latency P95 (${sv.latency_p95_ms.toFixed(0)}ms)`);
  if (sv.step_count > 50) symptoms.push(`Excessive step count (${sv.step_count})`);

  return symptoms;
}

/** Determine overall status from the changes map. */
function determineStatus(
  changes: Record<string, { from: number; to: number; direction: "improved" | "worsened" | "unchanged" }>,
  currentSymptoms: string[],
  originalDiagnosis: FollowUpCheck["original_diagnosis"],
  currentSV: SymptomVector,
): "improving" | "stable" | "worsening" | "resolved" | "recurred" {
  const directions = Object.values(changes).map((c) => c.direction);
  const improved = directions.filter((d) => d === "improved").length;
  const worsened = directions.filter((d) => d === "worsened").length;
  const total = directions.length;

  // Check if the original disease still matches
  const currentCandidates = matchDiseases(currentSV, MVP_DISEASES);
  const stillPresent = currentCandidates.some(
    (c) => c.icd_ai_code === originalDiagnosis.icd_ai_code && c.confidence >= 0.2,
  );

  // Resolved: no symptoms remain and the original disease is no longer detected
  if (currentSymptoms.length === 0 && !stillPresent) {
    return "resolved";
  }

  // Recurred: had been improving but symptoms returned — check if original
  // disease confidence actually went UP
  const originalMatch = currentCandidates.find(
    (c) => c.icd_ai_code === originalDiagnosis.icd_ai_code,
  );
  if (
    originalMatch &&
    originalMatch.confidence > originalDiagnosis.confidence * 1.1
  ) {
    return "recurred";
  }

  // Count directions
  if (worsened > improved && worsened > total * 0.3) return "worsening";
  if (improved > worsened && improved > total * 0.3) return "improving";
  return "stable";
}

/** Build a recommendation string based on the follow-up status and check number. */
function buildRecommendation(
  status: FollowUpResult["status"],
  checkNumber: number,
  currentSymptoms: string[],
  originalDiagnosis: FollowUpCheck["original_diagnosis"],
): string {
  const disease = MVP_DISEASES.find((d) => d.icd_ai_code === originalDiagnosis.icd_ai_code);
  const diseaseName = disease?.name ?? originalDiagnosis.icd_ai_code;

  switch (status) {
    case "resolved":
      return `${diseaseName} appears to be resolved. No active symptoms detected. Continue standard monitoring and close the case if no symptoms recur within 72 hours.`;

    case "improving":
      if (checkNumber < 3) {
        return `${diseaseName} is showing improvement. Continue current treatment. Next follow-up check at T+${(checkNumber + 1) * 24}h.`;
      }
      return `${diseaseName} is improving after 72 hours of treatment. Consider closing the case with a note that residual symptoms (${currentSymptoms.join(", ")}) may require ongoing monitoring.`;

    case "stable":
      if (checkNumber < 3) {
        return `${diseaseName} is stable but not yet improving. The current treatment may need more time. Continue monitoring. If no improvement by T+${(checkNumber + 1) * 24}h, consider adjusting the treatment plan.`;
      }
      return `${diseaseName} remains stable after 72 hours. The treatment may be insufficient. Consider escalating to a more aggressive treatment or investigating alternative root causes. Current symptoms: ${currentSymptoms.join(", ")}.`;

    case "worsening":
      return `WARNING: ${diseaseName} is worsening despite treatment. Current symptoms: ${currentSymptoms.join(", ")}. Recommend immediate re-evaluation. Consider: (1) Verifying the original diagnosis is correct. (2) Checking for comorbid conditions. (3) Applying a stronger treatment protocol. (4) Escalating to manual intervention.`;

    case "recurred":
      return `ALERT: ${diseaseName} has recurred after initial improvement. This suggests the root cause was not fully addressed. Recommend: (1) Re-run full diagnosis to check for underlying causes. (2) Apply treatment again with stronger parameters. (3) Investigate whether the original trigger is still present.`;

    default:
      return "Follow-up check complete. Review the comparison data for details.";
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function processFollowUp(check: FollowUpCheck): Promise<FollowUpResult> {
  // Build original symptom vector from the original trace context.
  // Since we only have the *current* trace in the check, we use a
  // placeholder original vector derived from the disease thresholds.
  // In a production system the original vector would be stored in the DB.
  const originalSV = buildOriginalEstimate(check.original_diagnosis.icd_ai_code);

  // Extract current symptom vector from the new trace
  const currentSV =
    check.trace.length > 0
      ? extractSymptomVector(check.trace)
      : emptySymptomVector();

  // Build changes map
  const metricKeys: (keyof SymptomVector)[] = [
    "step_count",
    "loop_count",
    "unique_tools",
    "error_rate",
    "token_velocity",
    "tool_success_rate",
    "latency_p95_ms",
    "cost_total_usd",
    "context_utilization",
    "output_diversity_score",
  ];

  const changes: Record<
    string,
    { from: number; to: number; direction: "improved" | "worsened" | "unchanged" }
  > = {};

  for (const key of metricKeys) {
    const from = originalSV[key];
    const to = currentSV[key];
    changes[key] = {
      from,
      to,
      direction: classifyChange(key, from, to),
    };
  }

  // Identify current symptoms
  const currentSymptoms = identifyCurrentSymptoms(currentSV);

  // Determine overall status
  const status = determineStatus(changes, currentSymptoms, check.original_diagnosis, currentSV);

  // Build recommendation
  const recommendation = buildRecommendation(
    status,
    check.check_number,
    currentSymptoms,
    check.original_diagnosis,
  );

  return {
    case_id: check.case_id,
    check_number: check.check_number,
    status,
    current_symptoms: currentSymptoms,
    comparison: {
      original_symptom_vector: originalSV,
      current_symptom_vector: currentSV,
      changes,
    },
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Estimation helpers
// ---------------------------------------------------------------------------

/** Estimate the original symptom vector from the disease definition.
 *  In production the original vector would be persisted at diagnosis time;
 *  this is a best-effort reconstruction from the disease thresholds. */
function buildOriginalEstimate(icdCode: string): SymptomVector {
  const disease = MVP_DISEASES.find((d) => d.icd_ai_code === icdCode);
  if (!disease) return emptySymptomVector();

  const thresholds = disease.diagnostic_criteria.vital_sign_thresholds;
  const base = emptySymptomVector();

  // Set values to the threshold boundaries that would have triggered the diagnosis
  for (const [key, bounds] of Object.entries(thresholds)) {
    if (key in base) {
      const k = key as keyof SymptomVector;
      if (bounds.min !== undefined) {
        // For min thresholds, set slightly above the threshold
        (base as unknown as Record<string, number>)[k] = bounds.min * 1.2;
      }
      if (bounds.max !== undefined) {
        // For max thresholds, set slightly below the threshold
        (base as unknown as Record<string, number>)[k] = bounds.max * 0.8;
      }
    }
  }

  return base;
}

function emptySymptomVector(): SymptomVector {
  return {
    step_count: 0,
    loop_count: 0,
    unique_tools: 0,
    error_rate: 0,
    token_velocity: 0,
    tool_success_rate: 1,
    latency_p95_ms: 0,
    cost_total_usd: 0,
    context_utilization: 0,
    output_diversity_score: 1,
  };
}
