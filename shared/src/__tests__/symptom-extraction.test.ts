import { describe, it, expect } from "vitest";
import { extractSymptomVector } from "../utils/symptom-extraction.js";
import { createMinimalSymptomVector } from "../utils/heuristic-vector.js";
import {
  generateHealthyTrace,
  generateLoopTrace,
  generateHighErrorRateTrace,
  generateToolFailureTrace,
  generateCostExplosionTrace,
} from "../eval/trace-generator.js";
import type { TraceRecord } from "../types/index.js";

describe("extractSymptomVector", () => {
  it("handles empty trace", () => {
    const sv = extractSymptomVector([]);
    expect(sv.step_count).toBe(0);
    expect(sv.loop_count).toBe(0);
    expect(sv.unique_tools).toBe(0);
    expect(sv.error_rate).toBe(0);
    expect(sv.token_velocity).toBe(0);
    expect(sv.tool_success_rate).toBe(1);
    expect(sv.latency_p95_ms).toBe(0);
    expect(sv.cost_total_usd).toBe(0);
    expect(sv.context_utilization).toBe(0);
    expect(sv.output_diversity_score).toBe(1);
  });

  it("computes correct step_count", () => {
    const trace = generateHealthyTrace(5);
    const sv = extractSymptomVector(trace);
    // 1 user_input + 5*(reasoning + tool_call + tool_result) + 1 trailing reasoning = 17
    expect(sv.step_count).toBe(trace.length);
    expect(sv.step_count).toBeGreaterThan(0);
  });

  it("detects loops in loop trace", () => {
    const trace = generateLoopTrace(5);
    const sv = extractSymptomVector(trace);
    expect(sv.loop_count).toBeGreaterThan(0);
    expect(sv.output_diversity_score).toBeLessThan(1);
  });

  it("does not detect loops in healthy trace", () => {
    const trace = generateHealthyTrace(10);
    const sv = extractSymptomVector(trace);
    expect(sv.loop_count).toBe(0);
  });

  it("computes error_rate correctly", () => {
    const trace = generateHighErrorRateTrace();
    const sv = extractSymptomVector(trace);
    // The trace has errors - error_rate should be > 0
    expect(sv.error_rate).toBeGreaterThan(0);
    expect(sv.error_rate).toBeLessThanOrEqual(1);
  });

  it("computes error_rate as 0 for healthy trace", () => {
    const trace = generateHealthyTrace(5);
    const sv = extractSymptomVector(trace);
    expect(sv.error_rate).toBe(0);
  });

  it("computes token_velocity", () => {
    const trace = generateCostExplosionTrace();
    const sv = extractSymptomVector(trace);
    // The cost explosion trace has high token usage spread over time
    expect(sv.token_velocity).toBeGreaterThan(0);
  });

  it("computes tool_success_rate", () => {
    const trace = generateToolFailureTrace();
    const sv = extractSymptomVector(trace);
    // Tool failure trace has mostly errors
    expect(sv.tool_success_rate).toBeLessThan(0.5);
  });

  it("computes tool_success_rate near 1 for healthy trace", () => {
    const trace = generateHealthyTrace(5);
    const sv = extractSymptomVector(trace);
    expect(sv.tool_success_rate).toBeGreaterThanOrEqual(0.8);
  });

  it("computes cost_total_usd", () => {
    const trace = generateCostExplosionTrace();
    const sv = extractSymptomVector(trace);
    expect(sv.cost_total_usd).toBeGreaterThan(0);
  });

  it("computes context_utilization with contextWindowSize", () => {
    const trace = generateHealthyTrace(5);
    const sv = extractSymptomVector(trace, 10000);
    expect(sv.context_utilization).toBeGreaterThan(0);
    expect(sv.context_utilization).toBeLessThanOrEqual(1);
  });

  it("context_utilization is 0 without contextWindowSize", () => {
    const trace = generateHealthyTrace(5);
    const sv = extractSymptomVector(trace);
    expect(sv.context_utilization).toBe(0);
  });

  it("computes unique_tools correctly", () => {
    const trace = generateHealthyTrace(10);
    const sv = extractSymptomVector(trace);
    // Healthy trace cycles through 5 tools: read_file, write_file, search, bash, web_search
    expect(sv.unique_tools).toBe(5);
  });

  it("computes latency_p95_ms", () => {
    const trace = generateHealthyTrace(10);
    const sv = extractSymptomVector(trace);
    expect(sv.latency_p95_ms).toBeGreaterThan(0);
  });
});

describe("createMinimalSymptomVector", () => {
  it("handles keyword 'loop' by setting loop_count", () => {
    const sv = createMinimalSymptomVector("The agent is stuck in a loop");
    expect(sv.loop_count).toBeGreaterThan(0);
    expect(sv.output_diversity_score).toBeLessThan(0.5);
  });

  it("handles tool failure keywords by setting error_rate", () => {
    const sv = createMinimalSymptomVector("The agent's tool calling keeps failing with tool errors");
    expect(sv.error_rate).toBeGreaterThan(0.1);
    expect(sv.tool_success_rate).toBeLessThan(0.5);
  });

  it("handles keyword 'cost' by setting high token_velocity and cost", () => {
    const sv = createMinimalSymptomVector("The agent is very expensive to run");
    expect(sv.token_velocity).toBeGreaterThan(5000);
    expect(sv.cost_total_usd).toBeGreaterThan(1);
  });

  it("handles keyword 'context' by setting high context_utilization", () => {
    const sv = createMinimalSymptomVector("The agent seems to forget its earlier context");
    expect(sv.context_utilization).toBeGreaterThan(0.8);
  });

  it("returns default values for unrecognized text", () => {
    const sv = createMinimalSymptomVector("Everything is fine");
    expect(sv.loop_count).toBe(0);
    expect(sv.error_rate).toBe(0.02);
    expect(sv.token_velocity).toBe(1000);
    expect(sv.cost_total_usd).toBe(0.05);
    expect(sv.context_utilization).toBe(0.3);
    expect(sv.output_diversity_score).toBe(0.8);
  });
});
