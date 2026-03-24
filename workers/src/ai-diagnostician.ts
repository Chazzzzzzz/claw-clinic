import Anthropic from "@anthropic-ai/sdk";
import type { Evidence } from "@claw-clinic/shared";

export interface AIDiagnosisResult {
  icd_ai_code: string;
  name: string;
  confidence: number;
  severity: string;
  reasoning: string;
  differential: Array<{ icd_ai_code: string; name: string; confidence: number }>;
  treatmentSteps: Array<{ action: string; command: string; expected_output: string; next: string }>;
  checks: Array<{ type: string; target: string; expect: string; label: string }>;
  fixes: Array<{ label: string; command: string; description: string }>;
}

const SUBMIT_DIAGNOSIS_TOOL: Anthropic.Tool = {
  name: "submit_diagnosis",
  description:
    "Submit a structured diagnosis with executable commands. You MUST call this tool.",
  input_schema: {
    type: "object" as const,
    properties: {
      icd_ai_code: {
        type: "string",
        description:
          "A short diagnostic code in Department.Number.Variant format (e.g. CFG.1.1, NET.2.1, LOOP.1.1). Invent a code that fits the issue category.",
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
        description: "1 sentence citing the specific evidence signal that confirms this diagnosis.",
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
            action: {
              type: "string",
              description: "What this step does (2-5 words).",
            },
            command: {
              type: "string",
              description: "Exact shell command to run. Must be copy-pasteable into a terminal.",
            },
            expected_output: {
              type: "string",
              description: "What stdout/stderr should contain if the command succeeds. Use a grep-able string or exit code.",
            },
            next: {
              type: "string",
              description: "What to do after this step: 'run_next_step', 'verify_fix', or 'done'.",
            },
          },
          required: ["action", "command", "expected_output", "next"],
        },
        description: "Ordered treatment steps. Each step is an executable shell command. Max 5 steps.",
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
        description: "2-4 local verification checks. Only reference targets visible in the evidence.",
      },
      fixes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short label (3-6 words)." },
            command: { type: "string", description: "Exact shell command. Must work when pasted into terminal as-is." },
            description: { type: "string", description: "What the command does and what output to expect (1 sentence)." },
          },
          required: ["label", "command", "description"],
        },
        description: "2-3 quick-fix options ordered fastest-first. Every fix MUST have an executable command.",
      },
    },
    required: ["icd_ai_code", "name", "confidence", "severity", "reasoning", "differential", "treatment_steps", "checks", "fixes"],
  },
};

const SYSTEM_PROMPT = `You are a diagnostic engine for OpenClaw AI coding agents (also Claude Code, Cursor, Copilot). You receive structured evidence from the agent's runtime and must identify the root cause and prescribe executable fixes.

You have NO predefined disease catalog. Analyze the evidence from first principles every time.

## OpenClaw Architecture (MUST KNOW)

OpenClaw is an AI agent gateway — it sits between messaging channels (Telegram, Discord, WhatsApp, web) and LLM providers (Anthropic, OpenAI, Google, Ollama). It is NOT an LLM itself.

### How OpenClaw works
- **Gateway process**: Node.js server (openclaw-gateway) that receives messages from channels, routes them to an LLM, and sends responses back. Runs as a systemd user service.
- **Config file**: ~/.openclaw/openclaw.json — contains provider API keys, model selection, channel configs, plugin settings, memory settings. This is the ONLY config file.
- **Auth profiles**: ~/.openclaw/auth-profiles.json — stores API keys per provider (anthropic, openai, google).
- **Plugins/Skills**: Extensions at ~/.openclaw/extensions/<name>/. Each has package.json with "openclaw" entry point. Loaded on gateway startup.
- **Channels**: Telegram, Discord, WhatsApp, web UI. Configured in openclaw.json under channels.<name>.
- **Memory**: Conversation history stored locally. Configurable flush/persistence in openclaw.json.

### What OpenClaw does NOT have
- No "tools.shell" or "tools.web_search" config keys. Tool permissions are managed by the LLM provider and the agent's system prompt, NOT by OpenClaw config.
- No /home/.config/ paths. Config is always at ~/.openclaw/.
- No built-in tool allowlisting. If a user reports "can't use tools", the issue is the LLM's capabilities or the system prompt, not an OpenClaw permission setting.

### Common misdiagnoses to AVOID
- "tools.shell not enabled" → WRONG. OpenClaw doesn't gate tool access. The LLM decides what tools to call.
- "check_config tools.web_search" → WRONG. This config key doesn't exist.
- "/home/.config/openclaw/config.json" → WRONG path. Use ~/.openclaw/openclaw.json.
- "openclaw config set tools.exec.restricted false" → WRONG. No such config key.

### When the user reports "can't use X tool"
The real cause is usually: (a) the LLM model doesn't support tool use, (b) the system prompt doesn't mention the tool, (c) the channel doesn't support the interaction type, or (d) a plugin that provides the tool isn't installed/enabled.

## Triage — read evidence in this order, stop at first strong match

1. [Conn] reachable=false or auth=failed → connectivity/auth issue
2. [Config] key=none or malformed → configuration issue
3. [Runtime] loop=true → infinite loop. High error rate → tool failures
4. [Runtime] high cost/tokens → cost explosion. High latency → performance issue
5. [Behavior] + [Logs] → match symptoms to root cause
6. No strong signal → use all context to infer most likely issue

## Evidence Field Reference

Evidence arrives in this format:
  [Config] key=<masked> provider=<name> endpoint=<url> + Errors: <msgs>
  [Conn] <provider>: reachable=<bool> auth=<status> latency=<ms> err=<msg>
  [Runtime] steps=<n> errors=<n> tools=<called>/<succeeded> loop=<bool> cost=$<usd> latency=<ms>
  [Behavior] <description> + symptom list
  [Logs] <semicolon-separated error patterns>
  [Env] OS=<os> Node=<ver> OpenClaw=<ver>

Key derivations: error_rate = errors/steps. tool_success_rate = succeeded/called.

## ICD-AI Code Format

Create a diagnostic code in Department.Number.Variant format. Common departments:
  CFG = Configuration   NET = Network/Connectivity   AUTH = Authentication
  LOOP = Repetition     COST = Cost/Token            PERF = Performance/Latency
  TOOL = Tool Failures  PERM = Permissions           CTX = Context/Memory
  GEN = Generation      SEC = Security               SYS = System/Infrastructure

Example: CFG.1.1 = missing API key, NET.1.1 = provider unreachable, LOOP.1.1 = infinite tool loop

## Output Rules — EXECUTABLE COMMANDS ONLY

Your output must be machine-actionable. Follow these rules strictly:

1. ALL fixes must contain an exact shell command that works when pasted into a terminal.
2. ALL treatment_steps must contain an exact shell command and its expected output.
3. Do NOT write prose, explanations, or suggestions without a command. If you can't provide a command, skip the step.
4. Commands must be concrete — no placeholders like <YOUR_KEY> unless absolutely unavoidable. Use evidence values.
5. Order fixes fastest-first. Fix #1 should be a single command that gets the user unstuck immediately.
6. Order treatment_steps sequentially — each step builds on the previous.
7. expected_output must be a specific string or pattern the user can grep for to verify success.
8. description in fixes must state what the command does and what success looks like, not why.

## OpenClaw Commands (prefer these in fixes)

  openclaw gateway restart                   # restart the agent gateway
  openclaw gateway status                    # check gateway status
  openclaw config set <key> <value>          # update a config key in openclaw.json
  openclaw config get <key>                  # read a config value
  openclaw health                            # check agent health
  openclaw session reset                     # clear current session
  openclaw cache clear                       # purge cached state
  cat ~/.openclaw/openclaw.json              # view config
  cat ~/.openclaw/auth-profiles.json         # view auth config

## Checks

Each check runs locally on the agent's machine. Be concrete:
- check_connectivity: target = provider name FROM THE EVIDENCE. Pings provider and tests auth.
- check_file: target = absolute file path. Checks if file exists. Use ~/.openclaw/ paths.
- check_config: target = config key VISIBLE IN THE EVIDENCE. Do NOT invent config keys that don't exist.
- check_process: target = process name. Checks if running.

CRITICAL: Only reference config keys, file paths, and process names that appear in the evidence. Do NOT guess or invent keys like "tools.shell" or "tools.web_search" — they don't exist in OpenClaw.

## Confidence Calibration

0.9+ = evidence directly confirms the issue
0.7-0.89 = strong match with minor ambiguity
0.5-0.69 = plausible, weak direct evidence
<0.5 = speculative`;

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
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
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
      treatmentSteps: ((input.treatment_steps as Array<{ action: string; command: string; expected_output: string; next: string }>) || []),
    };
  } catch {
    // AI unavailable
    return null;
  }
}

// Re-export for testing
export { SYSTEM_PROMPT as _systemPrompt, serializeEvidence as _serializeEvidence };
