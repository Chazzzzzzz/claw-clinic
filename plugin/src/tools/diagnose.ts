import type { PluginApi, Evidence } from "../types.js";
import { ClawClinicClient, type ConsultMessage, type ConsultToolCall } from "../client.js";
import { collectAllEvidence } from "../evidence.js";
import { validateLocally } from "../validation.js";
import { ClinicNotifier } from "../notifier.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_TURNS = 15;

/** Sanitize command output — mask API keys and secrets */
function sanitizeOutput(output: string): string {
  let s = output.replace(
    /\b(sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{30,})/g,
    (m) => m.slice(0, 8) + "..." + m.slice(-4),
  );
  s = s.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/gi, "Bearer [MASKED]");
  s = s.replace(/"(api[_-]?key|secret|token|password|auth)":\s*"[^"]{8,}"/gi, (_, key) => `"${key}": "[MASKED]"`);
  return s;
}

/** Serialize evidence for the AI */
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

export function registerDiagnoseTool(api: PluginApi, client: ClawClinicClient): void {
  api.registerTool({
    name: "clinic_diagnose",
    description:
      "AI-powered diagnostic consultation: collects evidence, then iteratively investigates " +
      "the issue with an AI doctor. The doctor runs commands, analyzes results, and proposes fixes. " +
      "Diagnostic commands run automatically; fix commands pause for user approval.",
    parameters: {
      type: "object",
      properties: {
        symptoms: {
          type: "string",
          description: "Description of the issue (e.g., 'agent cannot connect to AI provider')",
        },
        channelId: {
          type: "string",
          description: "Chat channel ID to send progress updates to",
        },
      },
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      const rawCommand = params.command as string | undefined;
      const symptoms = rawCommand?.trim() || (params.symptoms as string | undefined);
      const channelId = (params.channelId as string) || _id;
      const notifier = new ClinicNotifier(api, channelId
        ? { mode: "chat", channelId }
        : { mode: "tool" });

      try {
        // Step 1: Collect evidence
        await notifier.status("Collecting evidence...");
        const localResult = await validateLocally(api.config);
        const evidence: Evidence[] = await collectAllEvidence(api.config);

        if (symptoms) {
          evidence.push({ type: "behavior", description: symptoms });
        }
        if (localResult.quickIssues.length > 0) {
          evidence.push({ type: "behavior", description: "Local validation issues", symptoms: localResult.quickIssues });
        }

        // Step 2: Start consultation
        const evidenceText = serializeEvidence(evidence);
        const userMessage = symptoms
          ? `Patient complaint: ${symptoms}\n\nEvidence:\n${evidenceText}`
          : `Routine checkup.\n\nEvidence:\n${evidenceText}`;

        const conversation: ConsultMessage[] = [{ role: "user", content: userMessage }];
        const log: string[] = [];

        await notifier.status("Starting AI consultation...");

        // Step 3: Agentic loop
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const response = await client.consult(conversation);

          // Add assistant response to conversation
          conversation.push({ role: "assistant", content: response.assistantContent });

          // Show AI text to user
          if (response.text) {
            await notifier.status(response.text);
            log.push(response.text);
          }

          // Done — AI finished with text only
          if (response.done) {
            log.push("Consultation complete.");
            return { content: [{ type: "text", text: log.join("\n\n") }] };
          }

          // Handle tool calls
          for (const tool of response.toolCalls) {
            if (tool.name === "mark_resolved") {
              const summary = `**${tool.input.name}** (${tool.input.icd_ai_code}) — Resolved\n${tool.input.summary}`;
              await notifier.success(summary);
              log.push(summary);
              return { content: [{ type: "text", text: log.join("\n\n") }] };
            }

            if (tool.name === "run_command") {
              // Diagnostic command — execute automatically, send result back
              await notifier.status(`> ${tool.input.reason}\n> \`${tool.input.command}\``);
              log.push(`> ${tool.input.reason}: \`${tool.input.command}\``);

              let output: string;
              let isError = false;
              try {
                const result = await execAsync(tool.input.command, { timeout: 15_000 });
                output = (result.stdout || "") + (result.stderr ? `\n(stderr: ${result.stderr})` : "");
                if (!output.trim()) output = "(no output)";
              } catch (err) {
                isError = true;
                const errObj = err as Record<string, unknown>;
                output = errObj?.stderr ? `Error: ${String(errObj.stderr)}` : `Error: ${err instanceof Error ? err.message : String(err)}`;
              }

              output = sanitizeOutput(output);
              if (output.length > 3000) output = output.slice(0, 3000) + "\n...(truncated)";

              log.push(isError ? `Error: ${output.slice(0, 200)}` : `Result: ${output.slice(0, 200)}`);

              // Send result back to AI
              conversation.push({
                role: "user",
                content: [{ type: "tool_result", tool_use_id: tool.id, content: output, is_error: isError }],
              });
            }

            if (tool.name === "propose_fix") {
              // Fix command — pause and return to the calling agent for user approval
              const fixMessage = `**Proposed fix** (risk: ${tool.input.risk || "low"}):\n  \`${tool.input.command}\`\n${tool.input.description}\n\nApprove this fix by telling your agent to run: \`${tool.input.command}\``;
              await notifier.status(fixMessage);
              log.push(fixMessage);

              // Return control to the calling LLM — it should ask the user
              return { content: [{ type: "text", text: log.join("\n\n") }] };
            }
          }
        }

        log.push("Consultation reached maximum turns.");
        return { content: [{ type: "text", text: log.join("\n\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await notifier.error(message);
        return { content: [{ type: "text", text: `Consultation error: ${message}` }] };
      }
    },
  });
}
