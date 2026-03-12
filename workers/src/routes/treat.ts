import { Hono } from "hono";
import type { TreatmentStep } from "./types.js";

interface TreatmentSession {
  sessionId: string;
  icdCode: string;
  steps: TreatmentStep[];
  currentStepIndex: number;
  results: Array<{ stepId: string; success: boolean; data?: Record<string, unknown>; error?: string }>;
  status: "in_progress" | "resolved" | "failed";
  createdAt: number;
}

// In-memory session store
const sessions = new Map<string, TreatmentSession>();

// Export for use by diagnose route (to create sessions)
export function createSession(sessionId: string, icdCode: string, steps: TreatmentStep[]): void {
  sessions.set(sessionId, {
    sessionId,
    icdCode,
    steps,
    currentStepIndex: 0,
    results: [],
    status: "in_progress",
    createdAt: Date.now(),
  });
}

export function getSession(sessionId: string): TreatmentSession | undefined {
  return sessions.get(sessionId);
}

const treatRouter = new Hono();

treatRouter.post("/", async (c) => {
  const body = await c.req.json();
  const { sessionId, stepId, stepResult } = body;

  if (!sessionId || !stepId) {
    return c.json({ error: "sessionId and stepId are required" }, 400);
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return c.json({ error: `Session ${sessionId} not found` }, 404);
  }

  if (session.status !== "in_progress") {
    return c.json({
      status: session.status,
      message: `Session already ${session.status}`,
      sessionId,
    });
  }

  // Record the step result
  session.results.push({
    stepId,
    success: stepResult?.success ?? true,
    data: stepResult?.data,
    error: stepResult?.error,
  });

  // If step failed, mark session as failed
  if (stepResult?.success === false) {
    session.status = "failed";
    return c.json({
      status: "failed",
      message: `Treatment step ${stepId} failed: ${stepResult.error || "unknown error"}`,
      sessionId,
    });
  }

  // Move to next step
  session.currentStepIndex++;

  // Check if all steps complete
  if (session.currentStepIndex >= session.steps.length) {
    session.status = "resolved";
    return c.json({
      status: "resolved",
      message: "All treatment steps completed successfully. The issue should now be resolved.",
      sessionId,
    });
  }

  // Return next step
  const nextStep = session.steps[session.currentStepIndex];
  return c.json({
    status: "next",
    nextStep,
    message: `Step ${stepId} completed. Proceeding to next step.`,
    sessionId,
  });
});

export default treatRouter;
