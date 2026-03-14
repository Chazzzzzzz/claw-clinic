import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  // ─── Config/Connectivity fast-path (always runs, no AI needed) ──

  it("detects CFG.1.2 when API key is missing (empty)", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "config",
          apiKey: { masked: "(empty)" },
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.sessionId).toBeDefined();
    expect(json.diagnosis).not.toBeNull();
    expect(json.diagnosis.icd_ai_code).toBe("CFG.1.2");
    expect(json.diagnosis.name).toBe("API Key Missing");
    expect(json.diagnosis.confidence).toBeGreaterThanOrEqual(0.9);
    // Config fast-path should NOT call AI
    expect(mockAiDiagnose).not.toHaveBeenCalled();
  });

  it("detects CFG.1.2 when API key masked field is absent", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "config",
          apiKey: { masked: "" },
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("CFG.1.2");
    expect(mockAiDiagnose).not.toHaveBeenCalled();
  });

  it("detects CFG.1.1 when API key has unknown format (no provider)", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "config",
          apiKey: { masked: "abc***xyz" },
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("CFG.1.1");
    expect(json.diagnosis.name).toBe("API Key Format Error");
    expect(json.diagnosis.confidence).toBeGreaterThanOrEqual(0.7);
    expect(mockAiDiagnose).not.toHaveBeenCalled();
  });

  it("detects CFG.3.1 with auth error logs and valid provider key", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "config",
          apiKey: { masked: "sk-ant-***", provider: "anthropic" },
          errorLogs: ["HTTP 401 Unauthorized: invalid x-api-key"],
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("CFG.3.1");
    expect(json.diagnosis.name).toBe("Auth Failure");
    expect(mockAiDiagnose).not.toHaveBeenCalled();
  });

  it("detects CFG.2.1 with invalid endpoint URL", async () => {
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
    expect(json.diagnosis.name).toBe("Endpoint Misconfiguration");
    expect(mockAiDiagnose).not.toHaveBeenCalled();
  });

  it("detects CFG.2.1 when endpoint is unreachable", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "config",
          endpoint: { url: "https://api.example.com", reachable: false },
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("CFG.2.1");
    expect(mockAiDiagnose).not.toHaveBeenCalled();
  });

  // ─── AI-first diagnosis flow ─────────────────────────────────────

  it("uses AI diagnosis when available (known disease code)", async () => {
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
    // Known disease code should get standard prescriptions
    expect(json.treatmentPlan).toBeDefined();
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
        { action: "reset_context", description: "Clear context and restart." },
        { action: "reduce_input", description: "Reduce input size." },
      ],
    });

    const { status, json } = await postDiagnose({
      symptoms: "agent stopped responding mid-task",
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("NOVEL.1.1");
    expect(json.diagnosis.name).toBe("Context Window Overflow");
    expect(json.treatmentPlan).toHaveLength(2);
    expect(json.treatmentPlan[0].description).toBe("Clear context and restart.");
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

  it("returns 400 for invalid request body", async () => {
    const res = await app.request("/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
  });

  it("includes treatmentPlan in response", async () => {
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

  // ─── AI returns result but with empty treatment for novel code ───

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
    expect(json.treatmentPlan).toEqual([]);
  });
});
