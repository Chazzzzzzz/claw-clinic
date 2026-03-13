import type { SymptomVector, DiseaseRecord } from "../types/index.js";
import type { DiagnosisCandidate } from "../types/mcp.js";

export function matchDiseases(
  symptomVector: SymptomVector,
  diseases: DiseaseRecord[],
  additionalContext?: {
    symptoms_text?: string;
    framework?: string;
  }
): DiagnosisCandidate[] {
  // Guard: empty/trivial traces should not produce diagnoses
  if (symptomVector.step_count === 0) return [];

  const candidates: DiagnosisCandidate[] = [];

  // Map symptom vector keys to vital sign threshold keys
  const svMap: Record<string, number> = {
    loop_count: symptomVector.loop_count,
    output_diversity_score: symptomVector.output_diversity_score,
    error_rate: symptomVector.error_rate,
    tool_success_rate: symptomVector.tool_success_rate,
    context_utilization: symptomVector.context_utilization,
    step_count: symptomVector.step_count,
    token_velocity: symptomVector.token_velocity,
    cost_total_usd: symptomVector.cost_total_usd,
    latency_p95_ms: symptomVector.latency_p95_ms,
    unique_tools: symptomVector.unique_tools,
  };

  for (const disease of diseases) {
    const criteria = disease.diagnostic_criteria;
    const thresholds = criteria.vital_sign_thresholds;
    const thresholdKeys = Object.keys(thresholds);
    const totalThresholds = thresholdKeys.length;

    // Check thresholds
    let thresholdsExceeded = 0;
    const matchedThresholds: string[] = [];

    for (const key of thresholdKeys) {
      const threshold = thresholds[key];
      const value = svMap[key];
      if (value === undefined) continue;

      let exceeded = false;
      if (threshold.min !== undefined && value >= threshold.min) exceeded = true;
      if (threshold.max !== undefined && value <= threshold.max) exceeded = true;

      if (exceeded) {
        thresholdsExceeded++;
        matchedThresholds.push(key);
      }
    }

    // For diseases WITH thresholds: must meet at least required_threshold_count (minimum 1)
    // For diseases WITHOUT thresholds (text-only): skip threshold check, rely on supporting symptoms
    if (totalThresholds > 0) {
      const effectiveRequired = Math.max(criteria.required_threshold_count, 1);
      if (thresholdsExceeded < effectiveRequired) continue;
    } else {
      // Text-only disease — require symptom text to proceed
      if (!additionalContext?.symptoms_text) continue;
    }

    let thresholdScore = totalThresholds > 0 ? thresholdsExceeded / totalThresholds : 0;

    // Supporting symptom bonus
    let supportingBonus = 0;
    const matchedSupporting: string[] = [];
    if (additionalContext?.symptoms_text) {
      const symptomsLower = additionalContext.symptoms_text.toLowerCase();
      for (const symptom of criteria.supporting_symptoms) {
        const words = symptom.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const matched = words.some(word => symptomsLower.includes(word));
        if (matched) {
          supportingBonus += 0.05;
          matchedSupporting.push(symptom);
        }
      }
      supportingBonus = Math.min(supportingBonus, 0.15);
    }

    // Exclusion penalty
    let exclusionPenalty = 0;
    const matchedExclusions: string[] = [];
    if (additionalContext?.symptoms_text) {
      const symptomsLower = additionalContext.symptoms_text.toLowerCase();
      for (const exclusion of criteria.exclusion_criteria) {
        const words = exclusion.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const matched = words.some(word => symptomsLower.includes(word));
        if (matched) {
          exclusionPenalty += 0.3;
          matchedExclusions.push(exclusion);
        }
      }
    }

    // Final confidence
    // For text-only diseases (no thresholds), use base_weight when supporting symptoms match
    const baseScore = totalThresholds > 0
      ? thresholdScore * criteria.base_weight
      : (matchedSupporting.length > 0 ? criteria.base_weight : 0);
    const confidence = Math.max(0, Math.min(1,
      baseScore + supportingBonus - exclusionPenalty
    ));

    if (confidence >= 0.1) {
      candidates.push({
        icd_ai_code: disease.icd_ai_code,
        disease_name: disease.name,
        confidence,
        matched_thresholds: matchedThresholds,
        matched_supporting: matchedSupporting,
        matched_exclusions: matchedExclusions,
      });
    }
  }

  // Sort by confidence descending, return top 5
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, 5);
}
