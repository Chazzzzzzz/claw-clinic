import { Hono } from "hono";
import { MVP_DISEASES } from "@claw-clinic/shared";
import type { Evidence, VerificationStep, VerificationPlanResponse, VerificationConfidence } from "@claw-clinic/shared";

// ─── Threshold-to-verification mapping ──────────────────────────

interface ThresholdCheck {
  type: VerificationStep["type"];
  description: string;
  instruction: string;
  confidence: VerificationConfidence;
  successCondition: string;
  paramKey: string;
}

const THRESHOLD_CHECKS: Record<string, ThresholdCheck> = {
  loop_count: {
    type: "check_logs",
    description: "Check if repetitive tool-call loops have stopped",
    instruction: "Examine recent agent traces for repeated identical tool calls",
    confidence: "low",
    successCondition: "loop_count has dropped below the diagnostic threshold",
    paramKey: "loop_count",
  },
  output_diversity_score: {
    type: "check_logs",
    description: "Check if agent output diversity has improved",
    instruction: "Analyze recent agent outputs for variety in tool usage and responses",
    confidence: "low",
    successCondition: "output_diversity_score has risen above the diagnostic threshold",
    paramKey: "output_diversity_score",
  },
  error_rate: {
    type: "check_logs",
    description: "Check if error rate has decreased",
    instruction: "Review recent agent interactions for error frequency",
    confidence: "medium",
    successCondition: "error_rate has dropped below the diagnostic threshold",
    paramKey: "error_rate",
  },
  tool_success_rate: {
    type: "check_logs",
    description: "Check if tool success rate has improved",
    instruction: "Review recent tool call results for success/failure ratio",
    confidence: "medium",
    successCondition: "tool_success_rate has risen above the diagnostic threshold",
    paramKey: "tool_success_rate",
  },
  token_velocity: {
    type: "check_logs",
    description: "Check if token consumption rate has normalized",
    instruction: "Measure tokens consumed per minute in recent interactions",
    confidence: "medium",
    successCondition: "token_velocity has dropped below the diagnostic threshold",
    paramKey: "token_velocity",
  },
  cost_total_usd: {
    type: "check_logs",
    description: "Check if session cost is within acceptable bounds",
    instruction: "Review total cost of recent sessions",
    confidence: "medium",
    successCondition: "cost_total_usd is below the diagnostic threshold",
    paramKey: "cost_total_usd",
  },
  step_count: {
    type: "check_logs",
    description: "Check if step count is within normal range",
    instruction: "Count the number of steps in recent agent sessions",
    confidence: "medium",
    successCondition: "step_count is below the diagnostic threshold",
    paramKey: "step_count",
  },
  latency_p95_ms: {
    type: "check_connectivity",
    description: "Check if response latency has improved",
    instruction: "Measure P95 response latency for recent API calls",
    confidence: "medium",
    successCondition: "latency_p95_ms is below the diagnostic threshold",
    paramKey: "latency_p95_ms",
  },
  context_utilization: {
    type: "check_logs",
    description: "Check context window utilization",
    instruction: "Measure what fraction of the context window is being used",
    confidence: "low",
    successCondition: "context_utilization is within normal bounds",
    paramKey: "context_utilization",
  },
  unique_tools: {
    type: "check_logs",
    description: "Check tool usage diversity",
    instruction: "Count unique tools used in recent agent sessions",
    confidence: "low",
    successCondition: "unique_tools count is within expected range",
    paramKey: "unique_tools",
  },
};

// ─── CFG-specific verification steps ────────────────────────────

const CFG_CHECKS: Record<string, VerificationStep[]> = {
  "CFG.1.1": [
    {
      id: "verify_key_format",
      type: "check_config",
      description: "Validate API key format",
      instruction: "Check that the API key matches the expected provider format (prefix, length, character set)",
      confidence: "high",
      params: { target: "api_key", check: "format_validation" },
      successCondition: "API key passes format validation for the detected provider",
    },
  ],
  "CFG.1.2": [
    {
      id: "verify_key_present",
      type: "check_config",
      description: "Check API key is configured",
      instruction: "Check openclaw.json and auth-profiles.json for a non-empty API key",
      confidence: "high",
      params: { paths: ["~/.openclaw/openclaw.json", "~/.openclaw/agents/*/agent/auth-profiles.json"], key: "apiKey" },
      successCondition: "A non-empty API key exists in configuration",
    },
  ],
  "CFG.2.1": [
    {
      id: "verify_endpoint_reachable",
      type: "check_connectivity",
      description: "Check AI provider endpoint reachability",
      instruction: "Send a HEAD request to all configured AI provider endpoints",
      confidence: "high",
      params: { endpoints: ["https://api.anthropic.com", "https://api.openai.com"] },
      successCondition: "All configured endpoints return a response with status < 500",
    },
  ],
  "CFG.3.1": [
    {
      id: "verify_auth_passes",
      type: "check_connectivity",
      description: "Verify API key authentication",
      instruction: "Send an authenticated request to the AI provider and check for 401/403 responses",
      confidence: "high",
      params: { endpoints: ["https://api.anthropic.com/v1/messages", "https://api.openai.com/v1/models"] },
      successCondition: "Authentication succeeds (no 401 or 403 response)",
    },
  ],
};

// ─── Plan generation ────────────────────────────────────────────

function generateVerificationPlan(diagnosisCode: string): VerificationStep[] {
  // Check for CFG-specific hardcoded steps first
  const cfgSteps = CFG_CHECKS[diagnosisCode];
  if (cfgSteps) {
    return cfgSteps;
  }

  // Find the disease definition
  const disease = MVP_DISEASES.find((d) => d.icd_ai_code === diagnosisCode);
  if (!disease) {
    return [];
  }

  const steps: VerificationStep[] = [];
  let stepIndex = 1;

  // Generate steps from vital sign thresholds
  const thresholds = disease.diagnostic_criteria.vital_sign_thresholds;
  for (const [key, thresholdValue] of Object.entries(thresholds)) {
    const check = THRESHOLD_CHECKS[key];
    if (check) {
      steps.push({
        id: `verify_${stepIndex++}`,
        type: check.type,
        description: check.description,
        instruction: check.instruction,
        confidence: check.confidence,
        params: { metric: check.paramKey, threshold: thresholdValue },
        successCondition: check.successCondition,
      });
    }
  }

  // Generate a supporting-symptom check if the disease has text-based symptoms
  if (disease.diagnostic_criteria.supporting_symptoms.length > 0) {
    steps.push({
      id: `verify_${stepIndex++}`,
      type: "custom",
      description: `Check for absence of ${disease.name} symptoms`,
      instruction: `Verify that the following symptoms are no longer present: ${disease.diagnostic_criteria.supporting_symptoms.slice(0, 3).join("; ")}`,
      confidence: "low",
      params: { symptoms: disease.diagnostic_criteria.supporting_symptoms },
      successCondition: "None of the supporting symptoms are actively observed",
    });
  }

  return steps;
}

// ─── Route ──────────────────────────────────────────────────────

const verifyRouter = new Hono();

verifyRouter.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      diseaseCode: string;
      evidence?: Evidence[];
    }>();

    const { diseaseCode } = body;

    if (!diseaseCode) {
      return c.json({ error: "diseaseCode is required" }, 400);
    }

    const disease = MVP_DISEASES.find((d) => d.icd_ai_code === diseaseCode);
    const steps = generateVerificationPlan(diseaseCode);

    return c.json({
      diseaseCode,
      diseaseName: disease?.name ?? "Unknown",
      steps,
    } satisfies VerificationPlanResponse);
  } catch (err) {
    return c.json(
      {
        error: "Invalid request body",
        details: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }
});

export default verifyRouter;
