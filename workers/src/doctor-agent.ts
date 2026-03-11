// Doctor Agent Worker (Layer 3)
// Rule-based deep diagnosis — no external LLM API required.
// Analyzes traces, detects comorbidities, generates tailored prescriptions.

import {
  MVP_DISEASES,
  STANDARD_PRESCRIPTIONS,
  extractSymptomVector,
  matchDiseases,
  computeVitals,
  createMinimalSymptomVector,
} from "@claw-clinic/shared";
import type {
  TraceRecord,
  DiseaseRecord,
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
    steps: Array<{ action: string; detail: string }>;
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

  // 2. Error-then-retry pattern (same tool called after error)
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
      description: `Agent retried after error ${retryAfterErrorCount} times — likely stuck on a failing tool`,
      severity: retryAfterErrorCount >= 4 ? "critical" : "high",
    });
  }

  // 3. User-input followed by drastic behaviour change (injection signal)
  const userInputSteps = trace.filter((t) => t.type === "user_input");
  for (const uiStep of userInputSteps) {
    const afterIdx = trace.indexOf(uiStep) + 1;
    const before = trace.slice(0, afterIdx - 1);
    const after = trace.slice(afterIdx);
    const beforeTools = new Set(before.filter((t) => t.type === "tool_call").map((t) => t.content.tool_name));
    const afterTools = new Set(after.filter((t) => t.type === "tool_call").map((t) => t.content.tool_name));
    // If completely new tools appear after user input, flag it
    const newTools = [...afterTools].filter((t) => !beforeTools.has(t));
    if (newTools.length > 0 && before.length > 2) {
      patterns.push({
        kind: "behaviour_shift_after_input",
        description: `New tools appeared after user input: ${newTools.join(", ")}`,
        severity: "medium",
      });
    }
  }

  // 4. Escalating tool call failure — later calls fail more than earlier ones
  const halfIdx = Math.floor(toolCalls.length / 2);
  if (halfIdx > 0) {
    const firstHalfErrors = trace.slice(0, halfIdx).filter((t) => t.type === "error").length;
    const secondHalfErrors = trace.slice(halfIdx).filter((t) => t.type === "error").length;
    const firstHalfRate = firstHalfErrors / halfIdx;
    const secondHalfRate = secondHalfErrors / (trace.length - halfIdx);
    if (secondHalfRate > firstHalfRate * 2 && secondHalfRate > 0.1) {
      patterns.push({
        kind: "escalating_errors",
        description: `Error rate increased from ${(firstHalfRate * 100).toFixed(0)}% to ${(secondHalfRate * 100).toFixed(0)}% in the second half of the trace`,
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

// ---- Comorbidity detection -----------------------------------------------

function detectComorbidities(
  symptomVector: SymptomVector,
  caseSummary: string,
): string[] {
  const candidates = matchDiseases(symptomVector, MVP_DISEASES, {
    symptoms_text: caseSummary,
  });

  // Return all diseases that exceed a meaningful confidence threshold
  const comorbid = candidates.filter((c) => c.confidence >= 0.25);
  if (comorbid.length <= 1) return [];

  // Known comorbidity pairs
  const knownPairs: Array<[string, string, string]> = [
    ["E.1.1", "C.1.1", "Infinite loops cause cost explosion — the loop is the root cause"],
    ["O.1.1", "E.1.1", "Tool failures can trigger retry loops — repair tools first"],
    ["N.2.1", "N.1.1", "Context rot can cause confabulation — treat context management first"],
    ["I.1.1", "I.3.2", "Prompt injection may lead to credential exposure — secure inputs first"],
  ];

  const codes = new Set(comorbid.map((c) => c.icd_ai_code));
  const found: string[] = [];
  for (const [a, b, note] of knownPairs) {
    if (codes.has(a) && codes.has(b)) {
      found.push(`${a} + ${b}: ${note}`);
    }
  }

  // Also list the codes themselves
  if (comorbid.length > 1 && found.length === 0) {
    found.push(
      `Multiple conditions detected: ${comorbid.map((c) => `${c.icd_ai_code} (${c.disease_name})`).join(", ")}`,
    );
  }

  return found;
}

// ---- Root cause analysis -------------------------------------------------

function rootCauseAnalysis(
  symptomVector: SymptomVector,
  sequences: SequencePattern[],
  temporal: TemporalInsight,
  caseSummary: string,
): string {
  const parts: string[] = [];

  // Loop → cost root cause
  if (symptomVector.loop_count >= 3 && symptomVector.cost_total_usd > 1.0) {
    parts.push(
      "The cost explosion appears to be driven by an infinite loop — each iteration burns additional tokens. Stopping the loop should stop the cost bleed.",
    );
  }

  // Tool failure → loop root cause
  if (symptomVector.tool_success_rate < 0.5 && symptomVector.loop_count >= 2) {
    parts.push(
      "The agent is looping because its tools are failing and it keeps retrying. The root cause is the tool failure, not the loop itself.",
    );
  }

  // Context rot → confabulation root cause
  if (symptomVector.context_utilization > 0.85 && symptomVector.output_diversity_score < 0.4) {
    parts.push(
      "High context utilization is degrading output quality. The agent may be losing earlier instructions, leading to repetitive or confabulated outputs.",
    );
  }

  // Sequence-based root causes
  const errorRetry = sequences.find((s) => s.kind === "error_retry_loop");
  if (errorRetry) {
    parts.push(
      "Error-retry pattern detected: the agent is retrying the same failing operation instead of pivoting. This compounds both error rate and cost.",
    );
  }

  // Temporal worsening
  if (temporal.worsening) {
    parts.push(`Temporal trend: ${temporal.description}`);
  }

  // Text-based root cause hints
  const lower = caseSummary.toLowerCase();
  if (lower.includes("stuck") || lower.includes("frozen")) {
    parts.push("The agent appears stuck — likely requires external intervention or a task restart.");
  }
  if (lower.includes("wrong output") || lower.includes("incorrect")) {
    parts.push("Output quality issues suggest the agent may be hallucinating or using stale context.");
  }

  if (parts.length === 0) {
    parts.push("No single dominant root cause identified. The symptoms may be independent or caused by an external factor not visible in the trace.");
  }

  return parts.join(" ");
}

// ---- Reasoning generator -------------------------------------------------

function generateReasoning(
  disease: DiseaseRecord,
  symptomVector: SymptomVector,
  matchedThresholds: string[],
  sequences: SequencePattern[],
  temporal: TemporalInsight,
): string {
  const parts: string[] = [];
  parts.push(`Diagnosis: ${disease.name} (${disease.icd_ai_code}).`);
  parts.push(`Department: ${disease.department}. Severity: ${disease.severity}.`);

  if (matchedThresholds.length > 0) {
    parts.push(`Key vital signs that triggered this diagnosis: ${matchedThresholds.join(", ")}.`);
  }

  // Add specific numeric evidence
  const evidence: string[] = [];
  if (matchedThresholds.includes("loop_count")) {
    evidence.push(`loop_count=${symptomVector.loop_count}`);
  }
  if (matchedThresholds.includes("error_rate")) {
    evidence.push(`error_rate=${(symptomVector.error_rate * 100).toFixed(1)}%`);
  }
  if (matchedThresholds.includes("tool_success_rate")) {
    evidence.push(`tool_success_rate=${(symptomVector.tool_success_rate * 100).toFixed(1)}%`);
  }
  if (matchedThresholds.includes("cost_total_usd")) {
    evidence.push(`cost=$${symptomVector.cost_total_usd.toFixed(2)}`);
  }
  if (matchedThresholds.includes("context_utilization")) {
    evidence.push(`context_utilization=${(symptomVector.context_utilization * 100).toFixed(1)}%`);
  }
  if (matchedThresholds.includes("step_count")) {
    evidence.push(`step_count=${symptomVector.step_count}`);
  }
  if (matchedThresholds.includes("token_velocity")) {
    evidence.push(`token_velocity=${symptomVector.token_velocity.toFixed(0)} tokens/min`);
  }
  if (matchedThresholds.includes("output_diversity_score")) {
    evidence.push(`output_diversity=${(symptomVector.output_diversity_score * 100).toFixed(1)}%`);
  }
  if (evidence.length > 0) {
    parts.push(`Measured values: ${evidence.join(", ")}.`);
  }

  // Sequence evidence
  const relevantPatterns = sequences.filter((s) => s.severity === "high" || s.severity === "critical");
  if (relevantPatterns.length > 0) {
    parts.push(`Behavioural patterns observed: ${relevantPatterns.map((p) => p.description).join("; ")}.`);
  }

  // Temporal
  if (temporal.worsening) {
    parts.push(`Temporal analysis: ${temporal.description}`);
  }

  parts.push(`Medical analogy: ${disease.medical_analogy.human_disease} — ${disease.medical_analogy.explanation}`);

  return parts.join(" ");
}

// ---- Custom prescription generation --------------------------------------

function generateCustomPrescription(
  disease: DiseaseRecord,
  symptomVector: SymptomVector,
  sequences: SequencePattern[],
  comorbidities: string[],
): {
  id: string;
  name: string;
  custom_instructions: string;
  steps: Array<{ action: string; detail: string }>;
} | null {
  // Find the standard prescription for this disease
  const rxId = disease.prescriptions[0];
  const standardRx = STANDARD_PRESCRIPTIONS.find((p) => p.id === rxId);
  if (!standardRx) return null;

  // Build custom instructions based on specific findings
  const customParts: string[] = [];

  // Tailor instructions to measured values
  switch (disease.icd_ai_code) {
    case "E.1.1": {
      const repeatPattern = sequences.find((s) => s.kind === "consecutive_repeat");
      if (repeatPattern) {
        customParts.push(repeatPattern.description + ".");
      }
      customParts.push(
        `Detected ${symptomVector.loop_count} loop(s). Immediately stop calling the repeated tool.`,
      );
      if (symptomVector.cost_total_usd > 0.5) {
        customParts.push(
          `This loop has already cost $${symptomVector.cost_total_usd.toFixed(2)}. Each additional iteration wastes tokens.`,
        );
      }
      break;
    }
    case "N.1.1": {
      customParts.push(
        `Tool success rate is ${(symptomVector.tool_success_rate * 100).toFixed(0)}%. Cross-reference every claim against actual tool results.`,
      );
      break;
    }
    case "N.2.1": {
      customParts.push(
        `Context utilization at ${(symptomVector.context_utilization * 100).toFixed(0)}%. Summarise progress immediately and discard verbose intermediate outputs.`,
      );
      if (symptomVector.step_count > 40) {
        customParts.push(`After ${symptomVector.step_count} steps, consider restarting with a fresh context window.`);
      }
      break;
    }
    case "C.1.1": {
      customParts.push(
        `Total cost: $${symptomVector.cost_total_usd.toFixed(2)}. Token velocity: ${symptomVector.token_velocity.toFixed(0)} tokens/min.`,
      );
      if (symptomVector.loop_count >= 2) {
        customParts.push("Cost is being driven by a loop — resolve the loop first to stop the cost bleed.");
      }
      customParts.push("Limit remaining tool calls to essential ones only.");
      break;
    }
    case "O.1.1": {
      customParts.push(
        `Tool success rate: ${(symptomVector.tool_success_rate * 100).toFixed(0)}%. Error rate: ${(symptomVector.error_rate * 100).toFixed(0)}%.`,
      );
      customParts.push(
        "Review error messages from recent failures. Do not retry with identical arguments — change something meaningful.",
      );
      break;
    }
    case "I.1.1": {
      customParts.push("A behaviour change was detected that may indicate prompt injection.");
      customParts.push("Verify that all actions align with the original system prompt and task.");
      break;
    }
    case "I.3.1": {
      customParts.push("Audit all installed tools and plugins. Remove any from unverified sources.");
      break;
    }
    case "I.3.2": {
      customParts.push("Rotate all exposed credentials immediately. Move to environment variables.");
      break;
    }
    case "M.1.1": {
      customParts.push(
        `${symptomVector.step_count} steps recorded. Verify that handoff messages include full task context, constraints, and prior decisions.`,
      );
      break;
    }
    case "P.1.1": {
      customParts.push(
        "Verify outputs against objective data. Push back when accuracy conflicts with agreeableness.",
      );
      break;
    }
    default:
      break;
  }

  // Comorbidity-specific adjustments
  if (comorbidities.length > 0) {
    customParts.push(
      `Note: comorbid conditions detected. ${comorbidities[0]}. Treat the root-cause condition first.`,
    );
  }

  // Build simplified steps from the standard prescription
  const steps = standardRx.steps.map((s) => ({
    action: s.action,
    detail: s.change,
  }));

  return {
    id: standardRx.id,
    name: standardRx.name,
    custom_instructions: customParts.join(" "),
    steps,
  };
}

// ---- Risk assessment -----------------------------------------------------

function assessRisk(
  disease: DiseaseRecord | undefined,
  symptomVector: SymptomVector,
  temporal: TemporalInsight,
  urgency: ConsultationRequest["urgency"],
): {
  severity: string;
  urgency: string;
  recommended_monitoring: string;
} {
  const severity = disease?.severity ?? "Unknown";

  let monitoringSchedule: string;
  if (severity === "Critical" || urgency === "IMMEDIATE") {
    monitoringSchedule =
      "Continuous monitoring recommended. Re-check vitals after every 5 tool calls. Follow-up checks at T+1h, T+4h, T+24h.";
  } else if (severity === "High" || urgency === "URGENT") {
    monitoringSchedule =
      "Monitor after treatment application. Follow-up checks at T+24h, T+48h, T+72h.";
  } else {
    monitoringSchedule =
      "Standard follow-up schedule: T+24h, T+48h, T+72h. No continuous monitoring required.";
  }

  if (temporal.worsening) {
    monitoringSchedule += " ALERT: Condition is worsening over time — increase monitoring frequency.";
  }

  return {
    severity,
    urgency,
    recommended_monitoring: monitoringSchedule,
  };
}

// ---- Doctor notes generator ----------------------------------------------

function generateDoctorNotes(
  request: ConsultationRequest,
  symptomVector: SymptomVector,
  sequences: SequencePattern[],
  temporal: TemporalInsight,
  comorbidities: string[],
  rootCause: string,
  primaryDisease: DiseaseRecord | undefined,
): string {
  const sections: string[] = [];

  // Header
  sections.push(`=== Doctor Agent Consultation Notes ===`);
  sections.push(`Urgency: ${request.urgency}`);
  sections.push(`Chief complaint: ${request.case_summary}`);
  sections.push("");

  // Vitals summary
  const vitals = computeVitals(symptomVector);
  sections.push("--- Vital Signs ---");
  sections.push(`Token burn rate: ${vitals.token_burn_rate.toFixed(0)} tokens/min`);
  sections.push(`Tool success rate: ${(vitals.tool_success_rate * 100).toFixed(1)}%`);
  sections.push(`Loop diversity score: ${(vitals.loop_diversity_score * 100).toFixed(1)}%`);
  sections.push(`Latency P95: ${vitals.latency_p95_ms.toFixed(0)}ms`);
  sections.push(`Context utilization: ${(vitals.context_utilization * 100).toFixed(1)}%`);
  sections.push(`Error rate: ${(vitals.error_rate * 100).toFixed(1)}%`);
  sections.push(`Total cost: $${symptomVector.cost_total_usd.toFixed(4)}`);
  sections.push(`Step count: ${symptomVector.step_count}`);
  sections.push("");

  // Sequence findings
  if (sequences.length > 0) {
    sections.push("--- Behavioural Patterns ---");
    for (const s of sequences) {
      sections.push(`[${s.severity.toUpperCase()}] ${s.description}`);
    }
    sections.push("");
  }

  // Temporal analysis
  sections.push("--- Temporal Analysis ---");
  sections.push(temporal.description);
  sections.push("");

  // Comorbidities
  if (comorbidities.length > 0) {
    sections.push("--- Comorbidities ---");
    for (const c of comorbidities) {
      sections.push(`- ${c}`);
    }
    sections.push("");
  }

  // Root cause
  sections.push("--- Root Cause Analysis ---");
  sections.push(rootCause);
  sections.push("");

  // Primary diagnosis
  if (primaryDisease) {
    sections.push("--- Diagnosis ---");
    sections.push(`${primaryDisease.icd_ai_code}: ${primaryDisease.name}`);
    sections.push(`Progression if untreated: ${primaryDisease.progression}`);
    sections.push("");
  }

  // Preliminary diagnosis comparison
  if (request.preliminary_diagnosis) {
    sections.push("--- Layer 2 Comparison ---");
    sections.push(
      `Preliminary (Layer 2): ${request.preliminary_diagnosis.icd_ai_code} at ${(request.preliminary_diagnosis.confidence * 100).toFixed(0)}% confidence.`,
    );
    if (primaryDisease) {
      if (request.preliminary_diagnosis.icd_ai_code === primaryDisease.icd_ai_code) {
        sections.push("Layer 3 CONFIRMS the Layer 2 preliminary diagnosis.");
      } else {
        sections.push(
          `Layer 3 DISAGREES with Layer 2. Doctor Agent diagnosis: ${primaryDisease.icd_ai_code}. Layer 2 preliminary: ${request.preliminary_diagnosis.icd_ai_code}. The deeper analysis revealed different underlying patterns.`,
        );
      }
    }
    sections.push("");
  }

  sections.push("=== End of Consultation Notes ===");
  return sections.join("\n");
}

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

  // 4. Disease matching (with text context)
  const candidates = matchDiseases(symptomVector, MVP_DISEASES, {
    symptoms_text: request.case_summary,
  });

  // Boost confidence based on sequence pattern evidence
  for (const candidate of candidates) {
    let boost = 0;
    // Loop diseases get boosted if sequence analysis confirms loops
    if (candidate.icd_ai_code === "E.1.1" && sequences.some((s) => s.kind === "consecutive_repeat")) {
      boost += 0.1;
    }
    // Tool fracture boosted by error-retry pattern
    if (candidate.icd_ai_code === "O.1.1" && sequences.some((s) => s.kind === "error_retry_loop")) {
      boost += 0.1;
    }
    // Context rot boosted by escalating errors
    if (candidate.icd_ai_code === "N.2.1" && sequences.some((s) => s.kind === "escalating_errors")) {
      boost += 0.08;
    }
    // Injection boosted by behaviour shift
    if (candidate.icd_ai_code === "I.1.1" && sequences.some((s) => s.kind === "behaviour_shift_after_input")) {
      boost += 0.12;
    }
    // Temporal worsening increases confidence
    if (temporal.worsening) {
      boost += 0.05;
    }

    candidate.confidence = Math.min(1, candidate.confidence + boost);
  }

  // Re-sort after boosting
  candidates.sort((a, b) => b.confidence - a.confidence);

  const primary = candidates.length > 0 ? candidates[0] : null;
  const differential = candidates.slice(1, 4);
  const primaryDisease = primary
    ? MVP_DISEASES.find((d) => d.icd_ai_code === primary.icd_ai_code)
    : undefined;

  // 5. Comorbidity detection
  const comorbidities = detectComorbidities(symptomVector, request.case_summary);

  // 6. Root cause analysis
  const rootCause = rootCauseAnalysis(symptomVector, sequences, temporal, request.case_summary);

  // 7. Generate reasoning
  const reasoning = primary && primaryDisease
    ? generateReasoning(primaryDisease, symptomVector, primary.matched_thresholds, sequences, temporal)
    : "No confident diagnosis could be made. The trace may be too short or the symptoms may not match any known disease pattern. Consider providing a longer trace or more detailed symptom description.";

  // 8. Generate custom prescription
  const prescription =
    primary && primaryDisease
      ? generateCustomPrescription(primaryDisease, symptomVector, sequences, comorbidities)
      : null;

  // 9. Risk assessment
  const risk = assessRisk(primaryDisease, symptomVector, temporal, request.urgency);

  // 10. Doctor notes
  const doctorNotes = generateDoctorNotes(
    request,
    symptomVector,
    sequences,
    temporal,
    comorbidities,
    rootCause,
    primaryDisease,
  );

  return {
    consultation_id: consultationId,
    status: "completed",
    diagnosis: {
      primary: primary
        ? {
            icd_ai_code: primary.icd_ai_code,
            disease_name: primary.disease_name,
            confidence: primary.confidence,
            reasoning,
          }
        : null,
      differential: differential.map((d) => ({
        icd_ai_code: d.icd_ai_code,
        disease_name: d.disease_name,
        confidence: d.confidence,
      })),
      comorbidities,
    },
    prescription,
    risk_assessment: risk,
    doctor_notes: doctorNotes,
  };
}

