import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "../../server.js";

// Mock Anthropic SDK for verify route
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      constructor() {}
      messages = { create: mockCreate };
    },
  };
});

async function postVerify(body: unknown) {
  const res = await app.request("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /verify", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("returns AI-generated verification steps", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_v1",
          name: "submit_verification_plan",
          input: {
            steps: [
              {
                type: "check_connectivity",
                description: "Test API connectivity",
                command: "openclaw health",
                expected_output: "healthy",
                confidence: "high",
              },
              {
                type: "check_config",
                description: "Verify API key present",
                command: "openclaw config get apiKey",
                expected_output: "sk-ant",
                confidence: "high",
              },
            ],
          },
        },
      ],
    });

    const { status, json } = await postVerify({
      diseaseCode: "CFG.1.2",
      diseaseName: "API Key Missing",
    });

    expect(status).toBe(200);
    expect(json.diseaseCode).toBe("CFG.1.2");
    expect(json.steps).toHaveLength(2);
    expect(json.steps[0].type).toBe("check_connectivity");
    expect(json.steps[1].type).toBe("check_config");
  });

  it("returns empty steps when AI is unavailable", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const { status, json } = await postVerify({
      diseaseCode: "UNKNOWN.1.1",
      diseaseName: "Unknown Issue",
    });

    expect(status).toBe(200);
    expect(json.diseaseCode).toBe("UNKNOWN.1.1");
    expect(json.steps).toEqual([]);
  });

  it("returns 400 when diseaseCode is missing", async () => {
    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid request body", async () => {
    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
  });

  it("verification steps have valid step types", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_v2",
          name: "submit_verification_plan",
          input: {
            steps: [
              { type: "check_logs", description: "Check for loop patterns", command: "journalctl -u openclaw-gateway --since '5 min ago' | grep loop", expected_output: "0 matches", confidence: "medium" },
              { type: "check_process", description: "Verify gateway running", command: "systemctl is-active openclaw-gateway", expected_output: "active", confidence: "high" },
            ],
          },
        },
      ],
    });

    const { json } = await postVerify({
      diseaseCode: "LOOP.1.1",
      diseaseName: "Infinite Loop",
    });

    const validTypes = [
      "check_file", "check_connectivity", "check_config",
      "check_process", "check_logs", "custom",
    ];

    for (const step of json.steps) {
      expect(validTypes).toContain(step.type);
    }
  });

  it("returns different plans for different diseases", async () => {
    // First call
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        id: "t1",
        name: "submit_verification_plan",
        input: {
          steps: [{ type: "check_logs", description: "Check loop count", command: "echo loop", expected_output: "0", confidence: "high" }],
        },
      }],
    });
    // Second call
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "tool_use",
        id: "t2",
        name: "submit_verification_plan",
        input: {
          steps: [{ type: "check_logs", description: "Check cost metrics", command: "echo cost", expected_output: "ok", confidence: "high" }],
        },
      }],
    });

    const [loop, cost] = await Promise.all([
      postVerify({ diseaseCode: "LOOP.1.1", diseaseName: "Infinite Loop" }),
      postVerify({ diseaseCode: "COST.1.1", diseaseName: "Cost Explosion" }),
    ]);

    expect(loop.json.diseaseCode).not.toBe(cost.json.diseaseCode);
  });
});
