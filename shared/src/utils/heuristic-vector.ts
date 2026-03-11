import type { SymptomVector } from "../types/index.js";

/**
 * Create a minimal SymptomVector from free-text symptoms when no trace is available.
 * This is a best-effort heuristic based on keyword matching.
 *
 * Strategy: start from a neutral baseline that doesn't match any disease,
 * then shift specific signals toward disease-specific thresholds when keywords match.
 */
export function createMinimalSymptomVector(symptomsText: string): SymptomVector {
  const lower = symptomsText.toLowerCase();

  // Neutral baseline — designed to NOT match any disease thresholds
  const sv: SymptomVector = {
    step_count: 10,
    loop_count: 0,
    unique_tools: 4,
    error_rate: 0.02,
    token_velocity: 1000,
    tool_success_rate: 0.95,
    latency_p95_ms: 200,
    cost_total_usd: 0.05,
    context_utilization: 0.3,
    output_diversity_score: 0.8,
  };

  // E.1.1 Loop — push loop_count high, diversity low
  if (lower.includes("loop") || lower.includes("repeat") || lower.includes("stuck") || lower.includes("cycling") || lower.includes("same tool")) {
    sv.loop_count = 5;
    sv.output_diversity_score = 0.15;
    sv.unique_tools = 1;
  }

  // N.1.1 Confabulation — low tool_success_rate but NO errors (agent confidently fabricates)
  if (lower.includes("hallucin") || lower.includes("confabul") || lower.includes("fabricat") || lower.includes("made up") || lower.includes("fake") || lower.includes("invented")) {
    sv.tool_success_rate = 0.4;
    sv.error_rate = 0.03;
  }

  // N.2.1 Context Rot — push context_utilization high, step_count high
  if (lower.includes("forgot") || lower.includes("forget") || lower.includes("context") || lower.includes("lost instruction") || lower.includes("memory") || lower.includes("ignore")) {
    sv.context_utilization = 0.92;
    sv.step_count = 40;
    sv.error_rate = 0.15;
  }

  // C.1.1 Cost Explosion — push token_velocity and cost high
  if (lower.includes("expensive") || lower.includes("cost") || lower.includes("budget") || lower.includes("token") || lower.includes("billing") || lower.includes("spend")) {
    sv.token_velocity = 12000;
    sv.cost_total_usd = 5.0;
    sv.step_count = 50;
  }

  // O.1.1 Tool Failure — push error_rate high, tool_success_rate low
  if (lower.includes("tool fail") || lower.includes("tool error") || lower.includes("schema") || lower.includes("broken tool") || lower.includes("mismatch") || lower.includes("error") || lower.includes("fail")) {
    sv.error_rate = 0.5;
    sv.tool_success_rate = 0.3;
  }

  // I.1.1 Prompt Injection — push error_rate up, context_utilization high
  if (lower.includes("inject") || lower.includes("hijack") || lower.includes("jailbreak") || lower.includes("prompt attack")) {
    sv.error_rate = 0.25;
    sv.context_utilization = 0.85;
  }

  // M.2.1 Deadlock — low token_velocity, low step_count
  if (lower.includes("deadlock") || lower.includes("frozen") || lower.includes("waiting for each other") || lower.includes("circular dependency")) {
    sv.token_velocity = 50;
    sv.step_count = 3;
    sv.error_rate = 0.0;
  }

  // P.1.1 Sycophancy — high tool_success_rate, but misleading
  if (lower.includes("sycophant") || lower.includes("agrees with everything") || lower.includes("yes-man") || lower.includes("too agreeable") || lower.includes("never pushes back")) {
    sv.tool_success_rate = 1.0;
    sv.output_diversity_score = 0.2;
    sv.error_rate = 0.0;
  }

  // Slow/timeout
  if (lower.includes("slow") || lower.includes("timeout") || lower.includes("latency")) {
    sv.latency_p95_ms = 8000;
  }

  return sv;
}
