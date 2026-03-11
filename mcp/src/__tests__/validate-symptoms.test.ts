import { describe, it, expect } from "vitest";
import { handleValidateSymptoms } from "../tools/hz-validate-symptoms.js";

describe("hz_validate_symptoms", () => {
  it("should reject too-short descriptions", async () => {
    const result = await handleValidateSymptoms({ symptoms: "broken" });
    const data = JSON.parse(result.content[0].text);

    expect(data.is_valid).toBe(false);
    expect(data.clarification_needed).toBe(true);
    expect(data.clarification_question).toBeDefined();
  });

  it("should detect loop symptoms from keywords", async () => {
    const result = await handleValidateSymptoms({
      symptoms: "My agent is stuck in a loop calling search repeatedly",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.is_valid).toBe(true);
    expect(data.detected_conditions).toContain("E.1.1 (Infinite Loop)");
  });

  it("should detect hallucination symptoms", async () => {
    const result = await handleValidateSymptoms({
      symptoms: "Agent is hallucinating fake URLs and making up file paths",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.is_valid).toBe(true);
    expect(data.detected_conditions.some((c: string) => c.includes("N.1.1"))).toBe(true);
  });

  it("should detect cost symptoms", async () => {
    const result = await handleValidateSymptoms({
      symptoms: "The agent is spending way too much on API calls, cost explosion",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.is_valid).toBe(true);
    expect(data.detected_conditions.some((c: string) => c.includes("C.1.1"))).toBe(true);
  });

  it("should accept long descriptions even without keyword matches", async () => {
    const result = await handleValidateSymptoms({
      symptoms: "Something very unusual and hard to categorize is happening with my agent's behavior during the task execution",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.is_valid).toBe(true);
    expect(data.clarification_needed).toBe(false);
  });

  it("should detect anomalies from trace data", async () => {
    const trace = Array.from({ length: 5 }, (_, i) => ({
      step_number: i + 1,
      type: "tool_call" as const,
      content: { tool_name: "search", tool_args: { query: "same query" } },
      metrics: { tokens_used: 100, latency_ms: 500, cost_usd: 0.01 },
    }));

    const result = await handleValidateSymptoms({
      symptoms: "Agent seems to be having issues with searching",
      trace,
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.is_valid).toBe(true);
    expect(data.anomalies_from_trace).toBeGreaterThan(0);
  });

  it("should request clarification for short unrecognized symptoms", async () => {
    const result = await handleValidateSymptoms({
      symptoms: "it's acting weird",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.is_valid).toBe(false);
    expect(data.clarification_needed).toBe(true);
  });
});
