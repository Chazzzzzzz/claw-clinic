import Anthropic from "@anthropic-ai/sdk";
import {
  MVP_DISEASES,
  STANDARD_PRESCRIPTIONS,
} from "@claw-clinic/shared";
import type { Evidence } from "@claw-clinic/shared";

export interface AIDiagnosisResult {
  icd_ai_code: string;
  name: string;
  confidence: number;
  severity: string;
  reasoning: string;
  differential: Array<{ icd_ai_code: string; name: string; confidence: number }>;
  treatmentSteps?: Array<{ action: string; description: string }>;
}

const SUBMIT_DIAGNOSIS_TOOL: Anthropic.Tool = {
  name: "submit_diagnosis",
  description:
    "Submit a structured diagnosis for the AI agent's issue. You MUST call this tool with your diagnosis.",
  input_schema: {
    type: "object" as const,
    properties: {
      icd_ai_code: {
        type: "string",
        description:
          "The ICD-AI disease code from the catalog, or a new code if no existing disease matches.",
      },
      name: {
        type: "string",
        description: "Human-readable disease name.",
      },
      confidence: {
        type: "number",
        description: "Confidence score between 0 and 1.",
      },
      severity: {
        type: "string",
        enum: ["Low", "Moderate", "High", "Critical"],
        description: "Severity of the diagnosed condition.",
      },
      reasoning: {
        type: "string",
        description:
          "Brief explanation of why this diagnosis was chosen, referencing the evidence.",
      },
      differential: {
        type: "array",
        items: {
          type: "object",
          properties: {
            icd_ai_code: { type: "string" },
            name: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["icd_ai_code", "name", "confidence"],
        },
        description: "Alternative diagnoses considered, ordered by confidence.",
      },
      treatment_steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            description: { type: "string" },
          },
          required: ["action", "description"],
        },
        description:
          "Treatment steps if the disease code is NOT in the known catalog. Omit if using a known disease code.",
      },
    },
    required: ["icd_ai_code", "name", "confidence", "severity", "reasoning", "differential"],
  },
};

function buildSystemPrompt(): string {
  const diseaseCatalog = MVP_DISEASES.map((d) => {
    const thresholds = Object.entries(d.diagnostic_criteria.vital_sign_thresholds)
      .map(([k, v]) => {
        const parts: string[] = [];
        if (v.min !== undefined) parts.push(`min=${v.min}`);
        if (v.max !== undefined) parts.push(`max=${v.max}`);
        return `${k}(${parts.join(",")})`;
      })
      .join(", ");
    return `- ${d.icd_ai_code} "${d.name}" [${d.severity}]: ${d.description.slice(0, 150)}... Thresholds: ${thresholds}. Supporting: ${d.diagnostic_criteria.supporting_symptoms.slice(0, 3).join("; ")}`;
  }).join("\n");

  const prescriptionSummary = STANDARD_PRESCRIPTIONS.map((p) => {
    const stepSummary = p.steps.map((s) => s.change.slice(0, 80)).join(" | ");
    return `- ${p.target_disease}: ${p.name} — ${stepSummary}`;
  }).join("\n");

  return `You are an AI agent diagnostician for the Claw Clinic system. You diagnose issues with AI coding agents (like Claude Code, Cursor, Copilot, etc).

## Known Disease Catalog (ICD-AI codes)
${diseaseCatalog}

## Standard Prescriptions (for known diseases)
${prescriptionSummary}

## Instructions
1. Analyze the evidence and symptoms provided.
2. Match against known diseases first. Use the exact ICD-AI code if a known disease matches.
3. If no known disease matches well, you may create a novel diagnosis with a descriptive code.
4. Always provide differential diagnoses — other conditions that could explain the symptoms.
5. Only include treatment_steps if the diagnosis uses a code NOT in the known catalog above.
6. Call the submit_diagnosis tool with your structured diagnosis. Do NOT respond with plain text.`;
}

function serializeEvidence(evidence: Evidence[], symptoms?: string): string {
  const parts: string[] = [];

  if (symptoms) {
    parts.push(`User-reported symptoms: "${symptoms}"`);
  }

  for (const ev of evidence) {
    switch (ev.type) {
      case "config":
        parts.push(`[Config] API key: ${ev.apiKey?.masked || "none"}, provider: ${ev.apiKey?.provider || "unknown"}, endpoint: ${ev.endpoint?.url || "default"}, reachable: ${ev.endpoint?.reachable ?? "unknown"}`);
        if (ev.errorLogs?.length) parts.push(`  Error logs: ${ev.errorLogs.join("; ")}`);
        break;
      case "connectivity":
        for (const p of ev.providers) {
          parts.push(`[Connectivity] ${p.name}: reachable=${p.reachable}, authStatus=${p.authStatus || "untested"}, latency=${p.latencyMs || "?"}ms`);
          if (p.error) parts.push(`  Error: ${p.error}`);
          if (p.authError) parts.push(`  Auth error: ${p.authError}`);
        }
        if (ev.gatewayReachable !== undefined) parts.push(`[Gateway] reachable=${ev.gatewayReachable}`);
        break;
      case "behavior":
        parts.push(`[Behavior] ${ev.description}`);
        if (ev.symptoms?.length) parts.push(`  Symptoms: ${ev.symptoms.join("; ")}`);
        break;
      case "log":
        if (ev.errorPatterns?.length) parts.push(`[Log errors] ${ev.errorPatterns.join("; ")}`);
        if (ev.entries?.length) parts.push(`[Log entries] ${ev.entries.slice(0, 10).join("; ")}`);
        break;
      case "environment":
        parts.push(`[Environment] OS: ${ev.os || "?"}, Node: ${ev.nodeVersion || "?"}, OpenClaw: ${ev.openclawVersion || "?"}`);
        break;
      case "runtime":
        if (ev.recentTraceStats) {
          const s = ev.recentTraceStats;
          parts.push(`[Runtime] steps=${s.totalSteps}, errors=${s.errorCount}, toolCalls=${s.toolCallCount}, toolSuccess=${s.toolSuccessCount}, loop=${s.loopDetected}, cost=$${s.totalCostUsd.toFixed(2)}`);
        }
        break;
    }
  }

  return parts.join("\n");
}

export async function aiDiagnose(
  evidence: Evidence[],
  symptoms?: string,
): Promise<AIDiagnosisResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  const userMessage = serializeEvidence(evidence, symptoms);
  if (!userMessage.trim()) return null;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: buildSystemPrompt(),
      tools: [SUBMIT_DIAGNOSIS_TOOL],
      tool_choice: { type: "tool", name: "submit_diagnosis" },
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract the tool use block
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse || toolUse.name !== "submit_diagnosis") return null;

    const input = toolUse.input as Record<string, unknown>;

    return {
      icd_ai_code: input.icd_ai_code as string,
      name: input.name as string,
      confidence: input.confidence as number,
      severity: input.severity as string,
      reasoning: input.reasoning as string,
      differential: (input.differential as Array<{ icd_ai_code: string; name: string; confidence: number }>) || [],
      treatmentSteps: input.treatment_steps as Array<{ action: string; description: string }> | undefined,
    };
  } catch {
    // AI unavailable — fall back to rule-based
    return null;
  }
}

// Re-export for testing
export { buildSystemPrompt as _buildSystemPrompt, serializeEvidence as _serializeEvidence };
