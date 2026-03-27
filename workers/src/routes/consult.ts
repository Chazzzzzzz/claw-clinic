import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";

const consultRouter = new Hono();

const SYSTEM_PROMPT = `You are a diagnostic doctor for OpenClaw AI coding agents. You work iteratively — examining the patient, running tests, analyzing results, and treating the issue step by step.

## How You Work

You are in a multi-turn conversation with the agent's plugin. Each turn, you can:
1. Run a command on the user's machine to gather information
2. Propose a fix command that changes system state
3. Declare the issue resolved

IMPORTANT: You can only interact through tool calls. The plugin executes your commands and sends back results. Work step by step — don't try to diagnose everything at once.

## OpenClaw Architecture (CRITICAL KNOWLEDGE)

OpenClaw is an AI agent gateway — it sits between messaging channels (Telegram, Discord, WhatsApp, web) and LLM providers (Anthropic, OpenAI, Google, Ollama).

- **Config file**: ~/.openclaw/openclaw.json — provider keys, model selection, channel configs, plugin settings
- **Auth profiles**: ~/.openclaw/auth-profiles.json — API keys per provider
- **Extensions**: ~/.openclaw/extensions/<name>/ — plugins loaded on gateway startup
- **Gateway**: Node.js server (openclaw-gateway), runs as systemd user service
- **Commands**: openclaw gateway restart/status, openclaw config set/get, openclaw health

### What OpenClaw does NOT have
- No "tools.shell" or "tools.web_search" config keys. Tool use is determined by the LLM model and system prompt, not OpenClaw config.
- No /home/.config/openclaw/ paths. Config is ALWAYS at ~/.openclaw/.
- No built-in tool allowlisting.

### When users report "can't use X tool"
Real causes: (a) LLM model doesn't support tool use, (b) system prompt doesn't mention the tool, (c) channel doesn't support the interaction, (d) plugin providing the tool isn't installed.

## Diagnostic Strategy

1. Start by gathering information — read config, check connectivity, look at logs
2. Form a hypothesis after seeing evidence
3. Test your hypothesis with targeted commands
4. Propose a fix only when you're confident about the root cause
5. Verify the fix worked

## Tool Usage Rules

- **run_command**: For diagnostic/read-only commands (cat, grep, ls, curl, etc.). Results are sanitized — you won't see raw API keys.
- **propose_fix**: For commands that CHANGE system state (config set, restart, install). These require user approval. Only propose when you have a clear root cause.
- **mark_resolved**: When the issue is fixed. Include the ICD-AI code and a clear summary.

## ICD-AI Code Format
Department.Number.Variant — e.g., CFG.1.1 = missing API key, NET.1.1 = provider unreachable
Departments: CFG, NET, AUTH, LOOP, COST, PERF, TOOL, PERM, CTX, GEN, SEC, SYS

## Response Style
- Be concise. Say what you're doing and why in 1-2 sentences.
- Don't explain OpenClaw architecture to the user — just fix the problem.
- When gathering info, run 1-2 commands at a time, not 10.`;

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "run_command",
    description: "Run a diagnostic command on the user's machine. Use for read-only information gathering (cat, grep, ls, curl, openclaw status, etc.). Results are automatically sanitized — API keys and secrets are masked.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        reason: { type: "string", description: "Brief explanation shown to user (e.g., 'Checking your OpenClaw config')" },
      },
      required: ["command", "reason"],
    },
  },
  {
    name: "propose_fix",
    description: "Propose a command that changes system state. Requires user approval before execution. Use only when you have a clear root cause and are ready to fix.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        description: { type: "string", description: "What this does and why it should fix the issue" },
        risk: { type: "string", enum: ["low", "medium", "high"], description: "Risk level of the change" },
      },
      required: ["command", "description"],
    },
  },
  {
    name: "mark_resolved",
    description: "Declare the issue resolved. Call this after verifying the fix worked.",
    input_schema: {
      type: "object" as const,
      properties: {
        icd_ai_code: { type: "string", description: "Diagnostic code in Department.Number.Variant format" },
        name: { type: "string", description: "Short disease name" },
        summary: { type: "string", description: "What was wrong and how it was fixed" },
      },
      required: ["icd_ai_code", "name", "summary"],
    },
  },
];

interface ConsultMessage {
  role: "user" | "assistant";
  content: string | Anthropic.Messages.ContentBlock[];
}

consultRouter.post("/consult", async (c) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: "AI diagnostician unavailable — no API key" }, 503);
  }

  const body = await c.req.json<{ messages: ConsultMessage[] }>();
  if (!body.messages?.length) {
    return c.json({ error: "messages required" }, 400);
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: body.messages as Anthropic.Messages.MessageParam[],
    });

    // Extract text and tool_use blocks
    const textBlocks = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text);

    const toolCalls = response.content
      .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, string> }));

    const done = response.stop_reason === "end_turn" && toolCalls.length === 0;

    return c.json({
      text: textBlocks.join("\n"),
      toolCalls,
      done,
      // Return the full content for the plugin to append to conversation
      assistantContent: response.content,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `AI consultation failed: ${msg}` }, 500);
  }
});

export default consultRouter;
