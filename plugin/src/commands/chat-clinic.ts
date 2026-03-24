import type { PluginApi, DiagnosisResponse } from "../types.js";
import type { StoredSession } from "../session-store.js";
import { ClawClinicClient } from "../client.js";
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
import { ClinicNotifier } from "../notifier.js";
import { loadSession, saveSession, clearSession } from "../session-store.js";
import { executeVerificationPlan, type VerificationPlanResult } from "../verification-executor.js";

/**
 * Register /clinic as a chat command via registerCommand.
 * This bypasses the LLM entirely — works even when AI model is down.
 *
 * Flow: diagnose → show checks/fixes → user picks fix → done (max 3 rounds)
 */
export function registerClinicChatCommand(api: PluginApi, client: ClawClinicClient): void {
  api.registerCommand({
    name: "clinic",
    description: "Run a health check — diagnose and treat agent issues (no AI model needed)",
    acceptsArgs: true,
    handler: async (ctx) => {
      const input = ctx.args?.trim() || undefined;
      const channelId = ctx.channelId;

      // --- If user provided input, check for a pending session first ---
      if (input) {
        const pending = await loadSession();
        if (pending) {
          return await handleFollowUp(api, client, pending, input);
        }
        // No pending session → treat input as symptoms for a fresh diagnosis
      }

      // --- Fresh diagnosis ---
      return await runDiagnosis(api, client, input, channelId);
    },
  });
}

// ─── Execute checks from diagnosis response ─────────────────────

async function executeChecks(
  checks: DiagnosisResponse["checks"],
  config: Record<string, unknown>,
): Promise<VerificationPlanResult> {
  if (!checks.length) return { passed: true, results: [] };

  const steps = checks.map((check) => ({
    type: check.type as "check_config" | "check_connectivity" | "check_file" | "check_process",
    description: check.label,
    target: check.target,
    expect: check.expect,
  }));

  return executeVerificationPlan(steps, config);
}

// ─── Compact formatting ─────────────────────────────────────────

function formatCompactResult(
  d: { name: string; reasoning: string },
  checkResults: VerificationPlanResult,
  fixes: Array<{ label: string; command?: string; description: string }>,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`**${d.name}**`);
  lines.push(d.reasoning);

  // Check results
  if (checkResults.results.length > 0) {
    lines.push("");
    lines.push("Checked:");
    for (const r of checkResults.results) {
      const icon = r.passed ? "  \u2713" : "  \u2717";
      const detail = r.detail || r.error || "";
      lines.push(`${icon} ${r.step.description}${detail ? `  (${detail})` : ""}`);
    }
  }

  // Fix options
  if (fixes.length > 0) {
    lines.push("");
    lines.push("To fix \u2014 pick one:");
    fixes.forEach((fix, i) => {
      if (fix.command) {
        lines.push(`  ${i + 1}. ${fix.label}: \`${fix.command}\``);
      } else {
        lines.push(`  ${i + 1}. ${fix.label}`);
      }
    });
    lines.push("");
    lines.push(`Reply ${fixes.length === 1 ? "`/clinic 1`" : "`/clinic 1`-`/clinic " + fixes.length + "`"} to apply`);
  }

  return lines.join("\n");
}

// ─── Fresh diagnosis flow ───────────────────────────────────────
// Round 1: collect evidence → backend diagnose → show checks/fixes
// No pre-verification round trip — checks are done inline

async function runDiagnosis(
  api: PluginApi,
  client: ClawClinicClient,
  symptoms: string | undefined,
  channelId: string | undefined,
): Promise<{ text: string }> {
  // Clear any stale session
  await clearSession();

  try {
    // Step 1: Collect evidence locally (no backend call)
    const localResult = await validateLocally(api.config);
    const evidence = await collectAllEvidence(api.config);

    if (symptoms) {
      evidence.push({ type: "behavior", description: symptoms });
    }
    if (localResult.quickIssues.length > 0) {
      evidence.push({ type: "behavior", description: "Local validation issues", symptoms: localResult.quickIssues });
    }

    // Step 2: Single backend call — diagnose with checks/fixes
    let diagnosis;
    try {
      diagnosis = await client.diagnose(evidence, symptoms);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (localResult.quickIssues.length > 0) {
        return { text: localResult.quickIssues.map((i) => `- ${i}`).join("\n") };
      }
      return { text: `Could not reach diagnostic backend: ${msg}` };
    }

    if (!diagnosis.diagnosis) {
      return { text: "Your agent appears healthy. No issues detected." };
    }

    // Step 3: Execute checks locally (no backend call)
    const checkResults = await executeChecks(diagnosis.checks || [], api.config);

    // If all checks pass and no symptoms were reported, issue may be resolved
    if (checkResults.passed && !symptoms && checkResults.results.length > 0) {
      return { text: `Previously detected **${diagnosis.diagnosis.name}** has already been resolved. No action needed.` };
    }

    // Step 4: Format compact result with checks/fixes
    const text = formatCompactResult(diagnosis.diagnosis, checkResults, diagnosis.fixes || []);

    // Save session for fix selection (no backend call needed for this)
    if (diagnosis.fixes?.length) {
      await saveSession({
        sessionId: diagnosis.sessionId,
        pendingStepId: "fix_selection",
        pendingPrompt: `Reply /clinic 1-${diagnosis.fixes.length}`,
        diagnosisCode: diagnosis.diagnosis.icd_ai_code,
        diagnosisName: diagnosis.diagnosis.name,
        createdAt: new Date().toISOString(),
        pendingFixes: diagnosis.fixes,
      });
    }

    return { text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Clinic error: ${message}` };
  }
}

// ─── Follow-up flow (resume pending session) ────────────────────
// Round 2: user picks fix → show command
// Round 3: /clinic done → re-verify locally (no backend call)

async function handleFollowUp(
  api: PluginApi,
  client: ClawClinicClient,
  session: StoredSession,
  userInput: string,
): Promise<{ text: string }> {
  const trimmedInput = userInput.trim();

  // Numeric fix selection (round 2 — no backend call)
  if (session.pendingFixes?.length && /^[1-9]$/.test(trimmedInput)) {
    const fixIndex = parseInt(trimmedInput, 10) - 1;
    if (fixIndex >= session.pendingFixes.length) {
      return { text: `Pick 1-${session.pendingFixes.length}` };
    }
    const fix = session.pendingFixes[fixIndex];
    return executeFix(api, client, session, fix);
  }

  // Pasted API key detection (handles key fix inline — no extra backend call)
  const inputProvider = detectProvider(trimmedInput);

  if (inputProvider) {
    const validation = validateKeyFormat(trimmedInput);
    if (!validation.valid) {
      return { text: `That key doesn't look right: ${validation.issue}\n\nPlease paste the correct full key.` };
    }

    const writeResult = await writeApiKeyToAuthProfiles(trimmedInput, inputProvider);
    if (!writeResult.success) {
      return { text: `Could not save the key: ${writeResult.error}\n\nAs a fallback, run this in your terminal:\n  openclaw config set ${inputProvider}.apiKey ${maskApiKey(trimmedInput)}...\nThen reply: /clinic done` };
    }

    // Re-verify locally — no backend call
    const conn = await collectConnectivityEvidence(api.config);
    const providerResult = conn.providers.find((p) => p.name === inputProvider);
    const passed = providerResult ? providerResult.reachable && providerResult.authStatus !== "failed" : true;

    if (passed) {
      await clearSession();
      return { text: `Your new ${inputProvider} API key is working. The issue is fixed.\n\nFor security, please delete the message containing your API key from this chat.` };
    } else {
      await saveSession({
        sessionId: session.sessionId,
        pendingStepId: session.pendingStepId,
        pendingPrompt: session.pendingPrompt,
        diagnosisCode: session.diagnosisCode,
        diagnosisName: session.diagnosisName,
        createdAt: new Date().toISOString(),
        detectedProvider: inputProvider,
      });
      return { text: `I saved your key but it's not working \u2014 ${providerResult?.authError || "auth failed"}\n\nPlease double-check that you copied the correct key. Paste the right key here to try again.` };
    }
  }

  // /clinic run — execute the pending command after user confirmation
  if (/^run$/i.test(trimmedInput) && session.pendingCommand) {
    try {
      await execAsync(session.pendingCommand, { timeout: 15_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await saveSession({
        sessionId: session.sessionId,
        pendingStepId: "awaiting_fix",
        pendingPrompt: session.pendingCommand,
        diagnosisCode: session.diagnosisCode,
        diagnosisName: session.diagnosisName,
        createdAt: new Date().toISOString(),
      });
      return {
        text: `Failed to run \`${session.pendingCommand}\`: ${msg}\n\nRun it manually, then reply \`/clinic done\``,
      };
    }

    // Verify after execution
    const conn = await collectConnectivityEvidence(api.config);
    const failed = conn.providers.filter((p) => !p.reachable || p.authStatus === "failed");
    if (failed.length === 0) {
      await clearSession();
      return { text: `Ran \`${session.pendingCommand}\`\n\n**${session.diagnosisName}** — Fixed.` };
    }

    await saveSession({
      sessionId: session.sessionId,
      pendingStepId: "awaiting_fix",
      pendingPrompt: session.pendingCommand,
      diagnosisCode: session.diagnosisCode,
      diagnosisName: session.diagnosisName,
      createdAt: new Date().toISOString(),
    });
    return {
      text: `Ran \`${session.pendingCommand}\` but issue persists.\n\n${failed.map((p) => `${p.name}: ${p.error || "failed"}`).join("; ")}\n\nTry another fix or reply \`/clinic done\` after manual resolution.`,
    };
  }

  // /clinic done — re-verify locally, no backend call (round 3)
  if (/^done$/i.test(trimmedInput)) {
    // Run checks locally using the diagnosis checks from session
    const conn = await collectConnectivityEvidence(api.config);
    const failed = conn.providers.filter((p) => !p.reachable || p.authStatus === "failed");
    if (failed.length === 0) {
      await clearSession();
      return { text: `**${session.diagnosisName}** \u2014 Fixed.` };
    }
    return { text: `**${session.diagnosisName}** \u2014 still detected.\n\n${failed.map((p) => `${p.name}: ${p.error || "failed"}`).join("; ")}` };
  }

  // Unknown input
  if (session.pendingCommand) {
    return { text: `Reply \`/clinic run\` to execute the command, or \`/clinic done\` if you ran it manually.` };
  }
  if (session.pendingFixes?.length) {
    return { text: `Reply \`/clinic 1\`-\`/clinic ${session.pendingFixes.length}\` to pick a fix, or \`/clinic done\` if you fixed it manually.` };
  }
  return { text: "Reply /clinic done when you've fixed the issue." };
}

// ─── Execute a selected fix (round 2 — no backend call) ─────────

async function executeFix(
  _api: PluginApi,
  _client: ClawClinicClient,
  session: StoredSession,
  fix: { label: string; command?: string; description: string },
): Promise<{ text: string }> {
  if (fix.command) {
    // Show the command and ask for confirmation — never auto-execute LLM-generated commands
    await saveSession({
      sessionId: session.sessionId,
      pendingStepId: "awaiting_run_confirmation",
      pendingPrompt: fix.command,
      pendingCommand: fix.command,
      diagnosisCode: session.diagnosisCode,
      diagnosisName: session.diagnosisName,
      createdAt: new Date().toISOString(),
    });
    return {
      text: `**${fix.label}**\n\n  \`${fix.command}\`\n\n${fix.description}\n\nReply \`/clinic run\` to execute, or \`/clinic done\` if you ran it manually.`,
    };
  }

  // No command — manual fix, save session for /clinic done
  await saveSession({
    sessionId: session.sessionId,
    pendingStepId: "awaiting_fix",
    pendingPrompt: fix.description,
    diagnosisCode: session.diagnosisCode,
    diagnosisName: session.diagnosisName,
    createdAt: new Date().toISOString(),
  });
  return { text: `${fix.description}\n\nReply \`/clinic done\` when complete.` };
}
