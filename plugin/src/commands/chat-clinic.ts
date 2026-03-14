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
import { validateLocally } from "../validation.js";
import { runTreatmentLoop } from "../treatment-loop.js";
import { ClinicNotifier } from "../notifier.js";
import { loadSession, saveSession, clearSession } from "../session-store.js";
import { executeVerificationPlan, type VerificationPlanResult } from "../verification-executor.js";

/**
 * Register /clinic as a chat command via registerCommand.
 * This bypasses the LLM entirely — works even when AI model is down.
 *
 * Usage:
 *   /clinic           — run a fresh diagnosis
 *   /clinic <input>   — if a session is pending, provide follow-up input;
 *                        otherwise run diagnosis with <input> as symptoms
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

// ─── Re-verification ────────────────────────────────────────────

interface VerificationResult {
  passed: boolean;
  checkDescription: string;
  error?: string;
}

async function reVerify(
  diagnosisCode: string,
  config: Record<string, unknown>,
  client?: ClawClinicClient,
): Promise<VerificationResult> {
  // Try backend verification
  if (client) {
    try {
      const verifyResponse = await Promise.race([
        client.verify(diagnosisCode, []),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]);
      if (verifyResponse.steps.length > 0) {
        const planResult = await executeVerificationPlan(
          verifyResponse.steps.map((s) => ({
            type: s.type,
            description: s.description,
            target: (s.params as Record<string, unknown>).target as string | undefined,
            expect: (s.params as Record<string, unknown>).expect as string | undefined,
            pattern: (s.params as Record<string, unknown>).pattern as string | undefined,
          })),
          config,
        );
        if (planResult.passed) {
          return { passed: true, checkDescription: verifyResponse.diseaseName };
        }
        const errors = planResult.results.filter((r) => !r.passed).map((r) => r.error || r.step.description).join("; ");
        return { passed: false, checkDescription: verifyResponse.diseaseName, error: errors };
      }
    } catch { /* timeout or error — fall through */ }
  }

  // Fallback: basic connectivity check
  const conn = await collectConnectivityEvidence(config);
  const failed = conn.providers.filter((p) => !p.reachable || p.authStatus === "failed");
  if (failed.length > 0) {
    return { passed: false, checkDescription: "connectivity", error: failed.map((p) => `${p.name}: ${p.error || "failed"}`).join("; ") };
  }
  return { passed: true, checkDescription: "connectivity" };
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
    lines.push(`Reply ${fixes.length === 1 ? "1" : `1-${fixes.length}`} to apply`);
  }

  return lines.join("\n");
}

// ─── Fresh diagnosis flow ───────────────────────────────────────

async function runDiagnosis(
  api: PluginApi,
  client: ClawClinicClient,
  symptoms: string | undefined,
  channelId: string | undefined,
): Promise<{ text: string }> {
  // Clear any stale session
  await clearSession();

  // Progress ticker: sends an update every 10s for long operations
  let tickCount = 0;
  const TICK_MESSAGES = [
    "Still checking...",
    "Collecting diagnostic data...",
    "Analyzing your agent...",
    "Almost done...",
  ];
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  if (channelId && api.sendChatMessage) {
    tickTimer = setInterval(async () => {
      const msg = TICK_MESSAGES[Math.min(tickCount, TICK_MESSAGES.length - 1)];
      tickCount++;
      try { await api.sendChatMessage!(channelId, msg); } catch { /* ignore */ }
    }, 10_000);
  }

  const stopTicker = () => { if (tickTimer) { clearInterval(tickTimer); tickTimer = undefined; } };

  try {
    // Step 1: Local validation
    const localResult = await validateLocally(api.config);

    // Step 2: Collect evidence
    const evidence = await collectAllEvidence(api.config);

    if (symptoms) {
      evidence.push({ type: "behavior", description: symptoms });
    }
    if (localResult.quickIssues.length > 0) {
      evidence.push({ type: "behavior", description: "Local validation issues", symptoms: localResult.quickIssues });
    }

    // Step 3: Backend diagnosis
    let diagnosis;
    try {
      diagnosis = await client.diagnose(evidence, symptoms);
    } catch (err) {
      stopTicker();
      const msg = err instanceof Error ? err.message : String(err);
      if (localResult.quickIssues.length > 0) {
        return { text: localResult.quickIssues.map((i) => `- ${i}`).join("\n") };
      }
      return { text: `Could not reach diagnostic backend: ${msg}` };
    }

    if (!diagnosis.diagnosis) {
      stopTicker();
      return { text: "Your agent appears healthy. No issues detected." };
    }

    // Step 3.5: Pre-verify — check if the diagnosed issue is still active
    const preVerification = await reVerify(diagnosis.diagnosis.icd_ai_code, api.config, client);
    if (preVerification.passed && !symptoms) {
      stopTicker();
      return { text: `Previously detected **${diagnosis.diagnosis.name}** has already been resolved. No action needed.` };
    }

    // Step 4: If AI returned checks/fixes, use new compact flow
    if (diagnosis.checks?.length || diagnosis.fixes?.length) {
      // Execute checks locally
      const checkResults = await executeChecks(diagnosis.checks || [], api.config);

      // Format compact result
      const text = formatCompactResult(diagnosis.diagnosis, checkResults, diagnosis.fixes || []);

      // Save fixes in session for user selection
      if (diagnosis.fixes?.length) {
        await saveSession({
          sessionId: diagnosis.sessionId,
          pendingStepId: "fix_selection",
          pendingPrompt: `Reply 1-${diagnosis.fixes.length}`,
          diagnosisCode: diagnosis.diagnosis.icd_ai_code,
          diagnosisName: diagnosis.diagnosis.name,
          createdAt: new Date().toISOString(),
          pendingFixes: diagnosis.fixes,
        });
      }

      stopTicker();
      return { text };
    }

    // Step 5: Fallback — old treatment loop flow
    if (diagnosis.treatmentPlan.length > 0) {
      const notifier = new ClinicNotifier(api, { mode: "tool" });
      const isNovelCode = !!diagnosis.isNovelCode;

      const loopResult = await runTreatmentLoop({
        client,
        sessionId: diagnosis.sessionId,
        treatmentPlan: diagnosis.treatmentPlan,
        notifier,
        config: api.config,
      });

      stopTicker();

      // If paused for input, save session so /clinic <input> resumes
      if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
        await saveSession({
          sessionId: diagnosis.sessionId,
          pendingStepId: loopResult.pendingStep.id,
          pendingPrompt: loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description,
          diagnosisCode: diagnosis.diagnosis.icd_ai_code,
          diagnosisName: diagnosis.diagnosis.name,
          createdAt: new Date().toISOString(),
          isNovelCode,
        });
      }

      // For novel codes that completed treatment, re-diagnose to verify
      if (isNovelCode && loopResult.status === "resolved") {
        const recheck = await reDiagnoseAfterTreatment(api, client, diagnosis.diagnosis, symptoms);
        if (recheck) return { text: recheck };
      }

      return { text: formatFallbackResult(diagnosis.diagnosis, loopResult) };
    }

    stopTicker();
    return { text: `**${diagnosis.diagnosis.name}**\n\n${diagnosis.diagnosis.reasoning}` };
  } catch (err) {
    stopTicker();
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Clinic error: ${message}` };
  }
}

// ─── Follow-up flow (resume pending session) ────────────────────

async function handleFollowUp(
  api: PluginApi,
  client: ClawClinicClient,
  session: StoredSession,
  userInput: string,
): Promise<{ text: string }> {
  const trimmedInput = userInput.trim();

  // Numeric fix selection
  if (session.pendingFixes?.length && /^[1-9]$/.test(trimmedInput)) {
    const fixIndex = parseInt(trimmedInput, 10) - 1;
    if (fixIndex >= session.pendingFixes.length) {
      return { text: `Pick 1-${session.pendingFixes.length}` };
    }
    const fix = session.pendingFixes[fixIndex];
    return executeFix(api, client, session, fix);
  }

  // Pasted API key detection
  const inputProvider = detectProvider(trimmedInput);

  if (inputProvider) {
    // User pasted a key — validate format
    const validation = validateKeyFormat(trimmedInput);
    if (!validation.valid) {
      return { text: `That key doesn't look right: ${validation.issue}\n\nPlease paste the correct full key.` };
    }

    // Valid format — write to auth-profiles.json
    const writeResult = await writeApiKeyToAuthProfiles(trimmedInput, inputProvider);
    if (!writeResult.success) {
      return { text: `Could not save the key: ${writeResult.error}\n\nAs a fallback, run this in your terminal:\n  openclaw config set ${inputProvider}.apiKey ${maskApiKey(trimmedInput)}...\nThen reply: /clinic done` };
    }

    // Re-verify connection with the new key
    const verification = await reVerify(session.diagnosisCode, api.config, client);
    if (verification.passed) {
      // Report success to backend with masked key
      try {
        await client.treat(session.sessionId, session.pendingStepId, {
          success: true,
          data: { userInput: maskApiKey(trimmedInput), keyUpdated: true, provider: inputProvider },
        });
      } catch {
        // Backend report is best-effort
      }
      await clearSession();
      return { text: `Your new ${inputProvider} API key is working. The issue is fixed.\n\nFor security, please delete the message containing your API key from this chat.` };
    } else {
      // Key saved but doesn't work
      await saveSession({
        sessionId: session.sessionId,
        pendingStepId: session.pendingStepId,
        pendingPrompt: session.pendingPrompt,
        diagnosisCode: session.diagnosisCode,
        diagnosisName: session.diagnosisName,
        createdAt: new Date().toISOString(),
        detectedProvider: inputProvider,
      });
      return { text: `I saved your key but it's not working \u2014 ${verification.error}\n\nPlease double-check that you copied the correct key. Paste the right key here to try again.` };
    }
  }

  // /clinic done — re-verify
  if (/^done$/i.test(trimmedInput)) {
    const verification = await reVerify(session.diagnosisCode, api.config, client);
    if (verification.passed) {
      await clearSession();
      return { text: `**${session.diagnosisName}** \u2014 Fixed.` };
    }
    return { text: `**${session.diagnosisName}** \u2014 still detected.\n\n${verification.error || "Issue persists."}` };
  }

  // Unknown input
  if (session.pendingFixes?.length) {
    return { text: `Reply 1-${session.pendingFixes.length} to pick a fix, or /clinic done if you fixed it manually.` };
  }
  return { text: "Reply /clinic done when you've fixed the issue." };
}

// ─── Execute a selected fix ─────────────────────────────────────

async function executeFix(
  _api: PluginApi,
  _client: ClawClinicClient,
  session: StoredSession,
  fix: { label: string; command?: string; description: string },
): Promise<{ text: string }> {
  if (fix.command) {
    // Save session for /clinic done re-verification
    await saveSession({
      sessionId: session.sessionId,
      pendingStepId: "awaiting_fix",
      pendingPrompt: fix.command,
      diagnosisCode: session.diagnosisCode,
      diagnosisName: session.diagnosisName,
      createdAt: new Date().toISOString(),
    });

    return {
      text: `Run this:\n\n  \`${fix.command}\`\n\nThen reply \`/clinic done\``,
    };
  }

  // No command — just description
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

// ─── Novel code re-diagnosis loop ────────────────────────────────

const MAX_REDIAGNOSE_ROUNDS = 3;

interface DiagnosisInfo {
  icd_ai_code: string;
  name: string;
}

async function reDiagnoseAfterTreatment(
  api: PluginApi,
  client: ClawClinicClient,
  originalDiag: DiagnosisInfo,
  originalSymptoms: string | undefined,
): Promise<string | null> {
  const lines: string[] = [];

  for (let round = 1; round <= MAX_REDIAGNOSE_ROUNDS; round++) {
    lines.push(`\n**Re-checking** (round ${round}/${MAX_REDIAGNOSE_ROUNDS})...`);

    const freshEvidence = await collectAllEvidence(api.config);
    if (originalSymptoms) {
      freshEvidence.push({ type: "behavior", description: originalSymptoms });
    }

    let reDiagnosis;
    try {
      reDiagnosis = await client.diagnose(freshEvidence, originalSymptoms);
    } catch {
      lines.push("Could not reach backend for re-diagnosis.");
      break;
    }

    if (!reDiagnosis.diagnosis || reDiagnosis.diagnosis.icd_ai_code !== originalDiag.icd_ai_code) {
      lines.push(`**${originalDiag.name}** appears resolved after treatment.`);
      return lines.join("\n");
    }

    if (reDiagnosis.treatmentPlan.length === 0) {
      lines.push(`**${originalDiag.name}** persists but no further treatment steps available. Manual intervention may be needed.`);
      return lines.join("\n");
    }

    lines.push(`**${originalDiag.name}** still detected. Applying next round of treatment...`);

    const notifier = new ClinicNotifier(api, { mode: "tool" });
    const loopResult = await runTreatmentLoop({
      client,
      sessionId: reDiagnosis.sessionId,
      treatmentPlan: reDiagnosis.treatmentPlan,
      notifier,
      config: api.config,
    });

    if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
      await saveSession({
        sessionId: reDiagnosis.sessionId,
        pendingStepId: loopResult.pendingStep.id,
        pendingPrompt: loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description,
        diagnosisCode: reDiagnosis.diagnosis.icd_ai_code,
        diagnosisName: reDiagnosis.diagnosis.name,
        createdAt: new Date().toISOString(),
        isNovelCode: true,
      });
      lines.push(`\nTreatment paused \u2014 awaiting your input:\n${loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description}`);
      lines.push("\nReply with `/clinic done` when complete, or `/clinic help` for instructions.");
      return lines.join("\n");
    }

    if (loopResult.status === "failed") {
      lines.push(`Treatment failed: ${loopResult.message}`);
      return lines.join("\n");
    }
  }

  lines.push(`\nReached max re-diagnosis rounds (${MAX_REDIAGNOSE_ROUNDS}). Run \`/clinic\` again to continue.`);
  return lines.join("\n");
}

// ─── Fallback formatting (for old treatment loop flow) ──────────

interface LoopResult {
  status: string;
  stepsCompleted: number;
  stepsTotal: number;
  message: string;
  pendingStep?: { id: string; description: string; inputPrompt?: string };
}

function formatFallbackResult(d: { name: string; reasoning: string }, loop: LoopResult): string {
  const lines: string[] = [];
  lines.push(`**${d.name}**`);

  if (loop.status === "resolved") {
    lines.push("");
    lines.push(`Fixed \u2014 ${loop.message}`);
  } else if (loop.status === "paused_for_input" && loop.pendingStep) {
    lines.push("");
    lines.push(d.reasoning);
    lines.push("");
    lines.push(loop.pendingStep.inputPrompt || loop.pendingStep.description);
    lines.push("");
    lines.push("Reply with `/clinic done` when you've completed the steps.");
  } else if (loop.status === "failed") {
    lines.push("");
    lines.push(`Treatment failed: ${loop.message}`);
  } else {
    lines.push("");
    lines.push(loop.message);
  }

  return lines.join("\n");
}
