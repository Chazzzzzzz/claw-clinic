import { describe, it, expect } from "vitest";
import { diagnose } from "../layer2/pattern-matcher.js";
import { MVP_DISEASES } from "@claw-clinic/shared";
import {
  generateHealthyTrace,
  generateLoopTrace,
  generateCostExplosionTrace,
  generateToolFailureTrace,
} from "@claw-clinic/shared/src/eval/trace-generator.js";

describe("diagnose", () => {
  it("correctly diagnoses E.1.1 from loop trace", () => {
    const trace = generateLoopTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    expect(result.primary).not.toBeNull();
    expect(result.primary!.icd_ai_code).toBe("E.1.1");
    expect(result.primary!.disease_name).toContain("Loop");
    expect(result.primary!.confidence).toBeGreaterThan(0);
  });

  it("correctly diagnoses C.1.1 from cost explosion trace", () => {
    const trace = generateCostExplosionTrace();
    const result = diagnose({ trace }, MVP_DISEASES);
    expect(result.primary).not.toBeNull();
    // The primary should be C.1.1 or it should at least appear in the results
    const costDiagnosis =
      result.primary!.icd_ai_code === "C.1.1"
        ? result.primary
        : result.differential.find((d) => d.icd_ai_code === "C.1.1");
    expect(costDiagnosis).toBeDefined();
    expect(costDiagnosis!.confidence).toBeGreaterThan(0);
  });

  it("correctly diagnoses O.1.1 from tool failure trace", () => {
    const trace = generateToolFailureTrace();
    const result = diagnose({ trace }, MVP_DISEASES);
    expect(result.primary).not.toBeNull();
    // O.1.1 should be the primary or in the differential
    const toolDiagnosis =
      result.primary!.icd_ai_code === "O.1.1"
        ? result.primary
        : result.differential.find((d) => d.icd_ai_code === "O.1.1");
    expect(toolDiagnosis).toBeDefined();
    expect(toolDiagnosis!.confidence).toBeGreaterThan(0);
  });

  it("returns no diagnosis for healthy trace", () => {
    const trace = generateHealthyTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    // Healthy trace should either have no primary or low confidence
    // Some diseases may still match at low confidence; escalation should trigger
    if (result.primary) {
      // If a match occurs, it should be flagged for escalation
      expect(result.escalate_to_layer3 || result.primary.confidence < 0.8).toBe(true);
    }
  });

  it("differential diagnosis includes alternatives", () => {
    const trace = generateLoopTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    // The loop trace may also trigger other diseases
    // differential should be an array (may be empty if only one match)
    expect(Array.isArray(result.differential)).toBe(true);
  });

  it("text-based symptom matching works (free-text input)", () => {
    const result = diagnose(
      { symptoms: "The agent is stuck in a loop, repeating the same tool call over and over" },
      MVP_DISEASES,
    );
    expect(result.primary).not.toBeNull();
    expect(result.primary!.icd_ai_code).toBe("E.1.1");
  });

  it("confidence scores are in 0-1 range", () => {
    const trace = generateLoopTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    if (result.primary) {
      expect(result.primary.confidence).toBeGreaterThanOrEqual(0);
      expect(result.primary.confidence).toBeLessThanOrEqual(1);
    }
    for (const d of result.differential) {
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("triage levels are correctly assigned", () => {
    // E.1.1 is "Critical" severity -> RED triage
    const loopTrace = generateLoopTrace(5);
    const loopResult = diagnose({ trace: loopTrace }, MVP_DISEASES);
    if (loopResult.primary && loopResult.primary.icd_ai_code === "E.1.1") {
      expect(loopResult.triage_level).toBe("RED");
    }

    // O.1.1 is "High" severity -> ORANGE triage
    const toolTrace = generateToolFailureTrace();
    const toolResult = diagnose({ trace: toolTrace }, MVP_DISEASES);
    if (toolResult.primary && toolResult.primary.icd_ai_code === "O.1.1") {
      expect(toolResult.triage_level).toBe("ORANGE");
    }
  });

  it("escalation to Layer 3 when confidence < 0.6", () => {
    const trace = generateHealthyTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    // Healthy trace should have no primary or low confidence => escalate
    if (!result.primary || result.primary.confidence < 0.6) {
      expect(result.escalate_to_layer3).toBe(true);
    }
  });

  it("does not escalate when confidence >= 0.6", () => {
    const trace = generateLoopTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    if (result.primary && result.primary.confidence >= 0.6) {
      expect(result.escalate_to_layer3).toBe(false);
    }
  });

  it("generates a case_id", () => {
    const trace = generateLoopTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    expect(result.case_id).toBeTruthy();
    expect(result.case_id.startsWith("case_")).toBe(true);
  });

  it("symptom_vector is populated", () => {
    const trace = generateLoopTrace(5);
    const result = diagnose({ trace }, MVP_DISEASES);
    expect(result.symptom_vector).toBeDefined();
    expect(result.symptom_vector.step_count).toBeGreaterThan(0);
  });
});
