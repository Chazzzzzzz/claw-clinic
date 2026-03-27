import type { PluginApi } from "../types.js";
import { ClawClinicClient, type ConsultMessage, type ConsultToolCall } from "../client.js";
import {
  collectAllEvidence,
  collectConnectivityEvidence,
  validateKeyFormat,
  extractApiKey,
  detectProvider,
  maskApiKey,
  writeApiKeyToAuthProfiles,
} from "../evidence.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import { validateLocally } from "../validation.js";
import { loadSession, saveSession, clearSession } from "../session-store.js";
import type { Evidence } from "../types.js";

const MAX_TURNS = 15;

/** Serialize evidence into readable text for the AI */
function serializeEvidence(evidence: Evidence[]): string {
  const parts: string[] = [];
  for (const e of evidence) {
    switch (e.type) {
      case "config":
        parts.push(`[Config] key=${e.apiKey?.masked || "none"} provider=${e.apiKey?.provider || "unknown"} endpoint=${e.endpoint?.url || "none"}${e.errorLogs?.length ? ` Errors: ${e.errorLogs.join("; ")}` : ""}`);
        break;
      case "connectivity":
        for (const p of e.providers || []) {
          parts.push(`[Conn] ${p.name}: reachable=${p.reachable} auth=${p.authStatus || "unknown"} latency=${p.latencyMs || "?"}ms${p.error ? ` err=${p.error}` : ""}`);
        }
        break;
      case "runtime":
        if (e.recentTraceStats) {
          const s = e.recentTraceStats;
          parts.push(`[Runtime] steps=${s.totalSteps} errors=${s.errorCount} tools=${s.toolCallCount}/${s.toolSuccessCount} loop=${s.loopDetected} cost=$${s.totalCostUsd} latency=${s.avgLatencyMs}ms`);
        }
        break;
      case "behavior":
        parts.push(`[Behavior] ${e.description}${e.symptoms?.length ? ` Symptoms: ${e.symptoms.join(", ")}` : ""}`);
        break;
      case "log":
        if (e.errorPatterns?.length) parts.push(`[Logs] ${e.errorPatterns.join("; ")}`);
        break;
      case "environment":
        parts.push(`[Env] OS=${e.os || "?"} Node=${e.nodeVersion || "?"} OpenClaw=${e.openclawVersion || "?"}`);
        break;
    }
  }
  return parts.join("\n");
}

/**
 * Register /clinic as a chat command.
 *
 * Flow: user describes problem → AI investigates step by step →
 * plugin executes commands (with approval) → AI analyzes results →
 * loop until resolved.
 */
export function registerClinicChatCommand(api: PluginApi, client: ClawClinicClient): void {
  api.registerCommand({
    name: "clinic",
    description: "Diagnose and fix agent issues — AI doctor examines your agent step by step",
    acceptsArgs: true,
    handler: async (ctx) => {
      const input = ctx.args?.trim() || undefined;

      // Check for pending session
      const pending = await loadSession();

      // /clinic done — manual resolution
      if (input && /^done$/i.test(input)) {
        if (pending) {
          const conn = await collectConnectivityEvidence(api.config);
          const failed = conn.providers.filter((p) => !p.reachable || p.authStatus === "failed");
          if (failed.length === 0) {
            await clearSession();
            return { text: `**${pending.diagnosisName || "Issue"}** — Fixed.` };
          }
          return { text: `Still detected: ${failed.map((p) => `${p.name}: ${p.error || "failed"}`).join("; ")}` };
        }
        return { text: "No active session." };
      }

      // /clinic yes — approve pending action
      if (input && /^(yes|y|approve)$/i.test(input) && pending?.pendingCommand) {
        return await executeApprovedCommand(api, client, pending);
      }

      // /clinic no — skip pending action
      if (input && /^(no|n|skip)$/i.test(input) && pending?.pendingCommand) {
        return await continueConsultation(api, client, pending, "User declined to run this command. Try a different approach.");
      }

      // /clinic reset — clear session
      if (input && /^reset$/i.test(input)) {
        await clearSession();
        return { text: "Session cleared." };
      }

      // Resume pending session if user sends more context
      if (pending?.conversation?.length && input) {
        return await continueConsultation(api, client, pending, input);
      }

      // Fresh consultation
      return await startConsultation(api, client, input);
    },
  });
}

// ─── Sanitization ─────────────────────────────────────────────────

function sanitizeOutput(output: string): string {
  // Mask API keys (common patterns)
  let sanitized = output.replace(
    /\b(sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|key-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{30,})/g,
    (match) => match.slice(0, 8) + "..." + match.slice(-4),
  );
  // Mask bearer tokens
  sanitized = sanitized.replace(
    /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
    "Bearer [MASKED]",
  );
  // Mask common secret patterns
  sanitized = sanitized.replace(
    /"(api[_-]?key|secret|token|password|auth)":\s*"[^"]{8,}"/gi,
    (match, key) => `"${key}": "[MASKED]"`,
  );
  return sanitized;
}

// ─── Start fresh consultation ─────────────────────────────────────

async function startConsultation(
  api: PluginApi,
  client: ClawClinicClient,
  symptoms: string | undefined,
): Promise<{ text: string }> {
  await clearSession();

  try {
    // Collect evidence
    const localResult = await validateLocally(api.config);
    const evidence = await collectAllEvidence(api.config);

    if (symptoms) {
      evidence.push({ type: "behavior", description: symptoms });
    }
    if (localResult.quickIssues.length > 0) {
      evidence.push({ type: "behavior", description: "Local validation issues", symptoms: localResult.quickIssues });
    }

    // Build initial message with evidence
    const evidenceText = serializeEvidence(evidence);
    const userMessage = symptoms
      ? `Patient complaint: ${symptoms}\n\nEvidence collected from the agent:\n${evidenceText}`
      : `Patient has no specific complaint. Routine checkup requested.\n\nEvidence:\n${evidenceText}`;

    const messages: ConsultMessage[] = [{ role: "user", content: userMessage }];

    // Call the consultation endpoint
    const response = await client.consult(messages);

    // Build conversation for session
    const conversation: ConsultMessage[] = [
      ...messages,
      { role: "assistant", content: response.assistantContent },
    ];

    return await handleConsultResponse(api, client, response, conversation);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Clinic error: ${msg}` };
  }
}

// ─── Handle consultation response ─────────────────────────────────

async function handleConsultResponse(
  api: PluginApi,
  client: ClawClinicClient,
  response: { text: string; toolCalls: ConsultToolCall[]; done: boolean; assistantContent: unknown[] },
  conversation: ConsultMessage[],
): Promise<{ text: string }> {
  const lines: string[] = [];

  // Show AI's text to user
  if (response.text) {
    lines.push(response.text);
  }

  // If done (no tool calls, AI finished), show summary and clear session
  if (response.done) {
    await clearSession();
    return { text: lines.join("\n") || "Consultation complete." };
  }

  // Handle tool calls
  for (const tool of response.toolCalls) {
    if (tool.name === "mark_resolved") {
      await clearSession();
      lines.push("");
      lines.push(`**${tool.input.name}** (${tool.input.icd_ai_code}) — Resolved`);
      lines.push(tool.input.summary);
      return { text: lines.join("\n") };
    }

    if (tool.name === "run_command") {
      // Diagnostic command — auto-execute, show status, send result back to AI
      lines.push(`> ${tool.input.reason}: \`${tool.input.command}\``);

      let output: string;
      let isError = false;
      try {
        const result = await execAsync(tool.input.command, { timeout: 15_000 });
        output = (result.stdout || "") + (result.stderr ? `\n(stderr: ${result.stderr})` : "");
        if (!output.trim()) output = "(no output)";
      } catch (err) {
        isError = true;
        const errObj = err as Record<string, unknown>;
        if (errObj && typeof errObj === "object" && "stderr" in errObj && errObj.stderr) {
          output = `Error: ${String(errObj.stderr)}`;
        } else {
          output = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      output = sanitizeOutput(output);
      if (output.length > 3000) output = output.slice(0, 3000) + "\n...(truncated)";

      // Send result back to AI and continue the loop
      conversation.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: tool.id, content: output, is_error: isError }],
      });

      // Continue — call /consult again with the result
      return await continueLoop(api, client, conversation, lines.join("\n"));
    }

    if (tool.name === "propose_fix") {
      // Fix command — show with more emphasis, ask approval
      lines.push("");
      lines.push(`**Proposed fix** (risk: ${tool.input.risk || "low"}):`);
      lines.push(`  \`${tool.input.command}\``);
      lines.push(tool.input.description);

      await saveSession({
        sessionId: `consult-${Date.now()}`,
        pendingStepId: "awaiting_approval",
        pendingPrompt: tool.input.command,
        pendingCommand: tool.input.command,
        pendingToolId: tool.id,
        diagnosisCode: "",
        diagnosisName: tool.input.description,
        createdAt: new Date().toISOString(),
        conversation,
      });

      lines.push("");
      lines.push("Reply `/clinic yes` to apply, `/clinic no` to skip");
      return { text: lines.join("\n") };
    }
  }

  // Shouldn't reach here, but handle gracefully
  return { text: lines.join("\n") || "Waiting for input..." };
}

// ─── Execute an approved command and continue ─────────────────────

async function executeApprovedCommand(
  api: PluginApi,
  client: ClawClinicClient,
  session: { pendingCommand?: string; pendingToolId?: string; conversation?: ConsultMessage[] },
): Promise<{ text: string }> {
  if (!session.pendingCommand || !session.pendingToolId || !session.conversation) {
    return { text: "No pending command to execute." };
  }

  const command = session.pendingCommand;
  const toolId = session.pendingToolId;

  // Execute the command
  let output: string;
  let isError = false;
  try {
    const result = await execAsync(command, { timeout: 15_000 });
    output = (result.stdout || "") + (result.stderr ? `\n(stderr: ${result.stderr})` : "");
    if (!output.trim()) output = "(command completed with no output)";
  } catch (err) {
    isError = true;
    const errObj = err as Record<string, unknown>;
    if (errObj && typeof errObj === "object" && "stderr" in errObj && errObj.stderr) {
      output = `Error: ${String(errObj.stderr)}`;
    } else {
      output = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Sanitize the output
  output = sanitizeOutput(output);

  // Truncate if too long
  if (output.length > 3000) {
    output = output.slice(0, 3000) + "\n...(truncated)";
  }

  // Show user what happened
  const statusLine = isError
    ? `Ran \`${command}\` — error`
    : `Ran \`${command}\` — ok`;

  // Continue the consultation with the result
  const conversation = [...session.conversation];
  conversation.push({
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: toolId,
      content: output,
      is_error: isError,
    }],
  });

  return await continueLoop(api, client, conversation, statusLine);
}

// ─── Continue consultation with user input ────────────────────────

async function continueConsultation(
  api: PluginApi,
  client: ClawClinicClient,
  session: { conversation?: ConsultMessage[]; pendingToolId?: string },
  userInput: string,
): Promise<{ text: string }> {
  if (!session.conversation) {
    return { text: "No active consultation. Run `/clinic <describe your problem>` to start." };
  }

  const conversation = [...session.conversation];

  // If there's a pending tool call that was skipped, send a tool_result
  if (session.pendingToolId) {
    conversation.push({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: session.pendingToolId,
        content: userInput,
        is_error: false,
      }],
    });
  } else {
    conversation.push({ role: "user", content: userInput });
  }

  return await continueLoop(api, client, conversation, null);
}

// ─── Core loop: call backend and handle response ──────────────────

async function continueLoop(
  api: PluginApi,
  client: ClawClinicClient,
  conversation: ConsultMessage[],
  statusLine: string | null,
): Promise<{ text: string }> {
  // Guard against runaway loops
  const turnCount = conversation.filter((m) => m.role === "assistant").length;
  if (turnCount >= MAX_TURNS) {
    await clearSession();
    return { text: `${statusLine ? statusLine + "\n\n" : ""}Consultation reached maximum turns. Run \`/clinic\` to start a new session.` };
  }

  try {
    const response = await client.consult(conversation);

    const updatedConversation: ConsultMessage[] = [
      ...conversation,
      { role: "assistant", content: response.assistantContent },
    ];

    const result = await handleConsultResponse(api, client, response, updatedConversation);

    // Prepend status line if we have one
    if (statusLine) {
      return { text: `${statusLine}\n\n${result.text}` };
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `${statusLine ? statusLine + "\n\n" : ""}Consultation error: ${msg}` };
  }
}
