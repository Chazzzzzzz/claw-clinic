import Anthropic from "@anthropic-ai/sdk";
import {
  DiagnoseInputSchema,
  MVP_DISEASES,
  STANDARD_PRESCRIPTIONS,
} from "@claw-clinic/shared";
import { diagnose } from "../layer2/pattern-matcher.js";
import { normalizeTrace } from "../utils/normalize-trace.js";

// ─── Types ──────────────────────────────────────────────────────────────

interface TreatmentStep {
  step_number: number;
  action: string;
  description: string;
  target: string;
  payload: string;
  rationale: string;
  reversible: boolean;
}

interface OpusDiagnosis {
  analysis: string;
  root_cause: string;
  confidence: number;
  icd_ai_codes: string[];
  severity: string;
  treatment_plan: {
    summary_for_user: string;
    steps: TreatmentStep[];
    expected_outcome: string;
    risk_level: string;
    requires_user_approval: boolean;
  };
  resolved_confidence: number;
  needs_follow_up: boolean;
  follow_up_question?: string | null;
}

// ─── Opus call ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert AI agent diagnostician at Claw Clinic.
You receive a preliminary pattern-matching diagnosis and must provide a deeper analysis.

ICD-AI Disease Codes:
- E.1.1: Infinite Loop Syndrome — agent repeats same tool calls endlessly
- E.1.2: Oscillation Pattern — agent alternates between two approaches
- N.1.1: Confabulation — agent invents facts, URLs, files that don't exist
- N.1.2: Anchoring Bias — agent fixated on wrong initial approach
- C.1.1: Cost Explosion — excessive token/API spending
- C.2.1: Redundant Operations — repeated reads, duplicate searches
- O.1.1: Tool Failure Cascade — tools failing repeatedly
- M.1.1: Context Window Overflow — losing earlier instructions
- I.3.1: Skill Injection Risk — malicious content in skill/tool output
- P.1.1: Performance Degradation — slow responses, timeouts
- R.1.1: Reasoning Failure — incorrect logic, wrong conclusions

Treatment actions:
- inject_instruction: Directive text injected into the agent's reasoning. Payload MUST be specific and actionable.
- modify_config: Configuration change. Target = config path, Payload = the change.
- run_command: Shell command (safe, reversible only).
- disable_tool: Temporarily disable a tool by name.
- enable_tool: Re-enable a tool.
- manual: Instructions for the human user.

RULES:
- inject_instruction payloads must be SPECIFIC. Not "try something else" but "STOP calling Read on /x — it doesn't exist. Run ls /tmp/ instead."
- If the preliminary diagnosis looks correct, confirm it and add depth. If wrong, override it.
- Always provide at least one treatment step.

Respond ONLY with valid JSON matching this schema:
{
  "analysis": "2-3 sentence deep analysis",
  "root_cause": "The specific root cause",
  "confidence": 0.85,
  "icd_ai_codes": ["E.1.1"],
  "severity": "high",
  "treatment_plan": {
    "summary_for_user": "Plain-language explanation",
    "steps": [
      {
        "step_number": 1,
        "action": "inject_instruction",
        "description": "What this step does",
        "target": "agent_behavior",
        "payload": "THE EXACT INSTRUCTION",
        "rationale": "Why this helps",
        "reversible": true
      }
    ],
    "expected_outcome": "What should improve",
    "risk_level": "low",
    "requires_user_approval": false
  },
  "resolved_confidence": 0.8,
  "needs_follow_up": false,
  "follow_up_question": null
}`;

interface ExtraEvidence {
  severity?: string;
  onset?: string;
  config?: Record<string, unknown>;
  logs?: Array<{ timestamp: string; level: string; source: string; message: string }>;
  environment?: Record<string, unknown>;
  affected_tools?: string[];
  error_messages?: string[];
  previous_treatments?: string[];
  iteration_context?: string;
}

function buildPrompt(
  symptoms: string | undefined,
  framework: string | undefined,
  preliminary: Record<string, unknown>,
  traceSnippet: string | null,
  extra: ExtraEvidence,
): string {
  const parts: string[] = [];

  parts.push("## Preliminary Diagnosis (Layer 2 — Pattern Matching)");
  parts.push("```json");
  parts.push(JSON.stringify(preliminary, null, 2));
  parts.push("```");

  if (symptoms) {
    parts.push(`\n## Reported Symptoms\n${symptoms}`);
  }
  if (extra.severity) parts.push(`\nSeverity: ${extra.severity}`);
  if (extra.onset) parts.push(`Onset: ${extra.onset}`);
  if (framework) {
    parts.push(`\n## Framework\n${framework}`);
  }
  if (traceSnippet) {
    parts.push(`\n## Execution Trace\n${traceSnippet}`);
  }
  if (extra.affected_tools?.length) {
    parts.push(`\n## Affected Tools\n${extra.affected_tools.join(", ")}`);
  }
  if (extra.error_messages?.length) {
    parts.push(`\n## Error Messages\n${extra.error_messages.map((e) => `- ${e}`).join("\n")}`);
  }
  if (extra.config && Object.keys(extra.config).length > 0) {
    parts.push(`\n## Agent Configuration (sanitized)\n\`\`\`json\n${JSON.stringify(extra.config, null, 2).slice(0, 2000)}\n\`\`\``);
  }
  if (extra.logs?.length) {
    const logStr = extra.logs.slice(-30).map((l) => `[${l.level}] ${l.source}: ${l.message}`).join("\n");
    parts.push(`\n## Recent Logs (last ${Math.min(extra.logs.length, 30)})\n${logStr}`);
  }
  if (extra.environment && Object.keys(extra.environment).length > 0) {
    parts.push(`\n## Environment\n${JSON.stringify(extra.environment)}`);
  }
  if (extra.iteration_context) {
    parts.push(`\n## Iteration Context\n${extra.iteration_context}`);
  }
  if (extra.previous_treatments?.length) {
    parts.push(
      `\n## Previously Tried Treatments (FAILED — do NOT repeat these)\n${extra.previous_treatments.map((t) => `- ${t}`).join("\n")}\n\nYou MUST try a DIFFERENT approach.`,
    );
  }

  parts.push("\nProvide your in-depth diagnosis and treatment plan as JSON.");
  return parts.join("\n");
}

let _lastOpusError: string | undefined;

export function getLastOpusError(): string | undefined {
  return _lastOpusError;
}

async function callOpus(prompt: string): Promise<OpusDiagnosis | null> {
  _lastOpusError = undefined;

  if (!process.env.ANTHROPIC_API_KEY) {
    _lastOpusError = "ANTHROPIC_API_KEY not set";
    return null;
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : null;
    if (!text) return null;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as OpusDiagnosis;
    return {
      ...parsed,
      _tokens: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
      },
    } as OpusDiagnosis & { _tokens: { input: number; output: number } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    _lastOpusError = msg;
    console.error("[hz_diagnose] Opus call failed:", msg);
    return null;
  }
}

// ─── Trace snippet builder ──────────────────────────────────────────────

function summarizeTrace(
  trace: Array<Record<string, unknown>>,
): string {
  return trace
    .slice(-30)
    .map((t) => {
      const step = t.step_number ?? "?";
      const type = t.type ?? "unknown";
      const content = JSON.stringify(t.content ?? {}).slice(0, 200);
      const metrics = t.metrics as Record<string, number> | undefined;
      const cost = metrics?.cost_usd ? ` ($${metrics.cost_usd.toFixed(4)})` : "";
      return `[${step}] ${type}: ${content}${cost}`;
    })
    .join("\n");
}

// ─── Main handler ───────────────────────────────────────────────────────

export async function handleDiagnose(args: unknown): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  // Validate input
  const parsed = DiagnoseInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "INVALID_INPUT",
              message: parsed.error.message,
              details: parsed.error.issues,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  const { symptoms, framework } = parsed.data;
  const data = parsed.data as Record<string, unknown>;
  const trace = parsed.data.trace
    ? normalizeTrace(
        parsed.data.trace as unknown as Array<Record<string, unknown>>,
      )
    : undefined;

  const extra: ExtraEvidence = {
    severity: data.severity as string | undefined,
    onset: data.onset as string | undefined,
    config: data.config as Record<string, unknown> | undefined,
    logs: data.logs as ExtraEvidence["logs"],
    environment: data.environment as Record<string, unknown> | undefined,
    affected_tools: data.affected_tools as string[] | undefined,
    error_messages: data.error_messages as string[] | undefined,
    previous_treatments: data.previous_treatments as string[] | undefined,
    iteration_context: data.iteration_context as string | undefined,
  };

  // ── Step 1: Quick pattern matching (Layer 2) ──────────────────────
  const layer2 = diagnose({ symptoms, trace, framework }, MVP_DISEASES);

  // Build the prescription info from Layer 2
  let prescriptionId: string | null = null;
  let recommendedAction: string | null = null;

  if (layer2.primary) {
    const disease = MVP_DISEASES.find(
      (d) => d.icd_ai_code === layer2.primary!.icd_ai_code,
    );
    if (disease && disease.prescriptions.length > 0) {
      prescriptionId = disease.prescriptions[0];
      const prescription = STANDARD_PRESCRIPTIONS.find(
        (p) => p.id === prescriptionId,
      );
      if (prescription) {
        recommendedAction = `Call hz_treat with prescription_id "${prescriptionId}" and case_id "${layer2.case_id}" to apply the ${prescription.name}.`;
      }
    }
  }

  const preliminary = {
    case_id: layer2.case_id,
    primary: layer2.primary
      ? {
          icd_ai_code: layer2.primary.icd_ai_code,
          disease_name: layer2.primary.disease_name,
          confidence: layer2.primary.confidence,
          matched_thresholds: layer2.primary.matched_thresholds,
          matched_supporting: layer2.primary.matched_supporting,
        }
      : null,
    differential: layer2.differential.map((d) => ({
      icd_ai_code: d.icd_ai_code,
      disease_name: d.disease_name,
      confidence: d.confidence,
    })),
    triage_level: layer2.triage_level,
    symptom_vector: layer2.symptom_vector,
  };

  // ── Step 2: Deep analysis via Opus ────────────────────────────────
  const traceSnippet =
    trace && trace.length > 0
      ? summarizeTrace(trace as unknown as Array<Record<string, unknown>>)
      : null;
  const prompt = buildPrompt(symptoms, framework, preliminary, traceSnippet, extra);
  const opus = await callOpus(prompt);

  if (opus) {
    // Merge Layer 2 + Opus results
    const tokens = (opus as unknown as Record<string, unknown>)._tokens as
      | { input: number; output: number }
      | undefined;

    const response = {
      case_id: layer2.case_id,
      diagnosis: {
        primary: {
          icd_ai_code: opus.icd_ai_codes?.[0] ?? layer2.primary?.icd_ai_code ?? "UNKNOWN",
          disease_name:
            MVP_DISEASES.find((d) => d.icd_ai_code === opus.icd_ai_codes?.[0])
              ?.name ?? layer2.primary?.disease_name ?? "Unknown",
          confidence: opus.confidence,
          analysis: opus.analysis,
          root_cause: opus.root_cause,
        },
        differential: (opus.icd_ai_codes ?? []).slice(1).map((code) => ({
          icd_ai_code: code,
          disease_name:
            MVP_DISEASES.find((d) => d.icd_ai_code === code)?.name ?? "Unknown",
        })),
        layer2_preliminary: preliminary.primary,
      },
      triage_level:
        opus.severity === "critical"
          ? "RED"
          : opus.severity === "high"
            ? "ORANGE"
            : opus.severity === "medium"
              ? "YELLOW"
              : "BLUE",
      treatment_plan: opus.treatment_plan,
      prescription_id: prescriptionId,
      recommended_action:
        recommendedAction ??
        "No standard prescription. Follow the treatment plan steps above.",
      resolved_confidence: opus.resolved_confidence,
      needs_follow_up: opus.needs_follow_up,
      follow_up_question: opus.follow_up_question ?? undefined,
      tokens_used: tokens ? tokens.input + tokens.output : 0,
      analysis_method: "layer2+opus",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
    };
  }

  // ── Fallback: Layer 2 only (no API key or Opus unavailable) ───────
  const response = {
    case_id: layer2.case_id,
    diagnosis: {
      primary: layer2.primary
        ? {
            icd_ai_code: layer2.primary.icd_ai_code,
            disease_name: layer2.primary.disease_name,
            confidence: layer2.primary.confidence,
            matched_thresholds: layer2.primary.matched_thresholds,
            matched_supporting: layer2.primary.matched_supporting,
          }
        : null,
      differential: layer2.differential.map((d) => ({
        icd_ai_code: d.icd_ai_code,
        disease_name: d.disease_name,
        confidence: d.confidence,
      })),
    },
    triage_level: layer2.triage_level,
    recommended_action:
      recommendedAction ??
      "No standard treatment available. Consider calling hz_consult for specialist analysis.",
    prescription_id: prescriptionId,
    escalate_to_layer3: layer2.escalate_to_layer3,
    symptom_vector: layer2.symptom_vector,
    analysis_method: "layer2_only",
    note: _lastOpusError
      ? `Deep analysis failed: ${_lastOpusError}`
      : "Deep analysis unavailable — set ANTHROPIC_API_KEY for Opus-powered diagnosis.",
  };

  return {
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
