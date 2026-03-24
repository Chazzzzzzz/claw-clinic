import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server.js";

// Mock the AI diagnostician module
vi.mock("../../ai-diagnostician.js", () => ({
  aiDiagnose: vi.fn().mockResolvedValue(null),
}));

import { aiDiagnose } from "../../ai-diagnostician.js";
const mockAiDiagnose = vi.mocked(aiDiagnose);

// Helper to POST JSON to the app
async function post(path: string, body: unknown) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

describe("API key diagnosis -> treatment end-to-end flow", () => {
  beforeEach(() => {
    mockAiDiagnose.mockReset();
    mockAiDiagnose.mockResolvedValue(null);
  });

  describe("Missing API key flow (CFG.1.2)", () => {
    it("diagnoses and walks through AI-generated treatment steps to resolution", async () => {
      mockAiDiagnose.mockResolvedValueOnce({
        icd_ai_code: "CFG.1.2",
        name: "API Key Missing",
        confidence: 0.95,
        severity: "Critical",
        reasoning: "No API key is configured.",
        differential: [],
        treatmentSteps: [
          { action: "Check current config", command: "openclaw config get apiKey", expected_output: "apiKey", next: "run_next_step" },
          { action: "Set API key", command: "openclaw config set apiKey sk-ant-...", expected_output: "ok", next: "run_next_step" },
          { action: "Verify connection", command: "openclaw health", expected_output: "healthy", next: "done" },
        ],
        checks: [],
        fixes: [
          { label: "Set API key", command: "openclaw config set apiKey sk-ant-...", description: "Sets the API key" },
        ],
      });

      // Step 1: Diagnose
      const { status, json: diagRes } = await post("/diagnose", {
        evidence: [{ type: "config", apiKey: { masked: "(empty)" } }],
      });

      expect(status).toBe(200);
      expect(diagRes.diagnosis.icd_ai_code).toBe("CFG.1.2");
      expect(diagRes.diagnosis.severity).toBe("Critical");
      expect(diagRes.treatmentPlan).toHaveLength(3);

      const sessionId = diagRes.sessionId;
      const steps = diagRes.treatmentPlan;

      expect(steps[0].id).toBe("step_1");
      expect(steps[1].id).toBe("step_2");
      expect(steps[2].id).toBe("step_3");

      // Step 2: Execute step_1 -> expect "next" with step_2
      const { json: treat1 } = await post("/treat", {
        sessionId,
        stepId: "step_1",
        stepResult: { success: true },
      });

      expect(treat1.status).toBe("next");
      expect(treat1.nextStep.id).toBe("step_2");

      // Step 3: Execute step_2 -> expect "next" with step_3
      const { json: treat2 } = await post("/treat", {
        sessionId,
        stepId: "step_2",
        stepResult: { success: true },
      });

      expect(treat2.status).toBe("next");
      expect(treat2.nextStep.id).toBe("step_3");

      // Step 4: Execute step_3 -> expect "resolved"
      const { json: treat3 } = await post("/treat", {
        sessionId,
        stepId: "step_3",
        stepResult: { success: true },
      });

      expect(treat3.status).toBe("resolved");
    });
  });

  describe("API key format error flow (CFG.1.1)", () => {
    it("diagnoses bad key format and walks through treatment to resolution", async () => {
      mockAiDiagnose.mockResolvedValueOnce({
        icd_ai_code: "CFG.1.1",
        name: "API Key Format Error",
        confidence: 0.8,
        severity: "High",
        reasoning: "The API key does not match any known provider format.",
        differential: [],
        treatmentSteps: [
          { action: "Show current key", command: "openclaw config get apiKey", expected_output: "apiKey", next: "run_next_step" },
          { action: "Set correct key", command: "openclaw config set apiKey sk-ant-corrected", expected_output: "ok", next: "run_next_step" },
          { action: "Test auth", command: "openclaw health", expected_output: "healthy", next: "done" },
        ],
        checks: [],
        fixes: [],
      });

      const { status, json: diagRes } = await post("/diagnose", {
        evidence: [{ type: "config", apiKey: { masked: "bad-key-..." } }],
      });

      expect(status).toBe(200);
      expect(diagRes.diagnosis.icd_ai_code).toBe("CFG.1.1");
      expect(diagRes.treatmentPlan).toHaveLength(3);

      const sessionId = diagRes.sessionId;

      // Step 1
      const { json: treat1 } = await post("/treat", {
        sessionId,
        stepId: "step_1",
        stepResult: { success: true },
      });
      expect(treat1.status).toBe("next");
      expect(treat1.nextStep.id).toBe("step_2");

      // Step 2
      const { json: treat2 } = await post("/treat", {
        sessionId,
        stepId: "step_2",
        stepResult: { success: true },
      });
      expect(treat2.status).toBe("next");
      expect(treat2.nextStep.id).toBe("step_3");

      // Step 3
      const { json: treat3 } = await post("/treat", {
        sessionId,
        stepId: "step_3",
        stepResult: { success: true },
      });
      expect(treat3.status).toBe("resolved");
    });
  });

  describe("Auth failure flow (AUTH.1.1)", () => {
    it("diagnoses auth failure and walks through treatment to resolution", async () => {
      mockAiDiagnose.mockResolvedValueOnce({
        icd_ai_code: "AUTH.1.1",
        name: "Auth Failure",
        confidence: 0.85,
        severity: "High",
        reasoning: "The API key is being rejected by the provider.",
        differential: [],
        treatmentSteps: [
          { action: "Check auth status", command: "openclaw health", expected_output: "auth", next: "run_next_step" },
          { action: "View current key", command: "cat ~/.config/openclaw/auth-profiles.json", expected_output: "apiKey", next: "run_next_step" },
          { action: "Set new key", command: "openclaw config set apiKey sk-ant-api03-freshkey", expected_output: "ok", next: "run_next_step" },
          { action: "Verify connection", command: "openclaw health", expected_output: "healthy", next: "done" },
        ],
        checks: [],
        fixes: [],
      });

      const { status, json: diagRes } = await post("/diagnose", {
        evidence: [
          {
            type: "config",
            apiKey: { masked: "sk-ant-ab...wxyz", provider: "anthropic" },
            errorLogs: ["Error: 401 Unauthorized"],
          },
        ],
      });

      expect(status).toBe(200);
      expect(diagRes.diagnosis.icd_ai_code).toBe("AUTH.1.1");
      expect(diagRes.treatmentPlan).toHaveLength(4);

      const sessionId = diagRes.sessionId;

      // Walk through all 4 steps
      const { json: treat1 } = await post("/treat", {
        sessionId,
        stepId: "step_1",
        stepResult: { success: true },
      });
      expect(treat1.status).toBe("next");
      expect(treat1.nextStep.id).toBe("step_2");

      const { json: treat2 } = await post("/treat", {
        sessionId,
        stepId: "step_2",
        stepResult: { success: true },
      });
      expect(treat2.status).toBe("next");
      expect(treat2.nextStep.id).toBe("step_3");

      const { json: treat3 } = await post("/treat", {
        sessionId,
        stepId: "step_3",
        stepResult: { success: true },
      });
      expect(treat3.status).toBe("next");
      expect(treat3.nextStep.id).toBe("step_4");

      const { json: treat4 } = await post("/treat", {
        sessionId,
        stepId: "step_4",
        stepResult: { success: true },
      });
      expect(treat4.status).toBe("resolved");
    });
  });

  describe("Treatment failure mid-flow", () => {
    it("returns failed status when a treatment step fails", async () => {
      mockAiDiagnose.mockResolvedValueOnce({
        icd_ai_code: "CFG.1.2",
        name: "API Key Missing",
        confidence: 0.95,
        severity: "Critical",
        reasoning: "No API key is configured.",
        differential: [],
        treatmentSteps: [
          { action: "Set API key", command: "openclaw config set apiKey sk-ant-...", expected_output: "ok", next: "done" },
        ],
        checks: [],
        fixes: [],
      });

      const { json: diagRes } = await post("/diagnose", {
        evidence: [{ type: "config", apiKey: { masked: "(empty)" } }],
      });

      expect(diagRes.diagnosis.icd_ai_code).toBe("CFG.1.2");
      const sessionId = diagRes.sessionId;

      // Execute step_1 with failure
      const { json: treatRes } = await post("/treat", {
        sessionId,
        stepId: "step_1",
        stepResult: { success: false, error: "User declined to provide key" },
      });

      expect(treatRes.status).toBe("failed");
      expect(treatRes.message).toContain("step_1");
    });
  });
});
