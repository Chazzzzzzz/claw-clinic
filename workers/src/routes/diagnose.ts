import { Hono } from "hono";
import type { Evidence } from "@claw-clinic/shared";
import { createSession } from "./treat.js";
import type { TreatmentStep } from "./types.js";
import { aiDiagnose } from "../ai-diagnostician.js";

const diagnoseRouter = new Hono();

// Generate session ID
function generateSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

diagnoseRouter.post("/diagnose", async (c) => {
  try {
    const body = await c.req.json<{
      evidence?: Evidence[];
      symptoms?: string;
    }>();

    const { evidence = [], symptoms } = body;
    const sessionId = generateSessionId();

    // AI-powered diagnosis — the only path
    const aiResult = await aiDiagnose(evidence, symptoms);

    if (!aiResult) {
      return c.json({
        sessionId,
        diagnosis: null,
        differential: [],
        checks: [],
        fixes: [],
        treatmentPlan: [],
        summary: "AI diagnostician unavailable. Set ANTHROPIC_API_KEY to enable diagnosis.",
      });
    }

    // Convert AI treatment steps to session treatment plan
    const treatmentPlan: TreatmentStep[] = aiResult.treatmentSteps.map((step, i) => ({
      id: `step_${i + 1}`,
      action: step.action,
      description: step.command,
      requiresUserInput: false,
      expectedOutput: step.expected_output,
      next: step.next,
    }));

    if (treatmentPlan.length > 0) {
      createSession(sessionId, aiResult.icd_ai_code, treatmentPlan);
    }

    return c.json({
      sessionId,
      diagnosis: {
        icd_ai_code: aiResult.icd_ai_code,
        name: aiResult.name,
        confidence: aiResult.confidence,
        severity: aiResult.severity,
        reasoning: aiResult.reasoning,
      },
      differential: aiResult.differential,
      checks: aiResult.checks || [],
      fixes: aiResult.fixes || [],
      treatmentPlan,
      summary: `Diagnosed ${aiResult.name} (${aiResult.icd_ai_code}) with ${Math.round(aiResult.confidence * 100)}% confidence. ${aiResult.reasoning}`,
    });
  } catch (err) {
    return c.json(
      {
        error: "Invalid request body",
        details: err instanceof Error ? err.message : String(err),
      },
      400
    );
  }
});

export default diagnoseRouter;
