import { Hono } from "hono";
import {
  MVP_DISEASES,
  STANDARD_PRESCRIPTIONS,
  matchDiseases,
  createMinimalSymptomVector,
} from "@claw-clinic/shared";
import type { Evidence, EnvironmentEvidence, RuntimeEvidence } from "@claw-clinic/shared";
import { createSession } from "./treat.js";
import type { TreatmentStep } from "./types.js";
import { aiDiagnose } from "../ai-diagnostician.js";

const diagnoseRouter = new Hono();

// Generate session ID
function generateSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// Build treatment plan based on diagnosis
function buildTreatmentPlan(icdCode: string): TreatmentStep[] {
  const rx = STANDARD_PRESCRIPTIONS.find((p) => p.target_disease === icdCode);
  if (!rx) return [];

  return rx.steps.map((step, i) => ({
    id: `step_${i + 1}`,
    action: mapAction(step.target),
    description: step.change,
    requiresUserInput: step.target === "user_interaction",
    inputPrompt: step.target === "user_interaction" ? step.change : undefined,
  }));
}

function mapAction(target: string): string {
  switch (target) {
    case "user_interaction":
      return "prompt_user";
    case "api_key":
    case "endpoint_url":
      return "update_config";
    case "verification":
      return "test_connection";
    case "config_inspection":
    case "diagnosis":
      return "validate_config";
    default:
      return "report";
  }
}

diagnoseRouter.post("/diagnose", async (c) => {
  try {
    const body = await c.req.json<{
      evidence?: Evidence[];
      symptoms?: string;
    }>();

    const { evidence = [], symptoms } = body;
    const sessionId = generateSessionId();

    // 1. AI-powered diagnosis (primary path for ALL cases)
    const aiResult = await aiDiagnose(evidence, symptoms);

    if (aiResult) {
      // Check if AI returned a known disease code → use standard prescriptions
      const knownDisease = MVP_DISEASES.find((d) => d.icd_ai_code === aiResult.icd_ai_code);
      let treatmentPlan: TreatmentStep[];

      if (knownDisease) {
        treatmentPlan = buildTreatmentPlan(aiResult.icd_ai_code);
      } else if (aiResult.treatmentSteps?.length) {
        // Novel diagnosis with AI-generated treatment steps
        treatmentPlan = aiResult.treatmentSteps.map((step, i) => ({
          id: `step_${i + 1}`,
          action: step.action,
          description: step.description,
          requiresUserInput: step.requiresUserInput ?? false,
          inputPrompt: step.requiresUserInput ? step.description : undefined,
        }));
      } else {
        treatmentPlan = [];
      }

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
        isNovelCode: !knownDisease,
        summary: `Diagnosed ${aiResult.name} (${aiResult.icd_ai_code}) with ${Math.round(aiResult.confidence * 100)}% confidence. ${aiResult.reasoning}`,
      });
    }

    // 2. Rule-based fallback (only when AI is unavailable)
    const symptomsFragments: string[] = [];
    if (symptoms) symptomsFragments.push(symptoms);

    const envEvidence = evidence.filter(
      (e): e is EnvironmentEvidence => e.type === "environment"
    );
    const runtimeEvidence = evidence.filter(
      (e): e is RuntimeEvidence => e.type === "runtime"
    );

    for (const env of envEvidence) {
      if (env.plugins) {
        const disabled = env.plugins.filter((p) => !p.enabled);
        if (disabled.length > 0) {
          symptomsFragments.push(`Disabled plugins: ${disabled.map((p) => p.id).join(", ")}`);
        }
      }
    }

    for (const rt of runtimeEvidence) {
      if (rt.recentTraceStats) {
        const stats = rt.recentTraceStats;
        if (stats.loopDetected) symptomsFragments.push("loop detected in recent trace");
        if (stats.errorCount > 0) symptomsFragments.push(`${stats.errorCount} errors in recent trace`);
        if (stats.totalCostUsd > 1.0) symptomsFragments.push(`high cost: $${stats.totalCostUsd.toFixed(2)}`);
      }
    }

    for (const ev of evidence) {
      if (ev.type === "behavior") {
        symptomsFragments.push(ev.description);
        if (ev.symptoms) {
          symptomsFragments.push(...ev.symptoms);
        }
      }
      if (ev.type === "log") {
        if (ev.errorPatterns) {
          symptomsFragments.push(...ev.errorPatterns);
        }
      }
    }

    const combinedSymptoms = symptomsFragments.join(" ");

    const symptomVector = createMinimalSymptomVector(
      combinedSymptoms || "unknown issue"
    );
    const candidates = matchDiseases(symptomVector, MVP_DISEASES, {
      symptoms_text: combinedSymptoms || undefined,
    });

    const primary = candidates[0] ?? null;
    const differential = candidates.slice(1);

    const treatmentPlan = primary
      ? buildTreatmentPlan(primary.icd_ai_code)
      : [];

    if (primary && treatmentPlan.length > 0) {
      createSession(sessionId, primary.icd_ai_code, treatmentPlan);
    }

    return c.json({
      sessionId,
      diagnosis: primary
        ? {
            icd_ai_code: primary.icd_ai_code,
            name: primary.disease_name,
            confidence: primary.confidence,
            severity: "Unknown",
            reasoning: `Matched thresholds: ${primary.matched_thresholds.join(", ") || "none"}. Supporting symptoms: ${primary.matched_supporting.join(", ") || "none"}.`,
          }
        : null,
      differential: differential.map((d) => ({
        icd_ai_code: d.icd_ai_code,
        name: d.disease_name,
        confidence: d.confidence,
      })),
      checks: [],
      fixes: [],
      treatmentPlan,
      summary: primary
        ? `Diagnosed ${primary.disease_name} (${primary.icd_ai_code}) with ${Math.round(primary.confidence * 100)}% confidence.`
        : "No diagnosis could be determined from the provided evidence.",
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
