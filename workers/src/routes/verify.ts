import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Evidence, VerificationStep, VerificationPlanResponse, VerificationConfidence } from "@claw-clinic/shared";

// ─── AI-generated verification plan ──────────────────────────────

const VERIFY_TOOL: Anthropic.Tool = {
  name: "submit_verification_plan",
  description: "Submit a verification plan with executable checks.",
  input_schema: {
    type: "object" as const,
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["check_config", "check_connectivity", "check_file", "check_process", "check_logs", "custom"],
            },
            description: { type: "string" },
            command: {
              type: "string",
              description: "Shell command to verify this check. Must be executable.",
            },
            expected_output: {
              type: "string",
              description: "What stdout should contain if the check passes.",
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
          },
          required: ["type", "description", "command", "expected_output", "confidence"],
        },
      },
    },
    required: ["steps"],
  },
};

const VERIFY_SYSTEM_PROMPT = `You generate verification plans for AI agent issues. Given a disease code, disease name, and optional evidence, produce 2-5 executable verification steps that confirm whether the issue has been resolved.

Rules:
1. Every step MUST have an executable shell command.
2. expected_output must be a specific string or pattern to grep for.
3. Order steps from most definitive to least.
4. Prefer commands that produce clear pass/fail output.

OpenClaw commands available:
  openclaw health                            # check agent health
  openclaw config get <key>                  # read config value
  cat ~/.config/openclaw/config.json         # view config
  cat ~/.config/openclaw/auth-profiles.json  # view auth
  curl -s -o /dev/null -w "%{http_code}" <url>  # test endpoint
  journalctl -u openclaw-gateway --since "5 min ago"  # recent logs`;

async function generateVerificationPlan(
  diseaseCode: string,
  diseaseName: string,
  evidence?: Evidence[],
): Promise<VerificationStep[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const client = new Anthropic({ apiKey });

  let userMessage = `Disease: ${diseaseName} (${diseaseCode})`;
  if (evidence?.length) {
    userMessage += `\n\nEvidence:\n${evidence.map((e) => JSON.stringify(e)).join("\n")}`;
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: VERIFY_SYSTEM_PROMPT,
      tools: [VERIFY_TOOL],
      tool_choice: { type: "tool", name: "submit_verification_plan" },
      messages: [{ role: "user", content: userMessage }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) return [];

    const input = toolUse.input as { steps: Array<{
      type: string;
      description: string;
      command: string;
      expected_output: string;
      confidence: string;
    }> };

    return input.steps.map((step, i) => ({
      id: `verify_${i + 1}`,
      type: step.type as VerificationStep["type"],
      description: step.description,
      instruction: step.command,
      confidence: step.confidence as VerificationConfidence,
      params: { command: step.command, expected_output: step.expected_output },
      successCondition: step.expected_output,
    }));
  } catch {
    return [];
  }
}

// ─── Route ──────────────────────────────────────────────────────

const verifyRouter = new Hono();

verifyRouter.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      diseaseCode: string;
      diseaseName?: string;
      evidence?: Evidence[];
    }>();

    const { diseaseCode, diseaseName, evidence } = body;

    if (!diseaseCode) {
      return c.json({ error: "diseaseCode is required" }, 400);
    }

    const steps = await generateVerificationPlan(
      diseaseCode,
      diseaseName || "Unknown",
      evidence,
    );

    return c.json({
      diseaseCode,
      diseaseName: diseaseName || "Unknown",
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
