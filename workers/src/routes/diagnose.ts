import { Hono } from "hono";
import {
  MVP_DISEASES,
  STANDARD_PRESCRIPTIONS,
  matchDiseases,
  createMinimalSymptomVector,
} from "@claw-clinic/shared";
import type { Evidence, ConfigEvidence, ConnectivityEvidence, EnvironmentEvidence, RuntimeEvidence } from "@claw-clinic/shared";
import { createSession } from "./treat.js";
import type { TreatmentStep } from "./types.js";

const diagnoseRouter = new Hono();

// Generate session ID
function generateSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// Analyze config evidence for config/connectivity diseases
function analyzeConfigEvidence(evidence: ConfigEvidence[]): {
  icd_ai_code: string;
  name: string;
  confidence: number;
  severity: string;
  reasoning: string;
} | null {
  // Check if ANY config evidence has an API key
  const hasAnyApiKey = evidence.some((ev) => ev.apiKey !== undefined);

  for (const ev of evidence) {
    // Check API key issues
    if (ev.apiKey) {
      if (!ev.apiKey.masked || ev.apiKey.masked === "(empty)") {
        return {
          icd_ai_code: "CFG.1.2",
          name: "API Key Missing",
          confidence: 0.95,
          severity: "Critical",
          reasoning:
            "No API key is configured. The agent cannot authenticate with any AI provider.",
        };
      }

      // Check format if we have no recognized provider
      if (ev.apiKey.provider === undefined && ev.apiKey.masked !== "(empty)") {
        return {
          icd_ai_code: "CFG.1.1",
          name: "API Key Format Error",
          confidence: 0.8,
          severity: "High",
          reasoning:
            "The API key does not match any known provider format. It may be truncated, from the wrong provider, or contain extra characters.",
        };
      }
    }

    // Check endpoint issues
    if (ev.endpoint) {
      if (ev.endpoint.url) {
        try {
          new URL(ev.endpoint.url);
        } catch {
          return {
            icd_ai_code: "CFG.2.1",
            name: "Endpoint Misconfiguration",
            confidence: 0.9,
            severity: "Moderate",
            reasoning: `The configured endpoint URL "${ev.endpoint.url}" is not a valid URL.`,
          };
        }
      }
      if (ev.endpoint.reachable === false) {
        return {
          icd_ai_code: "CFG.2.1",
          name: "Endpoint Misconfiguration",
          confidence: 0.85,
          severity: "Moderate",
          reasoning: "The configured endpoint is unreachable.",
        };
      }
    }

    // Check error logs for auth patterns
    if (ev.errorLogs) {
      const authErrors = ev.errorLogs.filter((l) =>
        /401|403|unauthorized|forbidden|authentication/i.test(l)
      );
      if (authErrors.length > 0) {
        if (ev.apiKey?.provider) {
          return {
            icd_ai_code: "CFG.3.1",
            name: "Auth Failure",
            confidence: 0.85,
            severity: "High",
            reasoning:
              "The API key appears correctly formatted but is being rejected by the provider. It may be expired, revoked, or associated with the wrong account.",
          };
        }
      }
    }
  }

  // If no config evidence contained an API key at all
  if (!hasAnyApiKey && evidence.length > 0) {
    return {
      icd_ai_code: "CFG.1.2",
      name: "API Key Missing",
      confidence: 0.9,
      severity: "Critical",
      reasoning:
        "No API key was found in any configuration source. The agent cannot authenticate with any AI provider.",
    };
  }

  return null;
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

    // 1. Check config evidence first
    const configEvidence = evidence.filter(
      (e): e is ConfigEvidence => e.type === "config"
    );

    if (configEvidence.length > 0) {
      const configDiagnosis = analyzeConfigEvidence(configEvidence);
      if (configDiagnosis) {
        const treatmentPlan = buildTreatmentPlan(configDiagnosis.icd_ai_code);
        if (treatmentPlan.length > 0) {
          createSession(sessionId, configDiagnosis.icd_ai_code, treatmentPlan);
        }
        return c.json({
          sessionId,
          diagnosis: {
            icd_ai_code: configDiagnosis.icd_ai_code,
            name: configDiagnosis.name,
            confidence: configDiagnosis.confidence,
            severity: configDiagnosis.severity,
            reasoning: configDiagnosis.reasoning,
          },
          differential: [],
          treatmentPlan,
          summary: `Diagnosed ${configDiagnosis.name} (${configDiagnosis.icd_ai_code}) with ${Math.round(configDiagnosis.confidence * 100)}% confidence. ${configDiagnosis.reasoning}`,
        });
      }
    }

    // 2. Check connectivity evidence
    const connectivityEvidence = evidence.filter(
      (e): e is ConnectivityEvidence => e.type === "connectivity"
    );
    for (const conn of connectivityEvidence) {
      const unreachable = conn.providers.filter((p) => !p.reachable);
      if (unreachable.length > 0) {
        const names = unreachable.map((p) => p.name).join(", ");
        const errors = unreachable.map((p) => `${p.name}: ${p.error || "unreachable"}`).join("; ");
        const treatmentPlan = buildTreatmentPlan("CFG.2.1");
        if (treatmentPlan.length > 0) {
          createSession(sessionId, "CFG.2.1", treatmentPlan);
        }
        return c.json({
          sessionId,
          diagnosis: {
            icd_ai_code: "CFG.2.1",
            name: "Endpoint Misconfiguration",
            confidence: 0.85,
            severity: "High",
            reasoning: `Cannot reach AI provider(s): ${names}. Errors: ${errors}. Check network connectivity, DNS, and firewall rules.`,
          },
          differential: [],
          treatmentPlan,
          summary: `AI provider(s) unreachable: ${names}.`,
        });
      }

      // Check auth failures from actual API test
      const authFailed = conn.providers.filter((p) => p.authStatus === "failed");
      if (authFailed.length > 0) {
        const names = authFailed.map((p) => p.name).join(", ");
        const errors = authFailed.map((p) => `${p.name}: ${p.authError || "auth rejected"} (HTTP ${p.authStatusCode})`).join("; ");
        const treatmentPlan = buildTreatmentPlan("CFG.3.1");
        if (treatmentPlan.length > 0) {
          createSession(sessionId, "CFG.3.1", treatmentPlan);
        }
        return c.json({
          sessionId,
          diagnosis: {
            icd_ai_code: "CFG.3.1",
            name: "Auth Failure",
            confidence: 0.95,
            severity: "Critical",
            reasoning: `API authentication failed for provider(s): ${names}. The API key may be expired, revoked, or invalid. Details: ${errors}`,
          },
          differential: [],
          treatmentPlan,
          summary: `Auth failure for: ${names}.`,
        });
      }

      // Check server errors from auth test
      const serverErrors = conn.providers.filter((p) => p.authStatus === "server_error");
      if (serverErrors.length > 0) {
        const names = serverErrors.map((p) => p.name).join(", ");
        const errors = serverErrors.map((p) => `${p.name}: ${p.authError || "server error"}`).join("; ");
        const treatmentPlan = buildTreatmentPlan("CFG.2.1");
        if (treatmentPlan.length > 0) {
          createSession(sessionId, "CFG.2.1", treatmentPlan);
        }
        return c.json({
          sessionId,
          diagnosis: {
            icd_ai_code: "CFG.2.1",
            name: "AI Provider Service Error",
            confidence: 0.85,
            severity: "High",
            reasoning: `AI provider(s) returned server errors during auth test: ${names}. The service may be experiencing an outage. Details: ${errors}`,
          },
          differential: [],
          treatmentPlan,
          summary: `Provider service error: ${names}.`,
        });
      }

      // Check rate limiting
      const rateLimited = conn.providers.filter((p) => p.authStatus === "rate_limited");
      if (rateLimited.length > 0) {
        const names = rateLimited.map((p) => p.name).join(", ");
        return c.json({
          sessionId,
          diagnosis: {
            icd_ai_code: "CFG.3.1",
            name: "Rate Limited",
            confidence: 0.8,
            severity: "Moderate",
            reasoning: `API rate limit hit for provider(s): ${names}. Authentication is valid but requests are being throttled. Wait and retry, or check your usage limits.`,
          },
          differential: [],
          treatmentPlan: [],
          summary: `Rate limited by: ${names}.`,
        });
      }

      if (conn.gatewayReachable === false) {
        return c.json({
          sessionId,
          diagnosis: {
            icd_ai_code: "CFG.2.1",
            name: "Gateway Unreachable",
            confidence: 0.9,
            severity: "Critical",
            reasoning: "The OpenClaw gateway is not responding. The agent process may be down or the port may be blocked.",
          },
          differential: [],
          treatmentPlan: [],
          summary: "OpenClaw gateway is unreachable.",
        });
      }
    }

    const symptomsFragments: string[] = [];
    if (symptoms) symptomsFragments.push(symptoms);

    // 3. Enrich symptoms from all evidence types
    const envEvidence = evidence.filter(
      (e): e is EnvironmentEvidence => e.type === "environment"
    );
    const runtimeEvidence = evidence.filter(
      (e): e is RuntimeEvidence => e.type === "runtime"
    );

    // Add environment/runtime context to symptoms for better matching
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

    // 4. Collect symptoms text from behavior and log evidence

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

    // 5. Use shared diagnostic engine
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
