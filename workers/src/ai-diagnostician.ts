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
    "Submit a structured diagnosis. You MUST call this tool.",
  input_schema: {
    type: "object" as const,
    properties: {
      icd_ai_code: {
        type: "string",
        description:
          "ICD-AI code from catalog, or new Department.Number.Variant code.",
      },
      name: {
        type: "string",
        description: "Disease name (2-5 words).",
      },
      confidence: {
        type: "number",
        description: "0-1 confidence score.",
      },
      severity: {
        type: "string",
        enum: ["Low", "Moderate", "High", "Critical"],
      },
      reasoning: {
        type: "string",
        description: "1 sentence explaining the diagnosis.",
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
        description: "Top 2-3 alternative diagnoses.",
      },
      treatment_steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            description: { type: "string" },
            requires_user_input: { type: "boolean" },
          },
          required: ["action", "description", "requires_user_input"],
        },
        description: "ONLY for novel codes not in catalog. Max 3 steps.",
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
        description: "2-4 local checks. Use exact config keys, file paths, URLs.",
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
        description: "2-3 fix options with exact terminal commands.",
      },
    },
    required: ["icd_ai_code", "name", "confidence", "severity", "reasoning", "differential", "checks", "fixes"],
  },
};

// Cache the system prompt — disease catalog is static
let _cachedSystemPrompt: string | undefined;

function buildSystemPrompt(): string {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;

  // Compact disease catalog: code, name, severity, top 3 symptoms
  const diseaseCatalog = MVP_DISEASES.map((d) => {
    const symptoms = d.diagnostic_criteria.supporting_symptoms.slice(0, 3).join("; ");
    return `${d.icd_ai_code} "${d.name}" [${d.severity}]: ${symptoms}`;
  }).join("\n");

  // Compact prescriptions: code → step count
  const prescriptionCodes = STANDARD_PRESCRIPTIONS.map((p) =>
    `${p.target_disease}(${p.steps.length} steps)`
  ).join(", ");

  _cachedSystemPrompt = `You diagnose AI coding agent issues (Claude Code, Cursor, Copilot, etc).

## Disease Catalog
${diseaseCatalog}

## Diseases with standard prescriptions
${prescriptionCodes}

## Rules
1. Match known diseases first. Use exact ICD-AI code.
2. Novel codes: use Department.Number.Variant format, include treatment_steps (max 3).
3. reasoning: exactly 1 sentence.
4. checks: 2-4 items with exact config key paths, file paths, or URLs.
5. fixes: 2-3 options with exact terminal commands (prefer "openclaw config set ...").
6. differential: top 2-3 alternatives only.
7. Do NOT include treatment_steps for known catalog codes.

## Key Distinctions
- Loop (E.1.1): repeated identical tool calls. Hang: single call never returns.
- Cost (C.1.1): high spend/tokens. Latency (C.2.1): slow response time.
- Config (CFG.*): agent config files. Platform: external platform settings.`;

  return _cachedSystemPrompt;
}

function serializeEvidence(evidence: Evidence[], symptoms?: string): string {
  const parts: string[] = [];

  if (symptoms) {
    parts.push(`Symptoms: "${symptoms}"`);
  }

  for (const ev of evidence) {
    switch (ev.type) {
      case "config":
        parts.push(`[Config] key=${ev.apiKey?.masked || "none"} provider=${ev.apiKey?.provider || "?"} endpoint=${ev.endpoint?.url || "default"}`);
        if (ev.errorLogs?.length) parts.push(`  Errors: ${ev.errorLogs.slice(0, 3).join("; ")}`);
        break;
      case "connectivity":
        for (const p of ev.providers) {
          parts.push(`[Conn] ${p.name}: reachable=${p.reachable} auth=${p.authStatus || "?"} latency=${p.latencyMs || "?"}ms${p.authError ? ` err="${p.authError}"` : ""}`);
        }
        break;
      case "behavior":
        parts.push(`[Behavior] ${ev.description}`);
        if (ev.symptoms?.length) parts.push(`  ${ev.symptoms.slice(0, 5).join("; ")}`);
        break;
      case "log":
        if (ev.errorPatterns?.length) parts.push(`[Logs] ${ev.errorPatterns.slice(0, 5).join("; ")}`);
        break;
      case "environment":
        parts.push(`[Env] OS=${ev.os || "?"} Node=${ev.nodeVersion || "?"} OpenClaw=${ev.openclawVersion || "?"}`);
        break;
      case "runtime":
        if (ev.recentTraceStats) {
          const s = ev.recentTraceStats;
          parts.push(`[Runtime] steps=${s.totalSteps} errors=${s.errorCount} tools=${s.toolCallCount}/${s.toolSuccessCount} loop=${s.loopDetected} cost=$${s.totalCostUsd.toFixed(2)} latency=${s.avgLatencyMs}ms`);
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
      max_tokens: 1024,
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
