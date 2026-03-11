// End-to-end test for the Claw Clinic MCP server over HTTP/SSE
// Run with: npx tsx mcp/e2e.test.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const BASE_URL = process.env.MCP_URL ?? "http://localhost:3001";

async function main() {
  console.log(`\n=== Claw Clinic MCP E2E Tests ===`);
  console.log(`Connecting to ${BASE_URL}/sse\n`);

  const transport = new SSEClientTransport(new URL(`${BASE_URL}/sse`));
  const client = new Client({ name: "e2e-test", version: "1.0.0" });
  await client.connect(transport);
  console.log("Connected.\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  FAIL  ${name}\n        ${msg}`);
      failed++;
    }
  }

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  // ── List tools ──────────────────────────────────────────────────────
  await test("lists all 5 tools", async () => {
    const { tools } = await client.listTools();
    assert(tools.length === 5, `Expected 5 tools, got ${tools.length}`);
    const names = tools.map((t) => t.name).sort();
    const expected = [
      "hz_consult",
      "hz_diagnose",
      "hz_health_check",
      "hz_treat",
      "hz_validate_symptoms",
    ];
    assert(
      JSON.stringify(names) === JSON.stringify(expected),
      `Tool names mismatch: ${JSON.stringify(names)}`,
    );
  });

  // ── hz_validate_symptoms ────────────────────────────────────────────
  await test("hz_validate_symptoms — actionable symptoms", async () => {
    const result = await client.callTool({
      name: "hz_validate_symptoms",
      arguments: {
        symptoms: "My agent is stuck in an infinite loop calling the same tool over and over",
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.is_valid === true, `Expected is_valid=true, got ${data.is_valid}`);
    assert(data.detected_conditions?.length > 0, "Expected detected_conditions");
  });

  await test("hz_validate_symptoms — vague symptoms", async () => {
    const result = await client.callTool({
      name: "hz_validate_symptoms",
      arguments: { symptoms: "it's broken" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    // May or may not be valid, but should return a response
    assert(typeof data.is_valid === "boolean", "Expected is_valid boolean");
  });

  // ── hz_health_check ─────────────────────────────────────────────────
  const loopTrace = Array.from({ length: 10 }, (_, i) => ({
    step_number: i + 1,
    type: "tool_call" as const,
    content: {
      tool_name: "read_file",
      tool_args: { path: "/tmp/test.txt" },
    },
    metrics: { tokens_used: 500, latency_ms: 200, cost_usd: 0.01 },
  }));

  await test("hz_health_check — detects loop in trace", async () => {
    const result = await client.callTool({
      name: "hz_health_check",
      arguments: { trace: loopTrace },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.triage_level != null, "Expected triage_level");
    assert(data.anomalies != null, "Expected anomalies");
  });

  // ── hz_diagnose ─────────────────────────────────────────────────────
  await test("hz_diagnose — from symptoms text", async () => {
    const result = await client.callTool({
      name: "hz_diagnose",
      arguments: {
        symptoms:
          "Agent is calling the same API endpoint repeatedly and burning through tokens. Cost is $15 already.",
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.diagnosis != null, "Expected diagnosis");
    assert(data.diagnosis.primary != null, "Expected primary diagnosis");
    assert(data.diagnosis.primary.confidence > 0, "Expected confidence > 0");
    assert(data.analysis_method != null, `Expected analysis_method, got ${data.analysis_method}`);
    assert(
      data.analysis_method === "layer2+opus" || data.analysis_method === "layer2_only",
      `Expected valid analysis_method, got ${data.analysis_method}`,
    );
  });

  await test("hz_diagnose — reports analysis method", async () => {
    const result = await client.callTool({
      name: "hz_diagnose",
      arguments: { symptoms: "agent is looping" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    if (data.analysis_method === "layer2_only") {
      assert(data.note != null, "Expected note explaining why Opus was skipped");
      console.log(`        (Opus skipped: ${data.note})`);
    } else {
      assert(data.analysis_method === "layer2+opus", "Expected layer2+opus");
      assert(data.tokens_used > 0, "Expected tokens_used > 0 for Opus");
      assert(data.diagnosis.primary.analysis != null, "Expected Opus analysis text");
      assert(data.diagnosis.primary.root_cause != null, "Expected Opus root_cause");
      assert(data.treatment_plan != null, "Expected Opus treatment_plan");
    }
  });

  await test("hz_diagnose — from trace", async () => {
    const result = await client.callTool({
      name: "hz_diagnose",
      arguments: { trace: loopTrace },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.diagnosis?.primary != null, "Expected primary diagnosis from trace");
    assert(data.case_id != null, "Expected case_id");
    assert(data.triage_level != null, "Expected triage_level");
    assert(data.analysis_method != null, "Expected analysis_method");
  });

  await test("hz_diagnose — accepts extra evidence fields", async () => {
    const result = await client.callTool({
      name: "hz_diagnose",
      arguments: {
        symptoms: "Agent is stuck in an infinite loop",
        severity: "critical",
        onset: "sudden",
        affected_tools: ["read_file", "bash"],
        error_messages: ["ENOENT: no such file", "Permission denied"],
        previous_treatments: ["Told agent to stop looping"],
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.diagnosis?.primary != null, "Expected diagnosis with extra fields");
  });

  await test("hz_diagnose — accepts logs and config", async () => {
    const result = await client.callTool({
      name: "hz_diagnose",
      arguments: {
        symptoms: "Agent tools keep failing with permission errors",
        config: { max_retries: 3, timeout_ms: 5000 },
        logs: [
          { timestamp: "2026-03-11T10:00:00Z", level: "ERROR", source: "bash", message: "Permission denied" },
          { timestamp: "2026-03-11T10:00:01Z", level: "ERROR", source: "bash", message: "Permission denied" },
        ],
        environment: { os: "linux", node_version: "22.0.0" },
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.diagnosis?.primary != null, "Expected diagnosis with logs/config");
  });

  await test("hz_diagnose — rejects empty input", async () => {
    const result = await client.callTool({
      name: "hz_diagnose",
      arguments: {},
    });
    assert(result.isError === true, "Expected isError for empty input");
  });

  // ── hz_treat ────────────────────────────────────────────────────────
  await test("hz_treat — apply prescription", async () => {
    // First diagnose to get a prescription ID
    const diagResult = await client.callTool({
      name: "hz_diagnose",
      arguments: { trace: loopTrace },
    });
    const diagText = (diagResult.content as Array<{ text: string }>)[0].text;
    const diagData = JSON.parse(diagText);
    const rxId = diagData.prescription?.id ?? "RX-STD-001";
    const caseId = diagData.case_id ?? "test-case-001";

    const result = await client.callTool({
      name: "hz_treat",
      arguments: {
        prescription_id: rxId,
        case_id: caseId,
        auto_apply: true,
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.prescription?.id != null || data.status != null, "Expected prescription or status in treat response");
  });

  // ── hz_consult ──────────────────────────────────────────────────────
  await test("hz_consult — specialist consultation", async () => {
    const result = await client.callTool({
      name: "hz_consult",
      arguments: {
        case_summary:
          "Agent keeps calling read_file on the same path in an infinite loop. Already tried restarting but it resumed the same behavior.",
        trace: loopTrace,
        urgency: "URGENT",
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.consultation_id != null, "Expected consultation_id");
    assert(data.status === "completed", `Expected status=completed, got ${data.status}`);
  });

  // ── Mixed error trace ───────────────────────────────────────────────
  const errorTrace = [
    { step_number: 1, type: "tool_call" as const, content: { tool_name: "bash", tool_args: { cmd: "npm test" } }, metrics: { tokens_used: 200, latency_ms: 100, cost_usd: 0.005 } },
    { step_number: 2, type: "error" as const, content: { error: { code: "TOOL_FAILED", message: "Command failed with exit code 1" } }, metrics: { tokens_used: 50, latency_ms: 10, cost_usd: 0.001 } },
    { step_number: 3, type: "tool_call" as const, content: { tool_name: "bash", tool_args: { cmd: "npm test" } }, metrics: { tokens_used: 200, latency_ms: 100, cost_usd: 0.005 } },
    { step_number: 4, type: "error" as const, content: { error: { code: "TOOL_FAILED", message: "Command failed with exit code 1" } }, metrics: { tokens_used: 50, latency_ms: 10, cost_usd: 0.001 } },
    { step_number: 5, type: "tool_call" as const, content: { tool_name: "bash", tool_args: { cmd: "npm test" } }, metrics: { tokens_used: 200, latency_ms: 100, cost_usd: 0.005 } },
    { step_number: 6, type: "error" as const, content: { error: { code: "TOOL_FAILED", message: "Command failed with exit code 1" } }, metrics: { tokens_used: 50, latency_ms: 10, cost_usd: 0.001 } },
  ];

  await test("hz_health_check — error-heavy trace", async () => {
    const result = await client.callTool({
      name: "hz_health_check",
      arguments: { trace: errorTrace },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.triage_level != null, "Expected triage_level");
    assert(data.anomalies != null, "Expected anomalies");
  });

  await test("hz_diagnose — error-heavy trace", async () => {
    const result = await client.callTool({
      name: "hz_diagnose",
      arguments: { trace: errorTrace },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const data = JSON.parse(text);
    assert(data.diagnosis?.primary != null, "Expected diagnosis for error trace");
  });

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
