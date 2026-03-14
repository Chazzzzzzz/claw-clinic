import { describe, it, expect } from "vitest";
import { app } from "../../server.js";

async function postDiagnose(body: unknown) {
  const res = await app.request("/diagnose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /diagnose", () => {
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
  });

  it("uses shared diagnosis for behavior evidence with symptoms text", async () => {
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
    // Should match a loop-related disease from shared engine
    expect(json.diagnosis.icd_ai_code).toBeDefined();
    expect(json.sessionId).toBeDefined();
    expect(json.summary).toBeDefined();
  });

  it("uses shared diagnosis for explicit symptoms param", async () => {
    const { status, json } = await postDiagnose({
      symptoms: "agent is stuck in a loop repeating the same action",
    });

    expect(status).toBe(200);
    expect(json.diagnosis).not.toBeNull();
    expect(json.diagnosis.icd_ai_code).toBeDefined();
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

  // ─── O.4.1 Tool Permission Denial ─────────────────────────────

  it("detects O.4.1 from permission-denied log patterns", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "log",
          entries: [],
          errorPatterns: [
            "EACCES: permission denied, open '/etc/shadow'",
            "Tool exec denied: restricted mode active",
          ],
        },
        {
          type: "behavior",
          description: "exec and fs tools are being blocked by permission errors",
          symptoms: ["permission denied on file operations"],
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis).not.toBeNull();
    expect(json.diagnosis.icd_ai_code).toBe("O.4.1");
    expect(json.diagnosis.name).toBe("Tool Permission Denial");
    expect(json.diagnosis.confidence).toBeGreaterThanOrEqual(0.7);
    expect(json.differential).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ icd_ai_code: "O.1.1" }),
      ]),
    );
  });

  it("detects O.4.1 from sandbox blocking + low tool success rate", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "log",
          entries: ["sandbox blocked exec call to /bin/ls"],
          errorPatterns: ["access denied for tool fs_write"],
        },
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 20,
            errorCount: 12,
            avgLatencyMs: 100,
            totalTokens: 5000,
            totalCostUsd: 0.1,
            toolCallCount: 15,
            toolSuccessCount: 3,
            loopDetected: false,
          },
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("O.4.1");
    expect(json.diagnosis.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does NOT detect O.4.1 when permission score is too low", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "log",
          entries: ["some random error occurred"],
          errorPatterns: ["timeout connecting to server"],
        },
      ],
    });

    expect(status).toBe(200);
    // Should not match O.4.1 since no permission patterns
    if (json.diagnosis) {
      expect(json.diagnosis.icd_ai_code).not.toBe("O.4.1");
    }
  });

  it("includes differential diagnoses", async () => {
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
