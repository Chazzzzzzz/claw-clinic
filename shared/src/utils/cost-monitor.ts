import type { TraceRecord } from "../types/index.js";

export interface CostAlert {
  level: "normal" | "elevated" | "critical" | "emergency";
  cost_total_usd: number;
  cost_velocity_per_minute: number;
  budget_ceiling_usd: number;
  budget_remaining_usd: number;
  recommendation: string | null;
}

export function analyzeCost(
  trace: TraceRecord[],
  budgetCeiling: number = 5.0,
): CostAlert {
  const costTotalUsd = trace.reduce(
    (sum, t) => sum + (t.metrics?.cost_usd ?? 0),
    0,
  );

  // Compute elapsed minutes
  const timestamps = trace
    .filter((t) => t.timestamp)
    .map((t) => new Date(t.timestamp!).getTime());

  let elapsedMinutes = 0;
  if (timestamps.length >= 2) {
    elapsedMinutes =
      (Math.max(...timestamps) - Math.min(...timestamps)) / 60000;
  }

  const costVelocity =
    elapsedMinutes > 0 ? costTotalUsd / elapsedMinutes : costTotalUsd;

  const budgetRemaining = Math.max(0, budgetCeiling - costTotalUsd);

  let level: CostAlert["level"];
  let recommendation: string | null = null;

  if (costTotalUsd >= budgetCeiling) {
    level = "emergency";
    recommendation = `STOP IMMEDIATELY. Budget ceiling of $${budgetCeiling.toFixed(2)} exceeded. Current spend: $${costTotalUsd.toFixed(2)}. Report to your operator.`;
  } else if (costTotalUsd >= budgetCeiling * 0.8) {
    level = "critical";
    recommendation = `WARNING: You have spent $${costTotalUsd.toFixed(2)} of your $${budgetCeiling.toFixed(2)} budget. Reduce unnecessary tool calls.`;
  } else if (costVelocity > 1.0) {
    level = "elevated";
    recommendation = `Cost velocity is high ($${costVelocity.toFixed(2)}/min). Consider whether all tool calls are necessary.`;
  } else {
    level = "normal";
  }

  return {
    level,
    cost_total_usd: costTotalUsd,
    cost_velocity_per_minute: costVelocity,
    budget_ceiling_usd: budgetCeiling,
    budget_remaining_usd: budgetRemaining,
    recommendation,
  };
}
