import { describe, it, expect } from "vitest";
import { handleHealthCheck } from "../tools/hz-health-check.js";
import { handleDiagnose } from "../tools/hz-diagnose.js";
import { handleTreat } from "../tools/hz-treat.js";
import { handleConsult } from "../tools/hz-consult.js";

import {
  generateHealthyTrace,
  generateLoopTrace,
  generateToolFailureTrace,
} from "@claw-clinic/shared/src/eval/trace-generator.js";

// Helper to parse the JSON response text from a tool handler result
function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

// ─── hz_health_check ────────────────────────────────────────────────────────

describe("handleHealthCheck", () => {
  it("returns valid report with vitals and anomalies", async () => {
    const trace = generateHealthyTrace(5);
    const result = await handleHealthCheck({ trace });
    expect(result.isError).toBeUndefined();
    const report = parseResult(result);
    expect(report.vitals).toBeDefined();
    expect(report.vitals.token_burn_rate).toBeDefined();
    expect(report.vitals.tool_success_rate).toBeDefined();
    expect(report.vitals.error_rate).toBeDefined();
    expect(report.anomalies).toBeDefined();
    expect(Array.isArray(report.anomalies)).toBe(true);
    expect(report.triage_level).toBeDefined();
    expect(report.emergency_action).toBeDefined();
  });

  it("detects loop in loop trace", async () => {
    const trace = generateLoopTrace(5);
    const result = await handleHealthCheck({ trace });
    expect(result.isError).toBeUndefined();
    const report = parseResult(result);
    const loopAnomaly = report.anomalies.find(
      (a: any) => a.type === "LOOP_DETECTED",
    );
    expect(loopAnomaly).toBeDefined();
    expect(loopAnomaly.severity).toBe("CRITICAL");
    expect(report.emergency_action).toBe("STOP_CURRENT_TASK");
  });

  it("handles invalid input gracefully", async () => {
    const result = await handleHealthCheck({ notTrace: "invalid" });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toBe("INVALID_INPUT");
  });
});

// ─── hz_diagnose ────────────────────────────────────────────────────────────

describe("handleDiagnose", () => {
  it("returns diagnosis from trace", async () => {
    const trace = generateLoopTrace(5);
    const result = await handleDiagnose({ trace });
    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result);
    expect(parsed.case_id).toBeTruthy();
    expect(parsed.diagnosis).toBeDefined();
    expect(parsed.diagnosis.primary).toBeDefined();
    expect(parsed.diagnosis.primary.icd_ai_code).toBe("E.1.1");
    expect(parsed.triage_level).toBeDefined();
  });

  it("returns diagnosis from text symptoms", async () => {
    const result = await handleDiagnose({
      symptoms: "The agent is stuck in a loop and keeps doing the same thing over and over",
    });
    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result);
    expect(parsed.diagnosis).toBeDefined();
    expect(parsed.diagnosis.primary).not.toBeNull();
    // Text-based matching uses heuristic keywords; E.1.1 should be the primary or in differential
    const allDiagnoses = [parsed.diagnosis.primary, ...parsed.diagnosis.differential];
    const hasLoop = allDiagnoses.some((d: any) => d && d.icd_ai_code === "E.1.1");
    expect(hasLoop).toBe(true);
  });

  it("rejects empty input", async () => {
    const result = await handleDiagnose({});
    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toBe("INVALID_INPUT");
  });
});

// ─── hz_treat ───────────────────────────────────────────────────────────────

describe("handleTreat", () => {
  it("applies low-risk prescription successfully", async () => {
    const result = await handleTreat({
      prescription_id: "RX-STD-001",
      auto_apply: true,
      case_id: "case_test123",
    });
    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result);
    expect(parsed.status).toBe("applied");
    expect(parsed.prescription.id).toBe("RX-STD-001");
    expect(parsed.prescription.risk_level).toBe("low");
    expect(parsed.follow_up_schedule).toBeDefined();
    expect(parsed.case_id).toBe("case_test123");
  });

  it("blocks auto-apply for high-risk prescriptions", async () => {
    const result = await handleTreat({
      prescription_id: "RX-STD-006", // Injection Resistance Protocol - high risk
      auto_apply: true,
      case_id: "case_test456",
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toBe("RISK_TOO_HIGH");
  });

  it("returns pending_human_approval for high-risk without auto_apply", async () => {
    const result = await handleTreat({
      prescription_id: "RX-STD-006",
      auto_apply: false,
      case_id: "case_test789",
    });
    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result);
    expect(parsed.status).toBe("pending_human_approval");
    expect(parsed.prescription.risk_level).toBe("high");
  });

  it("returns error for unknown prescription", async () => {
    const result = await handleTreat({
      prescription_id: "RX-NONEXISTENT",
      auto_apply: true,
      case_id: "case_unknown",
    });
    expect(result.isError).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.error).toBe("NOT_FOUND");
  });
});

// ─── hz_consult ─────────────────────────────────────────────────────────────

describe("handleConsult", () => {
  it("returns consultation ID and analysis", async () => {
    const trace = generateLoopTrace(5);
    const result = await handleConsult({
      case_summary: "Agent stuck in a loop calling the same tool",
      trace,
      urgency: "URGENT",
    });
    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result);
    expect(parsed.consultation_id).toBeTruthy();
    expect(parsed.consultation_id.startsWith("consult_")).toBe(true);
    // Doctor Agent now processes immediately — status is "completed"
    expect(["queued", "completed"]).toContain(parsed.status);
  });

  it("handles consult without trace", async () => {
    const result = await handleConsult({
      case_summary: "Agent seems to be confused",
    });
    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result);
    expect(parsed.consultation_id).toBeTruthy();
  });

  it("rejects invalid input", async () => {
    const result = await handleConsult({});
    expect(result.isError).toBe(true);
  });
});

