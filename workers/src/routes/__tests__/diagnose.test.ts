import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server.js";

// Mock the AI diagnostician module
vi.mock("../../ai-diagnostician.js", () => ({
  aiDiagnose: vi.fn().mockResolvedValue(null), // default: AI unavailable → fallback
}));

import { aiDiagnose } from "../../ai-diagnostician.js";
const mockAiDiagnose = vi.mocked(aiDiagnose);

async function postDiagnose(body: unknown) {
  const res = await app.request("/diagnose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /diagnose", () => {
  beforeEach(() => {
    mockAiDiagnose.mockReset();
    mockAiDiagnose.mockResolvedValue(null); // default fallback
  });

  // ─── All diagnosis goes through AI ────────────────────────────────

  it("sends config evidence to AI for diagnosis", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "CFG.1.2",
      name: "API Key Missing",
      confidence: 0.95,
      severity: "Critical",
      reasoning: "No API key is configured.",
      differential: [],
    });

    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "config",
          apiKey: { masked: "(empty)" },
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("CFG.1.2");
    expect(json.diagnosis.name).toBe("API Key Missing");
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("sends connectivity evidence to AI for diagnosis", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "CFG.3.1",
      name: "Auth Failure",
      confidence: 0.95,
      severity: "Critical",
      reasoning: "API key rejected by provider.",
      differential: [],
    });

    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "connectivity",
          providers: [
            { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "failed", authError: "401 Unauthorized" },
          ],
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("CFG.3.1");
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("sends endpoint misconfiguration to AI for diagnosis", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "CFG.2.1",
      name: "Endpoint Misconfiguration",
      confidence: 0.9,
      severity: "Moderate",
      reasoning: "The configured endpoint URL is invalid.",
      differential: [],
    });

    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "config",
          endpoint: { url: "not-a-url" },
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("CFG.2.1");
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  // ─── AI diagnosis with known vs novel codes ───────────────────────

  it("uses AI diagnosis with known disease code and standard prescriptions", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "O.4.1",
      name: "Tool Permission Denial",
      confidence: 0.92,
      severity: "High",
      reasoning: "Agent cannot write files due to permission restrictions.",
      differential: [
        { icd_ai_code: "O.1.1", name: "Tool Calling Fracture", confidence: 0.25 },
      ],
    });

    const { status, json } = await postDiagnose({
      symptoms: "I can't write files now",
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("O.4.1");
    expect(json.diagnosis.name).toBe("Tool Permission Denial");
    expect(json.diagnosis.confidence).toBe(0.92);
    expect(json.diagnosis.severity).toBe("High");
    expect(json.differential).toHaveLength(1);
    expect(json.differential[0].icd_ai_code).toBe("O.1.1");
    expect(json.treatmentPlan).toBeDefined();
    expect(json.isNovelCode).toBe(false);
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("uses AI-generated treatment steps for novel diagnosis", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "NOVEL.1.1",
      name: "Context Window Overflow",
      confidence: 0.8,
      severity: "Moderate",
      reasoning: "Agent has consumed its entire context window.",
      differential: [],
      treatmentSteps: [
        { action: "reset_context", description: "Clear context and restart.", requiresUserInput: false },
        { action: "reduce_input", description: "Reduce input size.", requiresUserInput: true },
      ],
    });

    const { status, json } = await postDiagnose({
      symptoms: "agent stopped responding mid-task",
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("NOVEL.1.1");
    expect(json.diagnosis.name).toBe("Context Window Overflow");
    expect(json.isNovelCode).toBe(true);
    expect(json.treatmentPlan).toHaveLength(2);
    expect(json.treatmentPlan[0].description).toBe("Clear context and restart.");
    expect(json.treatmentPlan[0].requiresUserInput).toBe(false);
    expect(json.treatmentPlan[1].requiresUserInput).toBe(true);
    expect(json.treatmentPlan[1].inputPrompt).toBe("Reduce input size.");
  });

  it("returns empty treatment plan for novel diagnosis without AI steps", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "NOVEL.2.1",
      name: "Some Unknown Issue",
      confidence: 0.6,
      severity: "Low",
      reasoning: "Unclear symptoms.",
      differential: [],
    });

    const { status, json } = await postDiagnose({
      symptoms: "something weird",
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("NOVEL.2.1");
    expect(json.isNovelCode).toBe(true);
    expect(json.treatmentPlan).toEqual([]);
  });

  // ─── Rule-based fallback (AI returns null) ───────────────────────

  it("falls back to rule-based for behavior evidence when AI unavailable", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "behavior",
          description: "The agent is stuck in a loop calling the same tool repeatedly",
          symptoms: ["Same tool called repeatedly", "No progress being made"],
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis).not.toBeNull();
    expect(json.diagnosis.icd_ai_code).toBeDefined();
    expect(json.sessionId).toBeDefined();
    expect(json.summary).toBeDefined();
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("falls back to rule-based for explicit symptoms when AI unavailable", async () => {
    const { status, json } = await postDiagnose({
      symptoms: "agent is stuck in a loop repeating the same action",
    });

    expect(status).toBe(200);
    expect(json.diagnosis).not.toBeNull();
    expect(json.diagnosis.icd_ai_code).toBeDefined();
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("returns null diagnosis when no evidence or symptoms given", async () => {
    const { status, json } = await postDiagnose({
      evidence: [],
    });

    expect(status).toBe(200);
    expect(json.diagnosis).toBeNull();
    expect(json.summary).toContain("No diagnosis");
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  it("returns 400 for invalid request body", async () => {
    const res = await app.request("/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
  });

  it("includes treatmentPlan array in response", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "behavior",
          description: "The agent is stuck in a loop calling the same tool repeatedly",
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.treatmentPlan).toBeDefined();
    expect(Array.isArray(json.treatmentPlan)).toBe(true);
  });

  it("includes differential diagnoses in fallback", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "behavior",
          description: "The agent is stuck in a loop, errors everywhere, tool failures",
          symptoms: ["loop", "error", "tool fail"],
        },
      ],
    });

    expect(status).toBe(200);
    expect(Array.isArray(json.differential)).toBe(true);
  });
});
