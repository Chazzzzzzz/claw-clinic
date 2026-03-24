import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Anthropic SDK before importing the module
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      constructor() {}
      messages = { create: mockCreate };
    },
  };
});

import { aiDiagnose, _systemPrompt, _serializeEvidence } from "../ai-diagnostician.js";
import type { Evidence } from "@claw-clinic/shared";

describe("aiDiagnose", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockCreate.mockReset();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("returns null when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await aiDiagnose([], "some symptoms");
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns null when evidence and symptoms are empty", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const result = await aiDiagnose([]);
    expect(result).toBeNull();
  });

  it("returns structured diagnosis from tool_use response", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: "submit_diagnosis",
          input: {
            icd_ai_code: "PERM.1.1",
            name: "Tool Permission Denial",
            confidence: 0.9,
            severity: "High",
            reasoning: "The user reports inability to write files, indicating permission denial.",
            differential: [
              { icd_ai_code: "TOOL.1.1", name: "Tool Calling Fracture", confidence: 0.3 },
            ],
            treatment_steps: [
              { action: "Allow exec tools", command: "openclaw config set tools.exec.restricted false", expected_output: "ok", next: "verify_fix" },
            ],
            checks: [
              { type: "check_config", target: "tools.exec.restricted", expect: "false", label: "Tool execution unrestricted" },
            ],
            fixes: [
              { label: "Allow tool execution", command: "openclaw config set tools.exec.restricted false", description: "Disable tool restrictions" },
            ],
          },
        },
      ],
    });

    const result = await aiDiagnose([], "I can't write files now");

    expect(result).not.toBeNull();
    expect(result!.icd_ai_code).toBe("PERM.1.1");
    expect(result!.name).toBe("Tool Permission Denial");
    expect(result!.confidence).toBe(0.9);
    expect(result!.severity).toBe("High");
    expect(result!.differential).toHaveLength(1);
    expect(result!.checks).toHaveLength(1);
    expect(result!.fixes).toHaveLength(1);
    expect(result!.treatmentSteps).toHaveLength(1);
    expect(result!.treatmentSteps[0].command).toBe("openclaw config set tools.exec.restricted false");

    // Verify the API was called with correct params
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toContain("sonnet");
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].name).toBe("submit_diagnosis");
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "submit_diagnosis" });
  });

  it("returns diagnosis with executable treatment steps", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_456",
          name: "submit_diagnosis",
          input: {
            icd_ai_code: "CTX.1.1",
            name: "Context Window Overflow",
            confidence: 0.85,
            severity: "Moderate",
            reasoning: "Agent has consumed entire context window.",
            differential: [],
            treatment_steps: [
              { action: "Reset context", command: "openclaw session reset", expected_output: "Session reset", next: "run_next_step" },
              { action: "Clear cache", command: "openclaw cache clear", expected_output: "Cache cleared", next: "done" },
            ],
            checks: [
              { type: "check_process", target: "openclaw", expect: "running", label: "OpenClaw process running" },
            ],
            fixes: [
              { label: "Reset context window", command: "openclaw session reset", description: "Clears the current session context" },
            ],
          },
        },
      ],
    });

    const result = await aiDiagnose(
      [{ type: "behavior", description: "Agent stopped mid-task" }],
    );

    expect(result).not.toBeNull();
    expect(result!.icd_ai_code).toBe("CTX.1.1");
    expect(result!.treatmentSteps).toHaveLength(2);
    expect(result!.treatmentSteps[0].command).toBe("openclaw session reset");
    expect(result!.treatmentSteps[0].expected_output).toBe("Session reset");
    expect(result!.treatmentSteps[1].next).toBe("done");
  });

  it("returns null when API call throws", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    mockCreate.mockRejectedValueOnce(new Error("API timeout"));

    const result = await aiDiagnose([], "something is wrong");
    expect(result).toBeNull();
  });

  it("returns null when response has no tool_use block", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I don't know" }],
    });

    const result = await aiDiagnose([], "help");
    expect(result).toBeNull();
  });
});

describe("_systemPrompt", () => {
  it("contains diagnostic instructions without hardcoded disease catalog", () => {
    expect(_systemPrompt).toContain("diagnostic engine");
    expect(_systemPrompt).toContain("EXECUTABLE COMMANDS ONLY");
    expect(_systemPrompt).toContain("Department.Number.Variant");
    // Should NOT contain hardcoded disease entries
    expect(_systemPrompt).not.toContain("Disease Catalog");
    expect(_systemPrompt).not.toContain("standard prescriptions");
  });
});

describe("_serializeEvidence", () => {
  it("serializes behavior evidence", () => {
    const evidence: Evidence[] = [
      { type: "behavior", description: "agent is stuck", symptoms: ["loop", "no progress"] },
    ];
    const result = _serializeEvidence(evidence, "help me");
    expect(result).toContain("help me");
    expect(result).toContain("agent is stuck");
    expect(result).toContain("loop");
  });

  it("serializes config evidence", () => {
    const evidence: Evidence[] = [
      { type: "config", apiKey: { masked: "sk-***", provider: "anthropic" } },
    ];
    const result = _serializeEvidence(evidence);
    expect(result).toContain("sk-***");
    expect(result).toContain("anthropic");
  });

  it("serializes connectivity evidence", () => {
    const evidence: Evidence[] = [
      {
        type: "connectivity",
        providers: [
          { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "ok" },
        ],
      },
    ];
    const result = _serializeEvidence(evidence);
    expect(result).toContain("anthropic");
    expect(result).toContain("reachable=true");
  });

  it("serializes runtime evidence", () => {
    const evidence: Evidence[] = [
      {
        type: "runtime",
        recentTraceStats: {
          totalSteps: 10,
          errorCount: 3,
          avgLatencyMs: 200,
          totalTokens: 5000,
          totalCostUsd: 0.5,
          toolCallCount: 8,
          toolSuccessCount: 5,
          loopDetected: false,
        },
      },
    ];
    const result = _serializeEvidence(evidence);
    expect(result).toContain("errors=3");
    expect(result).toContain("tools=8");
  });
});
