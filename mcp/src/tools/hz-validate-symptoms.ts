/**
 * hz_validate_symptoms — Quick symptom pre-check
 *
 * Validates whether a symptom description is actionable before collecting
 * full evidence. Uses keyword matching against known disease patterns +
 * optional trace anomaly detection. No API call — purely algorithmic.
 */

import {
  MVP_DISEASES,
  type TraceRecord,
} from "@claw-clinic/shared";
import { runImmuneSystem } from "../layer1/immune-system.js";
import { normalizeTrace } from "../utils/normalize-trace.js";

interface ValidateInput {
  symptoms: string;
  trace?: unknown[];
  config?: {
    budget_ceiling_usd?: number;
    context_window_size?: number;
  };
}

interface ValidationResult {
  is_valid: boolean;
  clarification_needed: boolean;
  clarification_question?: string;
  detected_conditions: string[];
  anomalies_from_trace: number;
  triage_hint?: string;
}

// Keywords derived from disease descriptions for quick matching
const SYMPTOM_KEYWORDS: Record<string, string[]> = {};
for (const disease of MVP_DISEASES) {
  const words = disease.description.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  if (words.length > 0) {
    SYMPTOM_KEYWORDS[disease.icd_ai_code] = words;
  }
}

// Common symptom phrases that map to disease categories
const PHRASE_MAP: Array<{ phrases: string[]; code: string; name: string }> = [
  { phrases: ["loop", "stuck", "repeating", "same tool", "over and over", "infinite", "cycling"], code: "E.1.1", name: "Infinite Loop" },
  { phrases: ["hallucin", "making up", "fake url", "invented", "doesn't exist", "fabricat", "confabul"], code: "N.1.1", name: "Confabulation" },
  { phrases: ["cost", "expensive", "spending", "budget", "token burn", "too many tokens"], code: "C.1.1", name: "Cost Explosion" },
  { phrases: ["tool fail", "error", "permission denied", "crash", "broken tool", "keeps failing"], code: "O.1.1", name: "Tool Failure" },
  { phrases: ["context", "forgot", "lost track", "memory", "window full", "truncat"], code: "M.1.1", name: "Context Overflow" },
  { phrases: ["slow", "latency", "timeout", "hanging", "unresponsive"], code: "P.1.1", name: "Performance" },
  { phrases: ["wrong", "incorrect", "logic error", "confused", "nonsense", "misunderstand"], code: "R.1.1", name: "Reasoning Failure" },
  { phrases: ["inject", "prompt injection", "untrusted", "malicious"], code: "I.3.1", name: "Injection Risk" },
];

export async function handleValidateSymptoms(
  args: ValidateInput,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const symptoms = args.symptoms?.trim() ?? "";

  // Rule 1: Too short to be actionable
  if (symptoms.length < 10) {
    return result({
      is_valid: false,
      clarification_needed: true,
      clarification_question: "Can you describe the problem in more detail? What specific behavior is your agent exhibiting? Include any error messages you've seen.",
      detected_conditions: [],
      anomalies_from_trace: 0,
    });
  }

  // Rule 2: Match against known disease phrases
  const symptomsLower = symptoms.toLowerCase();
  const detected: Array<{ code: string; name: string }> = [];

  for (const entry of PHRASE_MAP) {
    if (entry.phrases.some((p) => symptomsLower.includes(p))) {
      detected.push({ code: entry.code, name: entry.name });
    }
  }

  // Rule 3: If trace provided, run immune system for anomaly detection
  let anomalyCount = 0;
  let triageHint: string | undefined;

  if (args.trace && args.trace.length > 0) {
    try {
      const normalized = normalizeTrace(args.trace as unknown as Array<Record<string, unknown>>);
      const report = runImmuneSystem(normalized, {
        budget_ceiling_usd: args.config?.budget_ceiling_usd,
        context_window_size: args.config?.context_window_size,
      });
      anomalyCount = report.anomalies.length;
      triageHint = report.triage_level;

      // Add detected anomaly types to conditions
      for (const anomaly of report.anomalies) {
        const code = anomalyTypeToCode(anomaly.type);
        if (code && !detected.some((d) => d.code === code)) {
          detected.push({ code, name: anomaly.type });
        }
      }
    } catch {
      // Trace parsing failed — continue without it
    }
  }

  // Rule 4: No matches at all — might be valid but unclear
  if (detected.length === 0 && anomalyCount === 0) {
    // If description is long enough, accept it but flag for follow-up
    if (symptoms.length >= 30) {
      return result({
        is_valid: true,
        clarification_needed: false,
        detected_conditions: [],
        anomalies_from_trace: 0,
        triage_hint: "BLUE",
      });
    }

    return result({
      is_valid: false,
      clarification_needed: true,
      clarification_question: "I wasn't able to match your description to a known agent issue. Could you provide more specifics? For example: Is the agent repeating actions? Producing wrong output? Running up costs? Failing on specific tools?",
      detected_conditions: [],
      anomalies_from_trace: 0,
    });
  }

  return result({
    is_valid: true,
    clarification_needed: false,
    detected_conditions: detected.map((d) => `${d.code} (${d.name})`),
    anomalies_from_trace: anomalyCount,
    triage_hint: triageHint ?? (detected.length > 1 ? "ORANGE" : "YELLOW"),
  });
}

function anomalyTypeToCode(type: string): string | null {
  const map: Record<string, string> = {
    LOOP_DETECTED: "E.1.1",
    LOW_DIVERSITY: "E.1.1",
    COST_OVERRUN: "C.1.1",
    HIGH_TOKEN_BURN: "C.1.1",
    HIGH_ERROR_RATE: "O.1.1",
    TOOL_FAILURE: "O.1.1",
    CONTEXT_PRESSURE: "M.1.1",
    HIGH_LATENCY: "P.1.1",
  };
  return map[type] ?? null;
}

function result(data: ValidationResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
