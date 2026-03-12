import type { TreatmentStep, TreatmentResponse } from "./types.js";
import type { ClawClinicClient } from "./client.js";
import type { ClinicNotifier } from "./notifier.js";
import { collectConnectivityEvidence, collectConfigEvidence } from "./evidence.js";

export interface TreatmentLoopOptions {
  client: ClawClinicClient;
  sessionId: string;
  treatmentPlan: TreatmentStep[];
  notifier: ClinicNotifier;
  config: Record<string, unknown>;
  maxSteps?: number;
  /** Called when a step requires user input. Return input string, or null to cancel. */
  onUserInputRequired?: (step: TreatmentStep) => Promise<string | null>;
}

export interface TreatmentLoopResult {
  status: "resolved" | "failed" | "cancelled" | "max_steps_reached" | "paused_for_input";
  stepsCompleted: number;
  stepsTotal: number;
  message: string;
  /** Set when paused_for_input — tells the caller what to ask the user. */
  pendingStep?: TreatmentStep;
}

/**
 * Automatically executes treatment steps, reporting each result back to the backend.
 * Pauses when user input is required (if no onUserInputRequired callback provided).
 */
export async function runTreatmentLoop(opts: TreatmentLoopOptions): Promise<TreatmentLoopResult> {
  const {
    client,
    sessionId,
    treatmentPlan,
    notifier,
    config,
    maxSteps = 20,
    onUserInputRequired,
  } = opts;

  const total = treatmentPlan.length;
  let completed = 0;

  for (let i = 0; i < total && completed < maxSteps; i++) {
    const step = treatmentPlan[i];
    await notifier.progress(i, total, step.description);

    // If step requires user input, either ask or pause
    if (step.requiresUserInput) {
      if (onUserInputRequired) {
        const input = await onUserInputRequired(step);
        if (input === null) {
          await notifier.status("Treatment cancelled by user.");
          return { status: "cancelled", stepsCompleted: completed, stepsTotal: total, message: "Cancelled by user." };
        }
        // Execute with user input
        const response = await executeAndReport(client, sessionId, step, notifier, { userInput: input });
        completed++;
        const loopResult = checkResponse(response, completed, total);
        if (loopResult) return loopResult;
      } else {
        // No callback — pause and let the caller handle user input
        await notifier.status(
          `Paused: step "${step.description}" requires your input` +
          (step.inputPrompt ? `: ${step.inputPrompt}` : "."),
        );
        return {
          status: "paused_for_input",
          stepsCompleted: completed,
          stepsTotal: total,
          message: step.inputPrompt || step.description,
          pendingStep: step,
        };
      }
    } else {
      // Auto-execute the step
      const localResult = await executeStepLocally(step, config);
      const response = await executeAndReport(client, sessionId, step, notifier, localResult.data, localResult.success, localResult.error);
      completed++;
      const loopResult = checkResponse(response, completed, total);
      if (loopResult) return loopResult;
    }
  }

  if (completed >= maxSteps) {
    await notifier.error(`Reached maximum step limit (${maxSteps}). Stopping treatment.`);
    return { status: "max_steps_reached", stepsCompleted: completed, stepsTotal: total, message: `Reached limit of ${maxSteps} steps.` };
  }

  await notifier.success("All treatment steps completed.");
  return { status: "resolved", stepsCompleted: completed, stepsTotal: total, message: "Treatment completed successfully." };
}

// ─── Helpers ────────────────────────────────────────────────────

async function executeAndReport(
  client: ClawClinicClient,
  sessionId: string,
  step: TreatmentStep,
  notifier: ClinicNotifier,
  data?: Record<string, unknown>,
  success = true,
  error?: string,
): Promise<TreatmentResponse> {
  try {
    const response = await client.treat(sessionId, step.id, {
      success,
      data,
      error,
    });

    if (response.status === "resolved") {
      await notifier.success(`Step "${step.description}" — resolved!`);
    } else if (response.status === "failed") {
      await notifier.error(`Step "${step.description}" — ${response.message}`);
    } else {
      await notifier.status(`Step "${step.description}" — done. ${response.message}`);
    }

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await notifier.error(`Failed to report step "${step.id}" to backend: ${msg}`);
    return { status: "failed", message: msg, sessionId };
  }
}

function checkResponse(
  response: TreatmentResponse,
  completed: number,
  total: number,
): TreatmentLoopResult | null {
  if (response.status === "resolved") {
    return { status: "resolved", stepsCompleted: completed, stepsTotal: total, message: response.message };
  }
  if (response.status === "failed") {
    return { status: "failed", stepsCompleted: completed, stepsTotal: total, message: response.message };
  }
  // "next" — continue the loop
  return null;
}

/**
 * Attempt to execute a treatment step locally.
 * Returns data to send back to the backend.
 */
async function executeStepLocally(
  step: TreatmentStep,
  config: Record<string, unknown>,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  switch (step.action) {
    case "validate_config": {
      const evidence = collectConfigEvidence(config);
      const issues: string[] = [];
      if (evidence.errorLogs) issues.push(...evidence.errorLogs);
      return {
        success: issues.length === 0,
        data: { configValid: issues.length === 0, issues },
        error: issues.length > 0 ? issues.join("; ") : undefined,
      };
    }

    case "test_connection": {
      const connectivity = await collectConnectivityEvidence(config);
      const unreachable = connectivity.providers.filter((p) => !p.reachable);
      return {
        success: unreachable.length === 0,
        data: {
          providers: connectivity.providers.map((p) => ({
            name: p.name,
            reachable: p.reachable,
            latencyMs: p.latencyMs,
            error: p.error,
          })),
          gatewayReachable: connectivity.gatewayReachable,
        },
        error: unreachable.length > 0
          ? `Unreachable: ${unreachable.map((p) => p.name).join(", ")}`
          : undefined,
      };
    }

    case "report":
      return { success: true, data: { acknowledged: true } };

    case "update_config":
      // Cannot auto-update config without user confirmation
      return { success: true, data: { note: "Config update suggested — needs manual application." } };

    case "prompt_user":
      // Should not reach here — handled by requiresUserInput check above
      return { success: false, error: "Step requires user input" };

    default:
      return { success: true, data: { note: `Unknown action: ${step.action}` } };
  }
}
