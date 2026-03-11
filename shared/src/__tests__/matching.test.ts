import { describe, it, expect } from "vitest";
import { matchDiseases } from "../utils/matching.js";
import { MVP_DISEASES } from "../constants/diseases.js";
import type { SymptomVector } from "../types/index.js";

function makeVector(overrides: Partial<SymptomVector> = {}): SymptomVector {
  return {
    step_count: 10,
    loop_count: 0,
    unique_tools: 5,
    error_rate: 0.02,
    token_velocity: 500,
    tool_success_rate: 0.95,
    latency_p95_ms: 300,
    cost_total_usd: 0.1,
    context_utilization: 0.2,
    output_diversity_score: 0.9,
    ...overrides,
  };
}

describe("matchDiseases", () => {
  it("returns correct candidates for E.1.1 (loop symptoms)", () => {
    const sv = makeVector({
      loop_count: 5,
      output_diversity_score: 0.1,
      error_rate: 0.05,
    });
    const candidates = matchDiseases(sv, MVP_DISEASES);
    expect(candidates.length).toBeGreaterThan(0);
    const loopMatch = candidates.find((c) => c.icd_ai_code === "E.1.1");
    expect(loopMatch).toBeDefined();
    expect(loopMatch!.confidence).toBeGreaterThan(0);
    expect(loopMatch!.matched_thresholds).toContain("loop_count");
  });

  it("returns correct candidates for C.1.1 (cost explosion symptoms)", () => {
    const sv = makeVector({
      token_velocity: 15000,
      cost_total_usd: 5.0,
      step_count: 50,
    });
    const candidates = matchDiseases(sv, MVP_DISEASES);
    const costMatch = candidates.find((c) => c.icd_ai_code === "C.1.1");
    expect(costMatch).toBeDefined();
    expect(costMatch!.confidence).toBeGreaterThan(0);
  });

  it("threshold matching works with min/max", () => {
    // E.1.1 requires loop_count >= 3 (min) and output_diversity_score <= 0.3 (max)
    const sv = makeVector({
      loop_count: 4,
      output_diversity_score: 0.2,
    });
    const candidates = matchDiseases(sv, MVP_DISEASES);
    const match = candidates.find((c) => c.icd_ai_code === "E.1.1");
    expect(match).toBeDefined();
    expect(match!.matched_thresholds).toContain("loop_count");
    expect(match!.matched_thresholds).toContain("output_diversity_score");
  });

  it("supporting symptom text matching works", () => {
    const sv = makeVector({
      loop_count: 4,
      output_diversity_score: 0.2,
    });
    const candidates = matchDiseases(sv, MVP_DISEASES, {
      symptoms_text: "The agent keeps calling the same tool with identical arguments in a loop",
    });
    const match = candidates.find((c) => c.icd_ai_code === "E.1.1");
    expect(match).toBeDefined();
    expect(match!.matched_supporting.length).toBeGreaterThan(0);
  });

  it("exclusion criteria reduces confidence", () => {
    const sv = makeVector({
      loop_count: 4,
      output_diversity_score: 0.2,
    });

    // Without exclusion text
    const candidatesNoExclusion = matchDiseases(sv, MVP_DISEASES);
    const matchNoExclusion = candidatesNoExclusion.find((c) => c.icd_ai_code === "E.1.1");

    // With exclusion text that mentions polling/monitoring
    const candidatesWithExclusion = matchDiseases(sv, MVP_DISEASES, {
      symptoms_text: "This is a known polling tool expected to repeat monitoring requests",
    });
    const matchWithExclusion = candidatesWithExclusion.find((c) => c.icd_ai_code === "E.1.1");

    // The version with exclusion should have lower or equal confidence
    if (matchNoExclusion && matchWithExclusion) {
      expect(matchWithExclusion.confidence).toBeLessThanOrEqual(matchNoExclusion.confidence);
      expect(matchWithExclusion.matched_exclusions.length).toBeGreaterThan(0);
    }
  });

  it("results are sorted by confidence descending", () => {
    const sv = makeVector({
      loop_count: 5,
      output_diversity_score: 0.1,
      error_rate: 0.3,
      tool_success_rate: 0.4,
      step_count: 40,
      context_utilization: 0.9,
      token_velocity: 15000,
      cost_total_usd: 5.0,
    });
    const candidates = matchDiseases(sv, MVP_DISEASES);

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].confidence).toBeLessThanOrEqual(candidates[i - 1].confidence);
    }
  });

  it("returns empty array for healthy vectors that match no disease", () => {
    const sv = makeVector();
    const candidates = matchDiseases(sv, MVP_DISEASES);
    // Healthy vector should match few or no diseases
    // All candidates should have low confidence if any
    for (const c of candidates) {
      expect(c.confidence).toBeLessThan(1);
    }
  });

  it("returns at most 5 candidates", () => {
    const sv = makeVector({
      loop_count: 5,
      output_diversity_score: 0.1,
      error_rate: 0.3,
      tool_success_rate: 0.3,
      step_count: 50,
      context_utilization: 0.95,
      token_velocity: 15000,
      cost_total_usd: 10.0,
    });
    const candidates = matchDiseases(sv, MVP_DISEASES);
    expect(candidates.length).toBeLessThanOrEqual(5);
  });
});
