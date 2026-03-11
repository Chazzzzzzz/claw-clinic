import type { SymptomVector, VitalSigns } from "../types/index.js";

export function computeVitals(sv: SymptomVector): VitalSigns {
  return {
    token_burn_rate: sv.token_velocity,
    tool_success_rate: sv.tool_success_rate,
    loop_diversity_score: sv.step_count > 0
      ? Math.max(0, 1 - (sv.loop_count / sv.step_count))
      : 1.0,
    latency_p95_ms: sv.latency_p95_ms,
    context_utilization: sv.context_utilization,
    error_rate: sv.error_rate,
  };
}
