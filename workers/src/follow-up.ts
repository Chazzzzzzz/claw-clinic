// Follow-up Verification Worker
// Checks treatment outcomes at T+24h, T+48h, T+72h
// Compares current symptom vector against original — no hardcoded disease catalog.

import {
  extractSymptomVector,
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
  original_symptom_vector?: SymptomVector;
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

function classifyChange(
  metricName: string,
  from: number,
  to: number,
): "improved" | "worsened" | "unchanged" {
  const tolerance = 0.05;
  const diff = to - from;
  const relChange = from !== 0 ? Math.abs(diff / from) : Math.abs(diff);

  if (relChange < tolerance) return "unchanged";

  const lowerIsBetter = new Set([
    "loop_count", "error_rate", "cost_total_usd", "latency_p95_ms",
    "context_utilization", "step_count", "token_velocity",
  ]);

  const higherIsBetter = new Set([
    "tool_success_rate", "output_diversity_score", "unique_tools",
  ]);

  if (lowerIsBetter.has(metricName)) {
    return diff < 0 ? "improved" : "worsened";
  }
  if (higherIsBetter.has(metricName)) {
    return diff > 0 ? "improved" : "worsened";
  }

  return "unchanged";
}

function identifyCurrentSymptoms(sv: SymptomVector): string[] {
  const symptoms: string[] = [];

  if (sv.loop_count >= 3) symptoms.push(`loop_count=${sv.loop_count}`);
  if (sv.error_rate > 0.15) symptoms.push(`error_rate=${(sv.error_rate * 100).toFixed(1)}%`);
  if (sv.tool_success_rate < 0.5) symptoms.push(`tool_success_rate=${(sv.tool_success_rate * 100).toFixed(1)}%`);
  if (sv.cost_total_usd > 1.0) symptoms.push(`cost=$${sv.cost_total_usd.toFixed(2)}`);
  if (sv.context_utilization > 0.85) symptoms.push(`context_utilization=${(sv.context_utilization * 100).toFixed(1)}%`);
  if (sv.token_velocity > 5000) symptoms.push(`token_velocity=${sv.token_velocity.toFixed(0)}`);
  if (sv.output_diversity_score < 0.3) symptoms.push(`output_diversity=${(sv.output_diversity_score * 100).toFixed(1)}%`);
  if (sv.latency_p95_ms > 3000) symptoms.push(`latency_p95=${sv.latency_p95_ms.toFixed(0)}ms`);
  if (sv.step_count > 50) symptoms.push(`step_count=${sv.step_count}`);

  return symptoms;
}

function determineStatus(
  changes: Record<string, { from: number; to: number; direction: "improved" | "worsened" | "unchanged" }>,
  currentSymptoms: string[],
): "improving" | "stable" | "worsening" | "resolved" | "recurred" {
  const directions = Object.values(changes).map((c) => c.direction);
  const improved = directions.filter((d) => d === "improved").length;
  const worsened = directions.filter((d) => d === "worsened").length;
  const total = directions.length;

  if (currentSymptoms.length === 0) return "resolved";
  if (worsened > improved && worsened > total * 0.3) return "worsening";
  if (improved > worsened && improved > total * 0.3) return "improving";
  return "stable";
}

function buildRecommendation(
  status: FollowUpResult["status"],
  checkNumber: number,
  currentSymptoms: string[],
  originalDiagnosis: FollowUpCheck["original_diagnosis"],
): string {
  const code = originalDiagnosis.icd_ai_code;
  const commands: string[] = [];

  switch (status) {
    case "resolved":
      commands.push(`# ${code} resolved. Verify with:`);
      commands.push("openclaw health");
      return commands.join("\n");

    case "improving":
      commands.push(`# ${code} improving. Next check at T+${(checkNumber + 1) * 24}h`);
      commands.push("openclaw health");
      return commands.join("\n");

    case "stable":
      commands.push(`# ${code} stable — treatment may be insufficient.`);
      commands.push("# Re-diagnose:");
      commands.push("openclaw claw-clinic diagnose");
      commands.push("# Check logs:");
      commands.push('journalctl -u openclaw-gateway --since "1 hour ago"');
      return commands.join("\n");

    case "worsening":
      commands.push(`# WARNING: ${code} worsening. Active symptoms: ${currentSymptoms.join(", ")}`);
      commands.push("# Immediate actions:");
      commands.push("sudo systemctl restart openclaw-gateway");
      commands.push("openclaw session reset");
      commands.push("openclaw claw-clinic diagnose");
      return commands.join("\n");

    case "recurred":
      commands.push(`# ALERT: ${code} recurred. Root cause may not be resolved.`);
      commands.push("# Full re-diagnosis:");
      commands.push("openclaw claw-clinic diagnose");
      commands.push('journalctl -u openclaw-gateway --since "24 hours ago" | grep -i error');
      return commands.join("\n");

    default:
      commands.push("openclaw health");
      return commands.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function processFollowUp(check: FollowUpCheck): Promise<FollowUpResult> {
  // Use the stored original symptom vector if available, otherwise use a neutral baseline
  const originalSV = check.original_symptom_vector ?? emptySymptomVector();

  const currentSV =
    check.trace.length > 0
      ? extractSymptomVector(check.trace)
      : emptySymptomVector();

  const metricKeys: (keyof SymptomVector)[] = [
    "step_count", "loop_count", "unique_tools", "error_rate",
    "token_velocity", "tool_success_rate", "latency_p95_ms",
    "cost_total_usd", "context_utilization", "output_diversity_score",
  ];

  const changes: Record<
    string,
    { from: number; to: number; direction: "improved" | "worsened" | "unchanged" }
  > = {};

  for (const key of metricKeys) {
    const from = originalSV[key];
    const to = currentSV[key];
    changes[key] = { from, to, direction: classifyChange(key, from, to) };
  }

  const currentSymptoms = identifyCurrentSymptoms(currentSV);
  const status = determineStatus(changes, currentSymptoms);
  const recommendation = buildRecommendation(status, check.check_number, currentSymptoms, check.original_diagnosis);

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
