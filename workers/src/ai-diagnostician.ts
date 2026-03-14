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
  treatmentSteps?: Array<{ action: string; description: string; requiresUserInput: boolean }>;
  checks: Array<{ type: string; target: string; expect: string; label: string }>;
  fixes: Array<{ label: string; command: string; description: string }>;
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
            requires_user_input: {
              type: "boolean",
              description:
                "True if this step requires human action (e.g., changing a setting, approving a change, providing information). False if it can be verified or executed automatically.",
            },
          },
          required: ["action", "description", "requires_user_input"],
        },
        description:
          "Treatment steps if the disease code is NOT in the known catalog. REQUIRED for novel codes — include actionable steps the user can follow to resolve the issue.",
      },
      checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["check_config", "check_connectivity", "check_file", "check_process"] },
            target: { type: "string" },
            expect: { type: "string" },
            label: { type: "string" },
          },
          required: ["type", "target", "expect", "label"],
        },
        description: "2-5 checks for the plugin to run locally. Each check has a type (what to check), target (config key path, URL, file path, or process name), expect (expected good state like 'present', 'reachable', 'off', or a specific value), and label (human-readable like: sandbox.mode = \"off\").",
      },
      fixes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            command: { type: "string" },
            description: { type: "string" },
          },
          required: ["label", "command", "description"],
        },
        description: "2-3 concrete fix options. Each fix has a short label (under 40 chars), the exact terminal command to run (like 'openclaw config set sandbox.mode off'), and a 1-line description of what it does.",
      },
    },
    required: ["icd_ai_code", "name", "confidence", "severity", "reasoning", "differential", "checks", "fixes"],
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
3. If no known disease matches well, create a novel diagnosis with a descriptive code following the ICD-AI convention (Department.Number.Variant).
4. Always provide differential diagnoses — other conditions that could explain the symptoms.
5. Only include treatment_steps if the diagnosis uses a code NOT in the known catalog above. For novel codes, treatment_steps are REQUIRED — include actionable steps with requires_user_input set correctly.
6. Call the submit_diagnosis tool with your structured diagnosis. Do NOT respond with plain text.
7. Keep reasoning to exactly 1 sentence. No paragraphs.
8. Always include checks — 2-5 things the plugin should verify locally. Use exact config key paths (e.g., "sandbox.mode"), file paths (e.g., "~/.openclaw/openclaw.json"), and endpoint URLs. The label should show what the check verifies in human-readable form.
9. Always include fixes — 2-3 concrete fix options. Each MUST have a command field with the exact terminal command (prefer "openclaw config set ..." for config changes). Keep labels under 40 chars.

## Diagnostic Discriminators
- **Loop vs Hang**: An infinite loop (E.1.1) shows repeated tool calls with identical arguments (toolCallCount high, loopDetected=true). A hang shows a single call that never returns (toolCallCount=0, high latency, 0 tokens produced). Do not confuse waiting-for-response with looping.
- **Cost vs Latency**: Cost Explosion (C.1.1) is about monetary spend (high totalCostUsd, high totalTokens). Latency Arrhythmia (C.2.1) is about response time (high avgLatencyMs) regardless of cost.
- **Config vs Platform**: Config issues (CFG.*) are in the agent's own config files. Platform integration issues are about external platform settings (Discord intents, Telegram permissions, Node.js version requirements).`;
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
      model: "claude-opus-4-6",
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
      checks: (input.checks as Array<{ type: string; target: string; expect: string; label: string }>) || [],
      fixes: (input.fixes as Array<{ label: string; command: string; description: string }>) || [],
      treatmentSteps: (input.treatment_steps as Array<{ action: string; description: string; requires_user_input: boolean }> | undefined)
        ?.map((s) => ({ action: s.action, description: s.description, requiresUserInput: s.requires_user_input ?? false })),
    };
  } catch {
    // AI unavailable — fall back to rule-based
    return null;
  }
}

// Re-export for testing
export { buildSystemPrompt as _buildSystemPrompt, serializeEvidence as _serializeEvidence };
