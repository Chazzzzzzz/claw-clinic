import type { PluginApi, ConnectivityEvidence } from "../types.js";
import type { StoredSession } from "../session-store.js";
import { ClawClinicClient } from "../client.js";
import {
  collectAllEvidence,
  collectConnectivityEvidence,
  collectConfigEvidence,
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
import { getUserGuide, getKeyLengthGuide } from "../user-guides.js";
import { executeVerificationPlan } from "../verification-executor.js";

/**
 * Disease codes that have local fast-path UX in the plugin (reVerify, getUserGuide).
 * Backend AI handles all diagnosis — these codes just tell the plugin which
 * diseases have specialized local treatment flows.
 */
const LOCAL_FAST_PATH_CODES = [
  "CFG.1.1", // API Key Format Error — local key format validation + guide
  "CFG.1.2", // API Key Missing — local key presence check + guide
  "CFG.2.1", // Endpoint Misconfiguration — local connectivity reVerify
  "CFG.3.1", // Auth Failure — local auth re-test via connectivity
  "O.4.1",   // Tool Permission Denial — local permission re-check
] as const;

// Exported for testing only
export { LOCAL_FAST_PATH_CODES };

/**
 * Register /clinic as a chat command via registerCommand.
 * This bypasses the LLM entirely — works even when AI model is down.
 *
 * Usage:
 *   /clinic           — run a fresh diagnosis
 *   /clinic help      — re-send guide for current pending step
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
          // Req 1c: /clinic help re-sends the guide for the current step
          if (input.toLowerCase() === "help") {
            const guide = getUserGuide(pending.diagnosisCode, pending.detectedProvider);
            return { text: `**${pending.diagnosisName}** — here are the instructions again:\n\n${guide}` };
          }
          return await handleFollowUp(api, client, pending, input);
        }
        // No pending session → treat input as symptoms for a fresh diagnosis
      }

      // --- Fresh diagnosis ---
      return await runDiagnosis(api, client, input, channelId);
    },
  });
}

// ─── Ambiguity detection (Req 1b) ───────────────────────────────

const AMBIGUOUS_PATTERNS = [
  /\bwhat\b/i,
  /\bhow\b/i,
  /\bwhy\b/i,
  /\?/,
  /\bi don'?t understand\b/i,
  /\bhelp\b/i,
  /\bstill not working\b/i,
  /\bstill broken\b/i,
];

const AFFIRMATIVE_PATTERNS = [
  /\bdone\b/i,
  /\bupdated\b/i,
  /\bfixed\b/i,
  /\bchanged\b/i,
  /\bnew key\b/i,
];

function isAmbiguousResponse(text: string): boolean {
  const hasAmbiguous = AMBIGUOUS_PATTERNS.some((p) => p.test(text));
  if (!hasAmbiguous) return false;
  // If also contains affirmative, treat as affirmative
  const hasAffirmative = AFFIRMATIVE_PATTERNS.some((p) => p.test(text));
  return !hasAffirmative;
}

function isAffirmativeResponse(text: string): boolean {
  return AFFIRMATIVE_PATTERNS.some((p) => p.test(text));
}

// ─── Re-verification (Req 1a) ──────────────────────────────────

interface VerificationResult {
  passed: boolean;
  checkDescription: string;
  error?: string;
  unverified?: boolean;
}

async function reVerify(
  diagnosisCode: string,
  config: Record<string, unknown>,
  client?: ClawClinicClient,
): Promise<VerificationResult> {
  switch (diagnosisCode) {
    case "CFG.3.1": {
      // Auth Failure: re-run connectivity and check authStatus
      const conn = await collectConnectivityEvidence(config);
      const failedProviders = conn.providers.filter((p) => p.authStatus === "failed");
      if (failedProviders.length > 0) {
        const names = failedProviders.map((p) => `${p.name} (HTTP ${p.authStatusCode})`).join(", ");
        return { passed: false, checkDescription: "API key authentication", error: `Auth still failing for: ${names}` };
      }
      return { passed: true, checkDescription: "API key authentication" };
    }

    case "CFG.1.2": {
      // API Key Missing: re-run config evidence and check if key is present
      const configEvidence = collectConfigEvidence(config);
      if (!configEvidence.apiKey) {
        return { passed: false, checkDescription: "API key presence", error: "No API key found in config. Make sure you ran the config set command." };
      }
      return { passed: true, checkDescription: "API key presence" };
    }

    case "CFG.2.1": {
      // Endpoint Misconfiguration: re-run connectivity and check reachability
      const conn = await collectConnectivityEvidence(config);
      const unreachable = conn.providers.filter((p) => !p.reachable);
      if (unreachable.length > 0) {
        const names = unreachable.map((p) => `${p.name}: ${p.error || "unreachable"}`).join(", ");
        return { passed: false, checkDescription: "endpoint reachability", error: `Still unreachable: ${names}` };
      }
      return { passed: true, checkDescription: "endpoint reachability" };
    }

    case "CFG.1.1": {
      // API Key Format Error: re-validate key format
      const apiKey = extractApiKey(config);
      if (!apiKey) {
        return { passed: false, checkDescription: "API key format", error: "No API key found to validate." };
      }
      const validation = validateKeyFormat(apiKey);
      if (!validation.valid) {
        return { passed: false, checkDescription: "API key format", error: validation.issue || "Key format is still invalid." };
      }
      return { passed: true, checkDescription: "API key format" };
    }

    default: {
      // Non-CFG codes: call backend verify endpoint for a dynamic verification plan
      // with a 5-second timeout to avoid blocking the user
      if (!client) {
        return { passed: false, checkDescription: "general check", unverified: true };
      }
      try {
        const VERIFY_TIMEOUT_MS = 5_000;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Verification timed out")), VERIFY_TIMEOUT_MS),
        );

        const verifyResponse = await Promise.race([
          client.verify(diagnosisCode, []),
          timeoutPromise,
        ]);
        if (verifyResponse.steps.length === 0) {
          // No verification steps available — proceed to treatment
          return { passed: false, checkDescription: "general check", unverified: true };
        }
        const planResult = await Promise.race([
          executeVerificationPlan(
            verifyResponse.steps.map((s) => ({
              type: s.type,
              description: s.description,
              target: (s.params as Record<string, unknown>).target as string | undefined,
              expect: (s.params as Record<string, unknown>).expect as string | undefined,
              pattern: (s.params as Record<string, unknown>).pattern as string | undefined,
            })),
            config,
          ),
          timeoutPromise,
        ]);
        if (planResult.passed) {
          return { passed: true, checkDescription: verifyResponse.diseaseName };
        }
        const failedSteps = planResult.results.filter((r) => !r.passed);
        const errors = failedSteps.map((r) => r.error || r.step.description).join("; ");
        return { passed: false, checkDescription: verifyResponse.diseaseName, error: errors };
      } catch {
        // Backend unreachable or timed out — fall through to treatment with unverified note
        return { passed: false, checkDescription: "general check", unverified: true };
      }
    }
  }
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

    // Step 2.5: Check connectivity evidence locally for auth failures
    const connEvidence = evidence.find((e): e is ConnectivityEvidence => e.type === "connectivity");
    const localAuthIssue = formatLocalAuthIssue(connEvidence);

    // Detect provider for guide personalization
    const apiKey = extractApiKey(api.config);
    const detectedProvider = apiKey ? detectProvider(apiKey) : undefined;

    // Step 3: Backend diagnosis
    let diagnosis;
    try {
      diagnosis = await client.diagnose(evidence, symptoms);
    } catch (err) {
      stopTicker();
      const msg = err instanceof Error ? err.message : String(err);
      if (localAuthIssue) return { text: localAuthIssue };
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
    // Skip pre-verify shortcut when user explicitly described symptoms — they're
    // reporting a NEW problem, not asking about the old one.
    const preVerification = await reVerify(diagnosis.diagnosis.icd_ai_code, api.config, client);
    if (preVerification.passed && !symptoms) {
      stopTicker();
      return { text: `Previously detected **${diagnosis.diagnosis.name}** has already been resolved. No action needed.` };
    }

    const unverifiedNote = preVerification.unverified
      ? "\n\n*Note: Could not verify if this issue is still active. Proceeding with treatment.*"
      : "";

    // Step 4: Auto-execute treatment
    if (diagnosis.treatmentPlan.length > 0) {
      const notifier = new ClinicNotifier(api, { mode: "tool" });

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
          detectedProvider,
        });
      }

      return { text: formatResult(diagnosis.diagnosis, loopResult, detectedProvider) + unverifiedNote };
    }

    stopTicker();
    return { text: formatDiagnosisOnly(diagnosis.diagnosis) + unverifiedNote };
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
  // Detect pasted API key — check BEFORE ambiguity detection
  const trimmedInput = userInput.trim();
  const inputProvider = detectProvider(trimmedInput);

  if (inputProvider) {
    // User pasted a key — validate format
    const validation = validateKeyFormat(trimmedInput);
    if (!validation.valid) {
      // Bad format — show length guide, don't write
      const lengthGuide = getKeyLengthGuide(trimmedInput.length, inputProvider);
      return { text: `That key doesn't look right: ${validation.issue}\n\n${lengthGuide}\n\nPlease paste the correct full key.` };
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
      return { text: `I saved your key but it's not working — ${verification.error}\n\nPlease double-check that you copied the correct key. Paste the right key here to try again.` };
    }
  }

  const guide = getUserGuide(session.diagnosisCode, session.detectedProvider);

  // Req 1b: Detect ambiguous user responses — re-send instructions
  if (isAmbiguousResponse(userInput) && !isAffirmativeResponse(userInput)) {
    return {
      text: `It sounds like you still need help. Here are the instructions again:\n\n${guide}\n\nReply with \`/clinic done\` when you've completed the steps.`,
    };
  }

  // Req 1b: Only advance when user gives affirmative response or re-test passes
  // For non-affirmative, non-ambiguous input, still try re-verification
  const isAffirmative = isAffirmativeResponse(userInput);

  // Req 1a: Re-verify before claiming "Fixed"
  const verification = await reVerify(session.diagnosisCode, api.config, client);

  if (!verification.passed) {
    // Re-test failed — do NOT advance. Keep session paused.
    // Re-save session to keep it alive
    await saveSession({
      sessionId: session.sessionId,
      pendingStepId: session.pendingStepId,
      pendingPrompt: session.pendingPrompt,
      diagnosisCode: session.diagnosisCode,
      diagnosisName: session.diagnosisName,
      createdAt: session.createdAt,
      detectedProvider: session.detectedProvider,
    });

    const keyLengthHint = buildKeyLengthHint(session.diagnosisCode, api.config);

    return {
      text: `**${session.diagnosisName}** — still failing.\n\n${verification.error}${keyLengthHint}\n\nPlease try again:\n\n${guide}`,
    };
  }

  // Re-test passed — advance
  if (!isAffirmative && verification.checkDescription === "general check") {
    // No re-verification available and user didn't say affirmative — re-send guide
    return {
      text: `Please complete the steps and reply with \`/clinic done\`:\n\n${guide}`,
    };
  }

  try {
    const response = await client.treat(session.sessionId, session.pendingStepId, {
      success: true,
      data: { userInput },
    });

    if (response.status === "resolved") {
      await clearSession();
      return { text: `**${session.diagnosisName}** — Fixed — verified that ${verification.checkDescription} is now passing.` };
    }

    if (response.status === "next" && response.nextStep) {
      // Auto-continue remaining non-interactive steps
      const notifier = new ClinicNotifier(api, { mode: "tool" });
      const loopResult = await runTreatmentLoop({
        client,
        sessionId: session.sessionId,
        treatmentPlan: [response.nextStep],
        notifier,
        config: api.config,
      });

      if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
        await saveSession({
          sessionId: session.sessionId,
          pendingStepId: loopResult.pendingStep.id,
          pendingPrompt: loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description,
          diagnosisCode: session.diagnosisCode,
          diagnosisName: session.diagnosisName,
          createdAt: new Date().toISOString(),
          detectedProvider: session.detectedProvider,
        });
        const nextGuide = getUserGuide(session.diagnosisCode, session.detectedProvider);
        return { text: nextGuide + "\n\nReply with `/clinic <your response>` to continue." };
      }

      if (loopResult.status === "resolved") {
        await clearSession();
        return { text: `**${session.diagnosisName}** — Fixed — verified that ${verification.checkDescription} is now passing.` };
      }

      await clearSession();
      return { text: `Treatment ${loopResult.status}: ${loopResult.message}` };
    }

    if (response.status === "failed") {
      await clearSession();
      return { text: `Treatment failed: ${response.message}` };
    }

    await clearSession();
    return { text: response.message };
  } catch (err) {
    await clearSession();
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `Error resuming treatment: ${msg}` };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/** Build key-length hint if the diagnosis is about key format. */
function buildKeyLengthHint(diagnosisCode: string, config: Record<string, unknown>): string {
  if (diagnosisCode !== "CFG.1.1") return "";
  const apiKey = extractApiKey(config);
  if (!apiKey) return "";
  const provider = detectProvider(apiKey);
  return "\n\n" + getKeyLengthGuide(apiKey.length, provider);
}

// ─── Formatting helpers ─────────────────────────────────────────

interface DiagnosisDetail {
  icd_ai_code: string;
  name: string;
  confidence: number;
  severity: string;
  reasoning: string;
}

interface LoopResult {
  status: string;
  stepsCompleted: number;
  stepsTotal: number;
  message: string;
  pendingStep?: { id: string; description: string; inputPrompt?: string };
}

function formatResult(d: DiagnosisDetail, loop: LoopResult, detectedProvider?: string): string {
  const lines: string[] = [];
  lines.push(`**${d.name}**`);

  if (loop.status === "resolved") {
    lines.push("");
    lines.push(`Fixed — ${loop.message}`);
  } else if (loop.status === "paused_for_input" && loop.pendingStep) {
    lines.push("");
    lines.push(humanizeReasoning(d.reasoning));
    lines.push("");
    // Use user guide instead of raw prescription text
    const guide = getUserGuide(d.icd_ai_code, detectedProvider);
    lines.push(guide);
    lines.push("");
    lines.push("Reply with `/clinic done` when you've completed the steps, or `/clinic help` to see these instructions again.");
  } else if (loop.status === "failed") {
    lines.push("");
    lines.push(`Treatment failed: ${loop.message}`);
  } else {
    lines.push("");
    lines.push(loop.message);
  }

  return lines.join("\n");
}

function formatDiagnosisOnly(d: DiagnosisDetail): string {
  return `**${d.name}**\n\n${humanizeReasoning(d.reasoning)}`;
}

/** Strip raw JSON / HTTP details from reasoning, keep the human-readable part. */
function humanizeReasoning(reasoning: string): string {
  let clean = reasoning.replace(/\{[^}]{20,}\}/g, "").trim();
  clean = clean.replace(/\s*Details:.*$/i, "").trim();
  clean = clean.replace(/\.\s*$/, ".");
  return clean || reasoning;
}

function formatLocalAuthIssue(conn: ConnectivityEvidence | undefined): string | null {
  if (!conn) return null;

  const authFailed = conn.providers.filter((p) => p.authStatus === "failed");
  const serverErrors = conn.providers.filter((p) => p.authStatus === "server_error");
  const rateLimited = conn.providers.filter((p) => p.authStatus === "rate_limited");

  if (authFailed.length === 0 && serverErrors.length === 0 && rateLimited.length === 0) {
    return null;
  }

  const lines: string[] = [];

  for (const p of authFailed) {
    lines.push(`**Auth Failure** — ${p.name} rejected your API key (HTTP ${p.authStatusCode}).`);
    lines.push("");
    lines.push(getUserGuide("CFG.3.1", p.name));
  }

  for (const p of serverErrors) {
    lines.push(`**Service Error** — ${p.name} returned a server error.`);
    lines.push("");
    lines.push("The provider may be experiencing an outage. Please try again later.");
  }

  for (const p of rateLimited) {
    lines.push(`**Rate Limited** — ${p.name} is throttling requests (HTTP 429).`);
    lines.push("");
    lines.push("Please wait a few minutes and try again, or check your usage limits.");
  }

  return lines.join("\n");
}
