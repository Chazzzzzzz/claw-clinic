import type { PluginApi, Evidence } from "../types.js";
import { ClawClinicClient, type ConsultMessage } from "../client.js";
import { collectAllEvidence } from "../evidence.js";
import { validateLocally } from "../validation.js";
import { ClinicNotifier } from "../notifier.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_TURNS = 15;

/** Sanitize command output */
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

export function registerClinicCommand(api: PluginApi, client: ClawClinicClient): void {
  api.registerCli(
    ({ program }) => {
      const cmd = program
        .command("claw-clinic")
        .description("Claw Clinic — diagnose and treat agent health issues");

      cmd
        .command("diagnose")
        .description("Run agentic diagnostic: AI doctor examines your agent step by step")
        .argument("[symptoms...]", "Description of the issue you're experiencing")
        .action(async (...args: unknown[]) => {
          const symptomsArr = Array.isArray(args[0]) ? args[0] as string[] : [];
          const symptoms = symptomsArr.join(" ").trim() || undefined;
          const notifier = new ClinicNotifier(api, { mode: "cli" });

          try {
            // Step 1: Collect evidence
            await notifier.status("Collecting evidence...");
            const localResult = await validateLocally(api.config);
            const evidence = await collectAllEvidence(api.config);

            if (symptoms) {
              evidence.push({ type: "behavior", description: symptoms });
            }
            if (localResult.quickIssues.length > 0) {
              evidence.push({ type: "behavior", description: "Local validation issues", symptoms: localResult.quickIssues });
            }

            await notifier.status(`Collected: ${evidence.map((e) => e.type).join(", ")}`);

            // Step 2: Start consultation
            const evidenceText = serializeEvidence(evidence);
            const userMessage = symptoms
              ? `Patient complaint: ${symptoms}\n\nEvidence:\n${evidenceText}`
              : `Routine checkup.\n\nEvidence:\n${evidenceText}`;

            const conversation: ConsultMessage[] = [{ role: "user", content: userMessage }];

            await notifier.status("Starting AI consultation...\n");

            // Step 3: Agentic loop
            for (let turn = 0; turn < MAX_TURNS; turn++) {
              const response = await client.consult(conversation);
              conversation.push({ role: "assistant", content: response.assistantContent });

              // Show AI text
              if (response.text) {
                console.log(response.text);
              }

              // Done
              if (response.done) {
                console.log("\nConsultation complete.");
                return;
              }

              // Handle tool calls
              for (const tool of response.toolCalls) {
                if (tool.name === "mark_resolved") {
                  console.log(`\n✓ ${tool.input.name} (${tool.input.icd_ai_code}) — Resolved`);
                  console.log(tool.input.summary);
                  return;
                }

                if (tool.name === "run_command") {
                  // Auto-execute diagnostic command
                  console.log(`\n> ${tool.input.reason}`);
                  console.log(`> $ ${tool.input.command}`);

                  let output: string;
                  let isError = false;
                  try {
                    const result = await execAsync(tool.input.command, { timeout: 15_000 });
                    output = (result.stdout || "") + (result.stderr ? `\n${result.stderr}` : "");
                    if (!output.trim()) output = "(no output)";
                  } catch (err) {
                    isError = true;
                    const errObj = err as Record<string, unknown>;
                    output = errObj?.stderr ? `Error: ${String(errObj.stderr)}` : `Error: ${err instanceof Error ? err.message : String(err)}`;
                  }

                  output = sanitizeOutput(output);
                  if (output.length > 3000) output = output.slice(0, 3000) + "\n...(truncated)";

                  // Show truncated result to user
                  const preview = output.split("\n").slice(0, 5).join("\n");
                  console.log(preview);
                  if (output.split("\n").length > 5) console.log("  ...");

                  // Send back to AI
                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: tool.id, content: output, is_error: isError }],
                  });
                }

                if (tool.name === "propose_fix") {
                  console.log(`\n⚡ Proposed fix (risk: ${tool.input.risk || "low"}):`);
                  console.log(`  $ ${tool.input.command}`);
                  console.log(`  ${tool.input.description}`);

                  // In CLI mode, auto-execute fixes (non-interactive)
                  // For interactive approval, the /clinic chat command handles that
                  console.log(`\n  Applying fix...`);

                  let output: string;
                  let isError = false;
                  try {
                    const result = await execAsync(tool.input.command, { timeout: 30_000 });
                    output = (result.stdout || "") + (result.stderr ? `\n${result.stderr}` : "");
                    if (!output.trim()) output = "(done)";
                    console.log(`  ✓ ${output.trim().split("\n")[0]}`);
                  } catch (err) {
                    isError = true;
                    const errObj = err as Record<string, unknown>;
                    output = errObj?.stderr ? `Error: ${String(errObj.stderr)}` : `Error: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  ✗ ${output.split("\n")[0]}`);
                  }

                  output = sanitizeOutput(output);

                  conversation.push({
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: tool.id, content: output, is_error: isError }],
                  });
                }
              }
            }

            console.log("\nMax turns reached.");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Clinic error: ${message}`);
          }
        });

      cmd
        .command("health")
        .description("Quick backend connectivity check")
        .action(async () => {
          try {
            console.log("Checking backend connectivity...");
            const result = await client.healthCheck();
            console.log(`Backend: OK (version ${result.version})`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Backend unreachable: ${message}`);
          }
        });
    },
    { commands: ["claw-clinic"] },
  );
}
