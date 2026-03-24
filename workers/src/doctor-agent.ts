// Doctor Agent Worker (Layer 3)
// Deep AI-powered consultation — analyzes traces, detects patterns, generates tailored prescriptions.
// All diagnosis and treatment is AI-generated from evidence, not from a hardcoded catalog.

import Anthropic from "@anthropic-ai/sdk";
import {
  extractSymptomVector,
  computeVitals,
  createMinimalSymptomVector,
} from "@claw-clinic/shared";
import type {
  TraceRecord,
  SymptomVector,
} from "@claw-clinic/shared";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ConsultationRequest {
  case_summary: string;
  trace?: TraceRecord[];
  urgency: "IMMEDIATE" | "URGENT" | "STANDARD";
  preliminary_diagnosis?: {
    icd_ai_code: string;
    confidence: number;
  };
}

export interface ConsultationResponse {
  consultation_id: string;
  status: "completed";
  diagnosis: {
    primary: {
      icd_ai_code: string;
      disease_name: string;
      confidence: number;
      reasoning: string;
    } | null;
    differential: Array<{
      icd_ai_code: string;
      disease_name: string;
      confidence: number;
    }>;
    comorbidities: string[];
  };
  prescription: {
    id: string;
    name: string;
    custom_instructions: string;
    steps: Array<{ action: string; command: string; expected_output: string }>;
  } | null;
  risk_assessment: {
    severity: string;
    urgency: string;
    recommended_monitoring: string;
  };
  doctor_notes: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateConsultationId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `consult_${ts}${rand}`;
}

// ---- Sequence analysis ---------------------------------------------------

interface SequencePattern {
  kind: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
}

function analyzeSequences(trace: TraceRecord[]): SequencePattern[] {
  const patterns: SequencePattern[] = [];
  const toolCalls = trace.filter((t) => t.type === "tool_call");

  // 1. Consecutive identical tool calls (loop signature)
  let maxConsecutive = 1;
  let consecutiveToolName = "";
  for (let i = 1; i < toolCalls.length; i++) {
    if (toolCalls[i].content.tool_name === toolCalls[i - 1].content.tool_name) {
      maxConsecutive++;
      consecutiveToolName = toolCalls[i].content.tool_name ?? "";
    } else {
      if (maxConsecutive >= 3) {
        patterns.push({
          kind: "consecutive_repeat",
          description: `Tool "${consecutiveToolName}" called ${maxConsecutive} times consecutively`,
          severity: maxConsecutive >= 5 ? "critical" : "high",
        });
      }
      maxConsecutive = 1;
    }
  }
  if (maxConsecutive >= 3) {
    patterns.push({
      kind: "consecutive_repeat",
      description: `Tool "${consecutiveToolName}" called ${maxConsecutive} times consecutively`,
      severity: maxConsecutive >= 5 ? "critical" : "high",
    });
  }

  // 2. Error-then-retry pattern
  let retryAfterErrorCount = 0;
  for (let i = 0; i < trace.length - 2; i++) {
    if (
      trace[i].type === "tool_call" &&
      trace[i + 1].type === "error" &&
      trace[i + 2].type === "tool_call" &&
      trace[i + 2].content.tool_name === trace[i].content.tool_name
    ) {
      retryAfterErrorCount++;
    }
  }
  if (retryAfterErrorCount >= 2) {
    patterns.push({
      kind: "error_retry_loop",
      description: `Agent retried after error ${retryAfterErrorCount} times`,
      severity: retryAfterErrorCount >= 4 ? "critical" : "high",
    });
  }

  // 3. Behaviour shift after user input (injection signal)
  const userInputSteps = trace.filter((t) => t.type === "user_input");
  for (const uiStep of userInputSteps) {
    const afterIdx = trace.indexOf(uiStep) + 1;
    const before = trace.slice(0, afterIdx - 1);
    const after = trace.slice(afterIdx);
    const beforeTools = new Set(before.filter((t) => t.type === "tool_call").map((t) => t.content.tool_name));
    const afterTools = new Set(after.filter((t) => t.type === "tool_call").map((t) => t.content.tool_name));
    const newTools = [...afterTools].filter((t) => !beforeTools.has(t));
    if (newTools.length > 0 && before.length > 2) {
      patterns.push({
        kind: "behaviour_shift_after_input",
        description: `New tools appeared after user input: ${newTools.join(", ")}`,
        severity: "medium",
      });
    }
  }

  // 4. Escalating errors
  const halfIdx = Math.floor(toolCalls.length / 2);
  if (halfIdx > 0) {
    const firstHalfErrors = trace.slice(0, halfIdx).filter((t) => t.type === "error").length;
    const secondHalfErrors = trace.slice(halfIdx).filter((t) => t.type === "error").length;
    const firstHalfRate = firstHalfErrors / halfIdx;
    const secondHalfRate = secondHalfErrors / (trace.length - halfIdx);
    if (secondHalfRate > firstHalfRate * 2 && secondHalfRate > 0.1) {
      patterns.push({
        kind: "escalating_errors",
        description: `Error rate increased from ${(firstHalfRate * 100).toFixed(0)}% to ${(secondHalfRate * 100).toFixed(0)}%`,
        severity: secondHalfRate > 0.3 ? "high" : "medium",
      });
    }
  }

  return patterns;
}

// ---- Temporal analysis ---------------------------------------------------

interface TemporalInsight {
  worsening: boolean;
  description: string;
}

function analyzeTemporalTrends(trace: TraceRecord[]): TemporalInsight {
  if (trace.length < 4) {
    return { worsening: false, description: "Trace too short for temporal analysis." };
  }

  const quarterLen = Math.floor(trace.length / 4);
  const firstQuarter = trace.slice(0, quarterLen);
  const lastQuarter = trace.slice(-quarterLen);

  const errRate = (chunk: TraceRecord[]) => {
    const errs = chunk.filter((t) => t.type === "error").length;
    return chunk.length > 0 ? errs / chunk.length : 0;
  };

  const avgLatency = (chunk: TraceRecord[]) => {
    const latencies = chunk.map((t) => t.metrics.latency_ms).filter((l) => l > 0);
    return latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  };

  const earlyErr = errRate(firstQuarter);
  const lateErr = errRate(lastQuarter);
  const earlyLat = avgLatency(firstQuarter);
  const lateLat = avgLatency(lastQuarter);

  const parts: string[] = [];
  let worsening = false;

  if (lateErr > earlyErr * 1.5 && lateErr > 0.05) {
    parts.push(`Error rate worsened from ${(earlyErr * 100).toFixed(0)}% to ${(lateErr * 100).toFixed(0)}%.`);
    worsening = true;
  }
  if (lateLat > earlyLat * 2 && lateLat > 500) {
    parts.push(`Average latency rose from ${earlyLat.toFixed(0)}ms to ${lateLat.toFixed(0)}ms.`);
    worsening = true;
  }

  if (!worsening) {
    parts.push("No significant temporal degradation detected.");
  }

  return { worsening, description: parts.join(" ") };
}

// ---- AI consultation tool ------------------------------------------------

const CONSULT_TOOL: Anthropic.Tool = {
  name: "submit_consultation",
  description: "Submit deep consultation results with executable treatment commands.",
  input_schema: {
    type: "object" as const,
    properties: {
      icd_ai_code: { type: "string", description: "Diagnostic code in Department.Number.Variant format." },
      disease_name: { type: "string", description: "Disease name (2-5 words)." },
      confidence: { type: "number", description: "0-1 confidence." },
      severity: { type: "string", enum: ["Low", "Moderate", "High", "Critical"] },
      reasoning: { type: "string", description: "Detailed reasoning citing specific evidence." },
      differential: {
        type: "array",
        items: {
          type: "object",
          properties: {
            icd_ai_code: { type: "string" },
            disease_name: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["icd_ai_code", "disease_name", "confidence"],
        },
      },
      comorbidities: {
        type: "array",
        items: { type: "string" },
        description: "Co-occurring conditions with root cause ordering.",
      },
      prescription_name: { type: "string", description: "Treatment protocol name (2-5 words)." },
      prescription_steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string", description: "What this step does (2-5 words)." },
            command: { type: "string", description: "Exact shell command to run." },
            expected_output: { type: "string", description: "What stdout should contain on success." },
          },
          required: ["action", "command", "expected_output"],
        },
        description: "Ordered treatment steps. Every step MUST have an executable command.",
      },
      recommended_monitoring: { type: "string", description: "Follow-up monitoring schedule." },
    },
    required: ["icd_ai_code", "disease_name", "confidence", "severity", "reasoning", "differential", "comorbidities", "prescription_name", "prescription_steps", "recommended_monitoring"],
  },
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function processCaseConsultation(
  request: ConsultationRequest,
): Promise<ConsultationResponse> {
  const consultationId = generateConsultationId();
  const trace = request.trace ?? [];

  // 1. Extract symptom vector
  const symptomVector: SymptomVector =
    trace.length > 0
      ? extractSymptomVector(trace)
      : createMinimalSymptomVector(request.case_summary);

  // 2. Deep sequence analysis
  const sequences = analyzeSequences(trace);

  // 3. Temporal trend analysis
  const temporal = analyzeTemporalTrends(trace);

  // 4. Compute vitals
  const vitals = computeVitals(symptomVector);

  // 5. Build context for AI consultation
  const contextParts: string[] = [];
  contextParts.push(`Chief complaint: ${request.case_summary}`);
  contextParts.push(`Urgency: ${request.urgency}`);
  contextParts.push("");

  contextParts.push("--- Vital Signs ---");
  contextParts.push(`Token burn rate: ${vitals.token_burn_rate.toFixed(0)} tokens/min`);
  contextParts.push(`Tool success rate: ${(vitals.tool_success_rate * 100).toFixed(1)}%`);
  contextParts.push(`Loop diversity score: ${(vitals.loop_diversity_score * 100).toFixed(1)}%`);
  contextParts.push(`Latency P95: ${vitals.latency_p95_ms.toFixed(0)}ms`);
  contextParts.push(`Context utilization: ${(vitals.context_utilization * 100).toFixed(1)}%`);
  contextParts.push(`Error rate: ${(vitals.error_rate * 100).toFixed(1)}%`);
  contextParts.push(`Total cost: $${symptomVector.cost_total_usd.toFixed(4)}`);
  contextParts.push(`Step count: ${symptomVector.step_count}`);
  contextParts.push(`Loop count: ${symptomVector.loop_count}`);
  contextParts.push(`Unique tools: ${symptomVector.unique_tools}`);
  contextParts.push("");

  if (sequences.length > 0) {
    contextParts.push("--- Behavioural Patterns ---");
    for (const s of sequences) {
      contextParts.push(`[${s.severity.toUpperCase()}] ${s.description}`);
    }
    contextParts.push("");
  }

  contextParts.push("--- Temporal Analysis ---");
  contextParts.push(temporal.description);
  contextParts.push("");

  if (request.preliminary_diagnosis) {
    contextParts.push("--- Layer 2 Preliminary Diagnosis ---");
    contextParts.push(`Code: ${request.preliminary_diagnosis.icd_ai_code}, Confidence: ${(request.preliminary_diagnosis.confidence * 100).toFixed(0)}%`);
    contextParts.push("");
  }

  // 6. Call AI for deep consultation
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return buildFallbackResponse(consultationId, request, symptomVector, sequences, temporal);
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1536,
      system: `You are a senior diagnostic consultant for AI coding agents. You receive detailed vital signs, behavioural pattern analysis, and temporal trend data. Provide a deep diagnosis with executable treatment commands.

Rules:
1. ALL prescription_steps MUST have an executable shell command — no prose, no suggestions.
2. Analyze comorbidities: identify co-occurring conditions and which is the root cause.
3. If a Layer 2 preliminary diagnosis is provided, confirm or override it with reasoning.
4. Order treatment steps sequentially — each builds on the previous.
5. Use Department.Number.Variant format for ICD-AI codes (e.g., LOOP.1.1, CFG.2.1, CTX.1.1).

OpenClaw commands:
  sudo systemctl restart openclaw-gateway
  openclaw config set <key> <value>
  openclaw config get <key>
  openclaw health
  openclaw session reset
  openclaw cache clear
  journalctl -u openclaw-gateway --since "5 min ago"`,
      tools: [CONSULT_TOOL],
      tool_choice: { type: "tool", name: "submit_consultation" },
      messages: [{ role: "user", content: contextParts.join("\n") }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) {
      return buildFallbackResponse(consultationId, request, symptomVector, sequences, temporal);
    }

    const input = toolUse.input as Record<string, unknown>;

    const doctorNotes = buildDoctorNotes(request, symptomVector, sequences, temporal, input);

    return {
      consultation_id: consultationId,
      status: "completed",
      diagnosis: {
        primary: {
          icd_ai_code: input.icd_ai_code as string,
          disease_name: input.disease_name as string,
          confidence: input.confidence as number,
          reasoning: input.reasoning as string,
        },
        differential: (input.differential as Array<{ icd_ai_code: string; disease_name: string; confidence: number }>) || [],
        comorbidities: (input.comorbidities as string[]) || [],
      },
      prescription: {
        id: `rx_${consultationId}`,
        name: input.prescription_name as string,
        custom_instructions: input.reasoning as string,
        steps: (input.prescription_steps as Array<{ action: string; command: string; expected_output: string }>) || [],
      },
      risk_assessment: {
        severity: input.severity as string,
        urgency: request.urgency,
        recommended_monitoring: input.recommended_monitoring as string,
      },
      doctor_notes: doctorNotes,
    };
  } catch {
    return buildFallbackResponse(consultationId, request, symptomVector, sequences, temporal);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDoctorNotes(
  request: ConsultationRequest,
  symptomVector: SymptomVector,
  sequences: SequencePattern[],
  temporal: TemporalInsight,
  aiResult: Record<string, unknown>,
): string {
  const vitals = computeVitals(symptomVector);
  const sections: string[] = [];

  sections.push("=== Doctor Agent Consultation Notes ===");
  sections.push(`Urgency: ${request.urgency}`);
  sections.push(`Chief complaint: ${request.case_summary}`);
  sections.push("");

  sections.push("--- Vital Signs ---");
  sections.push(`Token burn rate: ${vitals.token_burn_rate.toFixed(0)} tokens/min`);
  sections.push(`Tool success rate: ${(vitals.tool_success_rate * 100).toFixed(1)}%`);
  sections.push(`Error rate: ${(vitals.error_rate * 100).toFixed(1)}%`);
  sections.push(`Total cost: $${symptomVector.cost_total_usd.toFixed(4)}`);
  sections.push(`Step count: ${symptomVector.step_count}`);
  sections.push("");

  if (sequences.length > 0) {
    sections.push("--- Behavioural Patterns ---");
    for (const s of sequences) {
      sections.push(`[${s.severity.toUpperCase()}] ${s.description}`);
    }
    sections.push("");
  }

  sections.push("--- Temporal Analysis ---");
  sections.push(temporal.description);
  sections.push("");

  sections.push("--- AI Diagnosis ---");
  sections.push(`${aiResult.icd_ai_code}: ${aiResult.disease_name}`);
  sections.push(`Confidence: ${((aiResult.confidence as number) * 100).toFixed(0)}%`);
  sections.push(`Reasoning: ${aiResult.reasoning}`);
  sections.push("");

  if (request.preliminary_diagnosis) {
    sections.push("--- Layer 2 Comparison ---");
    sections.push(`Preliminary: ${request.preliminary_diagnosis.icd_ai_code} at ${(request.preliminary_diagnosis.confidence * 100).toFixed(0)}%`);
    if (request.preliminary_diagnosis.icd_ai_code === aiResult.icd_ai_code) {
      sections.push("Layer 3 CONFIRMS the Layer 2 preliminary diagnosis.");
    } else {
      sections.push(`Layer 3 DISAGREES. Doctor Agent: ${aiResult.icd_ai_code}. Layer 2: ${request.preliminary_diagnosis.icd_ai_code}.`);
    }
    sections.push("");
  }

  sections.push("=== End of Consultation Notes ===");
  return sections.join("\n");
}

function buildFallbackResponse(
  consultationId: string,
  request: ConsultationRequest,
  symptomVector: SymptomVector,
  sequences: SequencePattern[],
  temporal: TemporalInsight,
): ConsultationResponse {
  // When AI is unavailable, return a basic analysis from the trace data
  const vitals = computeVitals(symptomVector);

  const issues: string[] = [];
  if (symptomVector.loop_count >= 3) issues.push("infinite loop detected");
  if (symptomVector.error_rate > 0.15) issues.push("high error rate");
  if (symptomVector.tool_success_rate < 0.5) issues.push("tool failures");
  if (symptomVector.cost_total_usd > 1.0) issues.push("cost explosion");
  if (symptomVector.context_utilization > 0.85) issues.push("context exhaustion");

  const reasoning = issues.length > 0
    ? `Trace analysis detected: ${issues.join(", ")}. ${temporal.description}`
    : `No clear issue detected from trace analysis. ${temporal.description}`;

  return {
    consultation_id: consultationId,
    status: "completed",
    diagnosis: {
      primary: issues.length > 0
        ? {
            icd_ai_code: "TRACE.1.1",
            disease_name: issues[0] || "Unknown Issue",
            confidence: 0.4,
            reasoning,
          }
        : null,
      differential: [],
      comorbidities: issues.length > 1 ? issues.slice(1) : [],
    },
    prescription: null,
    risk_assessment: {
      severity: temporal.worsening ? "High" : "Moderate",
      urgency: request.urgency,
      recommended_monitoring: "AI diagnostician unavailable. Run `openclaw health` and check ANTHROPIC_API_KEY.",
    },
    doctor_notes: `AI unavailable. Basic trace analysis: ${reasoning}\n\nRun: openclaw health\nRun: journalctl -u openclaw-gateway --since "5 min ago"`,
  };
}
