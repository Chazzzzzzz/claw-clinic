import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server.js";

// Mock the AI diagnostician module
vi.mock("../../ai-diagnostician.js", () => ({
  aiDiagnose: vi.fn().mockResolvedValue(null), // default: AI unavailable
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
    mockAiDiagnose.mockResolvedValue(null);
  });

  // ─── AI diagnosis ──────────────────────────────────────────────

  it("sends config evidence to AI for diagnosis", async () => {
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
      checks: [
        { type: "check_config", target: "apiKey", expect: "present", label: "API key configured" },
      ],
      fixes: [
        { label: "Set API key", command: "openclaw config set apiKey sk-ant-...", description: "Configure your Anthropic API key" },
      ],
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
    expect(json.checks).toHaveLength(1);
    expect(json.fixes).toHaveLength(1);
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("sends connectivity evidence to AI for diagnosis", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "AUTH.1.1",
      name: "Auth Failure",
      confidence: 0.95,
      severity: "Critical",
      reasoning: "API key rejected by provider.",
      differential: [],
      treatmentSteps: [
        { action: "Regenerate key", command: "openclaw auth refresh", expected_output: "ok", next: "done" },
      ],
      checks: [
        { type: "check_connectivity", target: "anthropic", expect: "auth=ok", label: "Anthropic auth working" },
      ],
      fixes: [
        { label: "Regenerate API key", command: "openclaw auth refresh", description: "Refresh authentication credentials" },
      ],
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
    expect(json.diagnosis.icd_ai_code).toBe("AUTH.1.1");
    expect(json.checks).toBeDefined();
    expect(json.fixes).toBeDefined();
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
      treatmentSteps: [
        { action: "Reset endpoint", command: "openclaw config set endpoint.url https://api.anthropic.com", expected_output: "ok", next: "done" },
      ],
      checks: [
        { type: "check_config", target: "endpoint.url", expect: "valid_url", label: "Endpoint URL valid" },
      ],
      fixes: [
        { label: "Reset endpoint", command: "openclaw config set endpoint.url https://api.anthropic.com", description: "Set endpoint to default Anthropic URL" },
      ],
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
    expect(json.checks).toBeDefined();
    expect(json.fixes).toBeDefined();
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("returns AI-generated treatment steps", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "PERM.1.1",
      name: "Tool Permission Denial",
      confidence: 0.92,
      severity: "High",
      reasoning: "Agent cannot write files due to permission restrictions.",
      differential: [
        { icd_ai_code: "TOOL.1.1", name: "Tool Calling Fracture", confidence: 0.25 },
      ],
      treatmentSteps: [
        { action: "Allow exec", command: "openclaw config set tools.exec.restricted false", expected_output: "ok", next: "verify_fix" },
        { action: "Restart gateway", command: "sudo systemctl restart openclaw-gateway", expected_output: "active (running)", next: "done" },
      ],
      checks: [
        { type: "check_config", target: "tools.exec.restricted", expect: "false", label: "Tool execution unrestricted" },
      ],
      fixes: [
        { label: "Allow tool execution", command: "openclaw config set tools.exec.restricted false", description: "Disable tool restrictions" },
      ],
    });

    const { status, json } = await postDiagnose({
      symptoms: "I can't write files now",
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("PERM.1.1");
    expect(json.treatmentPlan).toHaveLength(2);
    expect(json.treatmentPlan[0].description).toBe("openclaw config set tools.exec.restricted false");
    expect(json.checks).toHaveLength(1);
    expect(json.fixes).toHaveLength(1);
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("returns empty treatment plan when AI returns no steps", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "UNKNOWN.1.1",
      name: "Some Unknown Issue",
      confidence: 0.6,
      severity: "Low",
      reasoning: "Unclear symptoms.",
      differential: [],
      treatmentSteps: [],
      checks: [],
      fixes: [],
    });

    const { status, json } = await postDiagnose({
      symptoms: "something weird",
    });

    expect(status).toBe(200);
    expect(json.diagnosis.icd_ai_code).toBe("UNKNOWN.1.1");
    expect(json.treatmentPlan).toEqual([]);
  });

  // ─── AI unavailable ────────────────────────────────────────────

  it("returns null diagnosis when AI is unavailable", async () => {
    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "behavior",
          description: "The agent is stuck in a loop",
        },
      ],
    });

    expect(status).toBe(200);
    expect(json.diagnosis).toBeNull();
    expect(json.summary).toContain("unavailable");
    expect(mockAiDiagnose).toHaveBeenCalledOnce();
  });

  it("returns null diagnosis when no evidence or symptoms given and AI unavailable", async () => {
    const { status, json } = await postDiagnose({
      evidence: [],
    });

    expect(status).toBe(200);
    expect(json.diagnosis).toBeNull();
    expect(json.summary).toContain("unavailable");
  });

  // ─── Edge cases ───────────────────────────────────────────────

  it("returns 400 for invalid request body", async () => {
    const res = await app.request("/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
  });

  it("includes treatmentPlan array in response", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "LOOP.1.1",
      name: "Infinite Loop",
      confidence: 0.9,
      severity: "Critical",
      reasoning: "Agent is repeating the same tool call.",
      differential: [],
      treatmentSteps: [
        { action: "Reset session", command: "openclaw session reset", expected_output: "Session reset", next: "done" },
      ],
      checks: [],
      fixes: [
        { label: "Reset session", command: "openclaw session reset", description: "Clear current session" },
      ],
    });

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

  it("includes differential diagnoses from AI", async () => {
    mockAiDiagnose.mockResolvedValueOnce({
      icd_ai_code: "LOOP.1.1",
      name: "Infinite Loop",
      confidence: 0.85,
      severity: "High",
      reasoning: "Repeated tool calls detected.",
      differential: [
        { icd_ai_code: "TOOL.1.1", name: "Tool Failure", confidence: 0.3 },
        { icd_ai_code: "COST.1.1", name: "Cost Explosion", confidence: 0.2 },
      ],
      treatmentSteps: [],
      checks: [],
      fixes: [],
    });

    const { status, json } = await postDiagnose({
      evidence: [
        {
          type: "behavior",
          description: "The agent is stuck in a loop, errors everywhere",
        },
      ],
    });

    expect(status).toBe(200);
    expect(Array.isArray(json.differential)).toBe(true);
    expect(json.differential).toHaveLength(2);
  });
});
