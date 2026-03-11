import type {
  TraceRecord,
  ImmuneSystemReport,
  TriageLevel,
} from "../types/index.js";
import { extractSymptomVector } from "./symptom-extraction.js";
import { computeVitals } from "./vitals.js";
import { detectLoop } from "./loop-detector.js";
import { analyzeCost } from "./cost-monitor.js";
import { analyzeToolHealth } from "./tool-health.js";

type AnomalySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface Anomaly {
  type: "LOOP_DETECTED" | "COST_ALERT" | "TOOL_UNHEALTHY" | "HIGH_ERROR_RATE";
  severity: AnomalySeverity;
  description: string;
  instruction: string;
}

export function runImmuneSystem(
  trace: TraceRecord[],
  config?: {
    budget_ceiling_usd?: number;
    context_window_size?: number;
  },
): ImmuneSystemReport {
  const budgetCeiling = config?.budget_ceiling_usd ?? 5.0;

  // Extract symptom vector and compute vitals
  const symptomVector = extractSymptomVector(
    trace,
    config?.context_window_size,
  );
  const vitals = computeVitals(symptomVector);

  const anomalies: Anomaly[] = [];
  const recommendations: string[] = [];

  // 1. Run loop detector
  const loopResult = detectLoop(trace);
  if (loopResult.detected) {
    const severity: AnomalySeverity =
      loopResult.confidence === "high" ? "CRITICAL" : "MEDIUM";

    anomalies.push({
      type: "LOOP_DETECTED",
      severity,
      description: `Loop detected: tool '${loopResult.looping_tool}' called ${loopResult.loop_length} times with ${(loopResult.argument_match_ratio * 100).toFixed(0)}% argument similarity.`,
      instruction:
        loopResult.recommendation ??
        "Consider using a different approach to complete your task.",
    });

    if (loopResult.recommendation) {
      recommendations.push(loopResult.recommendation);
    }
  }

  // 2. Run cost monitor
  const costResult = analyzeCost(trace, budgetCeiling);
  if (costResult.level !== "normal") {
    let severity: AnomalySeverity;
    switch (costResult.level) {
      case "emergency":
        severity = "CRITICAL";
        break;
      case "critical":
        severity = "HIGH";
        break;
      case "elevated":
        severity = "MEDIUM";
        break;
      default:
        severity = "LOW";
    }

    anomalies.push({
      type: "COST_ALERT",
      severity,
      description: `Cost ${costResult.level}: $${costResult.cost_total_usd.toFixed(2)} spent of $${budgetCeiling.toFixed(2)} budget. Velocity: $${costResult.cost_velocity_per_minute.toFixed(2)}/min.`,
      instruction:
        costResult.recommendation ??
        "Monitor your spending and reduce unnecessary operations.",
    });

    if (costResult.recommendation) {
      recommendations.push(costResult.recommendation);
    }
  }

  // 3. Run tool health tracker
  const toolHealthResult = analyzeToolHealth(trace);
  if (toolHealthResult.unreliable_tools.length > 0) {
    anomalies.push({
      type: "TOOL_UNHEALTHY",
      severity: "HIGH",
      description: `Unreliable tools detected: ${toolHealthResult.unreliable_tools.join(", ")}. Overall tool success rate: ${(toolHealthResult.overall_tool_success_rate * 100).toFixed(0)}%.`,
      instruction: `Stop using unreliable tools (${toolHealthResult.unreliable_tools.join(", ")}). Check tool arguments and try alternative approaches.`,
    });

    recommendations.push(
      `Tools ${toolHealthResult.unreliable_tools.join(", ")} are failing frequently. Review error messages and correct your tool usage.`,
    );
  }

  // 4. Check high error rate
  if (symptomVector.error_rate > 0.15) {
    anomalies.push({
      type: "HIGH_ERROR_RATE",
      severity: symptomVector.error_rate > 0.3 ? "HIGH" : "MEDIUM",
      description: `Error rate is ${(symptomVector.error_rate * 100).toFixed(0)}%, which exceeds the 15% threshold.`,
      instruction:
        "Review recent errors and address the root cause before continuing. Persistent errors indicate a fundamental problem with your approach.",
    });

    recommendations.push(
      "High error rate detected. Review error messages and consider a different strategy.",
    );
  }

  // Determine triage level based on highest severity anomaly
  let triageLevel: TriageLevel = "BLUE";
  for (const anomaly of anomalies) {
    switch (anomaly.severity) {
      case "CRITICAL":
        triageLevel = "RED";
        break;
      case "HIGH":
        if (triageLevel !== "RED") triageLevel = "ORANGE";
        break;
      case "MEDIUM":
        if (triageLevel !== "RED" && triageLevel !== "ORANGE")
          triageLevel = "YELLOW";
        break;
      case "LOW":
        if (
          triageLevel !== "RED" &&
          triageLevel !== "ORANGE" &&
          triageLevel !== "YELLOW"
        )
          triageLevel = "GREEN";
        break;
    }
  }

  // Determine emergency action
  let emergencyAction: ImmuneSystemReport["emergency_action"] = "NONE";

  if (
    loopResult.detected &&
    loopResult.confidence === "high"
  ) {
    emergencyAction = "STOP_CURRENT_TASK";
  }

  if (costResult.level === "emergency") {
    emergencyAction = "STOP_CURRENT_TASK";
  } else if (
    costResult.level === "critical" &&
    emergencyAction === "NONE"
  ) {
    emergencyAction = "REDUCE_TOOL_CALLS";
  }

  return {
    vitals,
    anomalies,
    triage_level: triageLevel,
    recommendations,
    emergency_action: emergencyAction,
  };
}
