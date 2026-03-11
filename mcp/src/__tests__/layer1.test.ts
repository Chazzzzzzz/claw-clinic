import { describe, it, expect } from "vitest";
import { detectLoop } from "../layer1/loop-detector.js";
import { analyzeCost } from "../layer1/cost-monitor.js";
import { analyzeToolHealth } from "../layer1/tool-health.js";
import {
  generateHealthyTrace,
  generateLoopTrace,
  generateCostExplosionTrace,
  generateToolFailureTrace,
  generateHighErrorRateTrace,
} from "@claw-clinic/shared/src/eval/trace-generator.js";
import type { TraceRecord } from "@claw-clinic/shared";

// ─── Loop Detector ──────────────────────────────────────────────────────────

describe("detectLoop", () => {
  it("detects 3+ identical tool calls with high confidence", () => {
    const trace = generateLoopTrace(5);
    const result = detectLoop(trace);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.looping_tool).toBe("bash");
    expect(result.loop_length).toBeGreaterThanOrEqual(3);
  });

  it("does NOT detect loops in diverse tool call sequences", () => {
    const trace = generateHealthyTrace(10);
    const result = detectLoop(trace);
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe("none");
  });

  it("detects near-identical args (same tool, slightly different args)", () => {
    // Build a trace where same tool is called 3 times with 2 out of 3 matching args
    const base = new Date("2026-03-09T10:00:00Z");
    const trace: TraceRecord[] = [
      {
        step_number: 0,
        timestamp: base.toISOString(),
        type: "tool_call",
        content: { tool_name: "search", tool_args: { query: "hello world", page: 1 } },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
      {
        step_number: 1,
        timestamp: new Date(base.getTime() + 3000).toISOString(),
        type: "tool_result",
        content: { tool_result: { results: [] } },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
      {
        step_number: 2,
        timestamp: new Date(base.getTime() + 5000).toISOString(),
        type: "tool_call",
        content: { tool_name: "search", tool_args: { query: "hello world", page: 1 } },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
      {
        step_number: 3,
        timestamp: new Date(base.getTime() + 8000).toISOString(),
        type: "tool_result",
        content: { tool_result: { results: [] } },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
      {
        step_number: 4,
        timestamp: new Date(base.getTime() + 10000).toISOString(),
        type: "tool_call",
        content: { tool_name: "search", tool_args: { query: "hello world", page: 2 } },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
      {
        step_number: 5,
        timestamp: new Date(base.getTime() + 13000).toISOString(),
        type: "tool_result",
        content: { tool_result: { results: ["result1"] } },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
    ];
    const result = detectLoop(trace);
    // 2 out of 3 pairs match (0-1, 0-2 match; 1-2 does not) so matchingPairs = 1
    // The detector should detect with at least medium confidence
    expect(result.detected).toBe(true);
    expect(["high", "medium"]).toContain(result.confidence);
    expect(result.looping_tool).toBe("search");
  });

  it("handles empty trace gracefully", () => {
    const result = detectLoop([]);
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe("none");
    expect(result.looping_tool).toBeNull();
    expect(result.loop_length).toBe(0);
  });

  it("handles trace with < 3 tool calls", () => {
    const trace: TraceRecord[] = [
      {
        step_number: 0,
        type: "tool_call",
        content: { tool_name: "bash", tool_args: { command: "ls" } },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
      {
        step_number: 1,
        type: "tool_result",
        content: { tool_result: "file1.ts" },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
    ];
    const result = detectLoop(trace);
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe("none");
  });

  it("detects extended loops with window size 5", () => {
    // 5+ identical calls should trigger extended loop detection
    const trace = generateLoopTrace(6);
    const result = detectLoop(trace);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.loop_length).toBeGreaterThanOrEqual(5);
  });

  it("detects extended loops with window size 10", () => {
    const trace = generateLoopTrace(11);
    const result = detectLoop(trace);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.loop_length).toBeGreaterThanOrEqual(10);
  });
});

// ─── Cost Monitor ───────────────────────────────────────────────────────────

describe("analyzeCost", () => {
  it('returns "normal" for low cost traces', () => {
    const trace = generateHealthyTrace(5);
    const result = analyzeCost(trace);
    expect(result.level).toBe("normal");
    expect(result.recommendation).toBeNull();
  });

  it('returns "elevated" for high velocity', () => {
    // Create a trace with high cost in a very short time span
    const base = new Date("2026-03-09T10:00:00Z");
    const trace: TraceRecord[] = [];
    // All steps within 10 seconds, spending $2 total => velocity > $1/min
    for (let i = 0; i < 10; i++) {
      trace.push({
        step_number: i,
        timestamp: new Date(base.getTime() + i * 1000).toISOString(),
        type: "tool_call",
        content: { tool_name: "bash", tool_args: {} },
        metrics: { tokens_used: 1000, latency_ms: 200, cost_usd: 0.2 },
      });
    }
    const result = analyzeCost(trace, 50.0); // High budget so we don't hit critical
    expect(result.level).toBe("elevated");
    expect(result.recommendation).toBeTruthy();
  });

  it('returns "critical" for near-budget traces', () => {
    const base = new Date("2026-03-09T10:00:00Z");
    const trace: TraceRecord[] = [];
    // Spend $4.50 out of $5 budget (90%)
    for (let i = 0; i < 9; i++) {
      trace.push({
        step_number: i,
        timestamp: new Date(base.getTime() + i * 60000).toISOString(), // 1 minute apart to keep velocity low
        type: "tool_call",
        content: { tool_name: "bash", tool_args: {} },
        metrics: { tokens_used: 1000, latency_ms: 200, cost_usd: 0.5 },
      });
    }
    const result = analyzeCost(trace, 5.0);
    expect(result.level).toBe("critical");
    expect(result.recommendation).toBeTruthy();
  });

  it('returns "emergency" for over-budget traces', () => {
    const base = new Date("2026-03-09T10:00:00Z");
    const trace: TraceRecord[] = [];
    // Spend $6 out of $5 budget
    for (let i = 0; i < 12; i++) {
      trace.push({
        step_number: i,
        timestamp: new Date(base.getTime() + i * 60000).toISOString(),
        type: "tool_call",
        content: { tool_name: "bash", tool_args: {} },
        metrics: { tokens_used: 1000, latency_ms: 200, cost_usd: 0.5 },
      });
    }
    const result = analyzeCost(trace, 5.0);
    expect(result.level).toBe("emergency");
    expect(result.recommendation).toContain("STOP");
  });

  it("custom budget ceiling works", () => {
    const trace = generateCostExplosionTrace();
    const totalCost = trace.reduce((sum, t) => sum + (t.metrics?.cost_usd ?? 0), 0);

    // Set budget ceiling well above the total cost
    const resultHigh = analyzeCost(trace, totalCost * 10);
    // Set budget ceiling below the total cost
    const resultLow = analyzeCost(trace, 0.01);

    expect(resultLow.level).toBe("emergency");
    // High budget should not be emergency
    expect(resultHigh.level).not.toBe("emergency");
  });

  it("handles trace with no cost data", () => {
    const trace: TraceRecord[] = [
      {
        step_number: 0,
        type: "reasoning",
        content: { reasoning: "thinking..." },
        metrics: { tokens_used: 0, latency_ms: 0, cost_usd: 0 },
      },
    ];
    const result = analyzeCost(trace);
    expect(result.level).toBe("normal");
    expect(result.cost_total_usd).toBe(0);
  });
});

// ─── Tool Health ────────────────────────────────────────────────────────────

describe("analyzeToolHealth", () => {
  it("identifies healthy tools (>80% success)", () => {
    const trace = generateHealthyTrace(10);
    const result = analyzeToolHealth(trace);
    // All tools in healthy trace should succeed
    for (const tool of result.tools) {
      expect(tool.status).toBe("healthy");
      expect(tool.success_rate).toBeGreaterThanOrEqual(0.8);
    }
    expect(result.unreliable_tools).toHaveLength(0);
  });

  it("identifies unhealthy tools (<50% success)", () => {
    const trace = generateToolFailureTrace();
    const result = analyzeToolHealth(trace);
    // Most tools in the failure trace should be unhealthy
    expect(result.unreliable_tools.length).toBeGreaterThan(0);
    const unhealthy = result.tools.filter((t) => t.status === "unhealthy");
    expect(unhealthy.length).toBeGreaterThan(0);
    for (const tool of unhealthy) {
      expect(tool.success_rate).toBeLessThan(0.5);
    }
  });

  it("identifies degraded tools (50-80% success)", () => {
    // Create a trace where a tool succeeds 2 out of 3 times (66%)
    const base = new Date("2026-03-09T10:00:00Z");
    const trace: TraceRecord[] = [];
    let step = 0;

    for (let i = 0; i < 3; i++) {
      trace.push({
        step_number: step++,
        timestamp: new Date(base.getTime() + i * 5000).toISOString(),
        type: "tool_call",
        content: { tool_name: "flaky_tool", tool_args: { attempt: i } },
        metrics: { tokens_used: 100, latency_ms: 200, cost_usd: 0.001 },
      });

      if (i < 2) {
        trace.push({
          step_number: step++,
          timestamp: new Date(base.getTime() + i * 5000 + 1000).toISOString(),
          type: "tool_result",
          content: { tool_result: { success: true } },
          metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
        });
      } else {
        trace.push({
          step_number: step++,
          timestamp: new Date(base.getTime() + i * 5000 + 1000).toISOString(),
          type: "error",
          content: { error: { code: "FAIL", message: "Failed" } },
          metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
        });
      }
    }

    const result = analyzeToolHealth(trace);
    const flakyTool = result.tools.find((t) => t.tool_name === "flaky_tool");
    expect(flakyTool).toBeDefined();
    expect(flakyTool!.status).toBe("degraded");
    expect(flakyTool!.success_rate).toBeGreaterThanOrEqual(0.5);
    expect(flakyTool!.success_rate).toBeLessThan(0.8);
  });

  it("computes overall success rate correctly", () => {
    const trace = generateToolFailureTrace();
    const result = analyzeToolHealth(trace);
    const totalCalls = result.tools.reduce((s, t) => s + t.call_count, 0);
    const totalSuccess = result.tools.reduce((s, t) => s + t.success_count, 0);
    const expectedRate = totalCalls > 0 ? totalSuccess / totalCalls : 1;
    expect(result.overall_tool_success_rate).toBeCloseTo(expectedRate, 5);
  });

  it("handles trace with no tool calls", () => {
    const trace: TraceRecord[] = [
      {
        step_number: 0,
        type: "reasoning",
        content: { reasoning: "Just thinking..." },
        metrics: { tokens_used: 100, latency_ms: 100, cost_usd: 0.001 },
      },
    ];
    const result = analyzeToolHealth(trace);
    expect(result.tools).toHaveLength(0);
    expect(result.overall_tool_success_rate).toBe(1);
    expect(result.unreliable_tools).toHaveLength(0);
  });
});
