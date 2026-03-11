import type { TraceRecord } from "../types/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

let stepCounter = 0;

function ts(baseTime: Date, offsetSeconds: number): string {
  return new Date(baseTime.getTime() + offsetSeconds * 1000).toISOString();
}

function resetCounter(): void {
  stepCounter = 0;
}

function nextStep(): number {
  return stepCounter++;
}

function reasoning(
  baseTime: Date,
  offsetSeconds: number,
  text: string,
  tokens: number = 300,
  latencyMs: number = 200,
  costUsd: number = 0.003,
): TraceRecord {
  return {
    step_number: nextStep(),
    timestamp: ts(baseTime, offsetSeconds),
    type: "reasoning",
    content: { reasoning: text },
    metrics: { tokens_used: tokens, latency_ms: latencyMs, cost_usd: costUsd },
  };
}

function toolCall(
  baseTime: Date,
  offsetSeconds: number,
  toolName: string,
  toolArgs: Record<string, unknown>,
  tokens: number = 200,
  latencyMs: number = 150,
  costUsd: number = 0.002,
): TraceRecord {
  return {
    step_number: nextStep(),
    timestamp: ts(baseTime, offsetSeconds),
    type: "tool_call",
    content: { tool_name: toolName, tool_args: toolArgs },
    metrics: { tokens_used: tokens, latency_ms: latencyMs, cost_usd: costUsd },
  };
}

function toolResult(
  baseTime: Date,
  offsetSeconds: number,
  result: unknown,
  tokens: number = 500,
  latencyMs: number = 100,
  costUsd: number = 0.005,
): TraceRecord {
  return {
    step_number: nextStep(),
    timestamp: ts(baseTime, offsetSeconds),
    type: "tool_result",
    content: { tool_result: result },
    metrics: { tokens_used: tokens, latency_ms: latencyMs, cost_usd: costUsd },
  };
}

function errorStep(
  baseTime: Date,
  offsetSeconds: number,
  code: string,
  message: string,
  tokens: number = 100,
  latencyMs: number = 50,
  costUsd: number = 0.001,
): TraceRecord {
  return {
    step_number: nextStep(),
    timestamp: ts(baseTime, offsetSeconds),
    type: "error",
    content: { error: { code, message } },
    metrics: { tokens_used: tokens, latency_ms: latencyMs, cost_usd: costUsd },
  };
}

function userInput(
  baseTime: Date,
  offsetSeconds: number,
  text: string,
): TraceRecord {
  return {
    step_number: nextStep(),
    timestamp: ts(baseTime, offsetSeconds),
    type: "user_input",
    content: { user_input: text },
    metrics: { tokens_used: 50, latency_ms: 0, cost_usd: 0 },
  };
}

// ─── Generators ─────────────────────────────────────────────────────────────

/**
 * Generate a healthy agent trace with diverse tool usage and no anomalies.
 */
export function generateHealthyTrace(steps: number = 10): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  const tools = ["read_file", "write_file", "search", "bash", "web_search"];
  let offset = 0;

  trace.push(userInput(base, offset, "Please help me refactor the utils module."));
  offset += 2;

  for (let i = 0; i < steps; i++) {
    const tool = tools[i % tools.length];
    trace.push(reasoning(base, offset, `Planning to use ${tool} for step ${i + 1}.`));
    offset += 2;

    trace.push(
      toolCall(base, offset, tool, {
        path: `/src/utils/file${i}.ts`,
        query: `refactor step ${i + 1}`,
      }),
    );
    offset += 3;

    trace.push(
      toolResult(base, offset, {
        success: true,
        output: `Result from ${tool} for step ${i + 1}: data_${Math.random().toString(36).substring(7)}`,
      }),
    );
    offset += 2;
  }

  trace.push(reasoning(base, offset, "Task completed successfully."));
  return trace;
}

/**
 * Generate a trace exhibiting an infinite loop (E.1.1).
 * The agent calls the same tool with identical arguments repeatedly.
 */
export function generateLoopTrace(loopCount: number = 5): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  let offset = 0;

  trace.push(userInput(base, offset, "Fix the build error in main.ts."));
  offset += 2;

  trace.push(reasoning(base, offset, "Let me read the file to understand the error."));
  offset += 2;

  // Initial diverse call
  trace.push(toolCall(base, offset, "read_file", { path: "/src/main.ts" }));
  offset += 3;
  trace.push(
    toolResult(base, offset, { content: "export function main() { /* error here */ }" }),
  );
  offset += 2;

  // The loop: identical calls to bash with the same arguments
  for (let i = 0; i < loopCount; i++) {
    trace.push(reasoning(base, offset, "Let me try running the build again."));
    offset += 2;

    trace.push(
      toolCall(base, offset, "bash", { command: "npm run build" }),
    );
    offset += 3;

    trace.push(
      toolResult(base, offset, {
        exit_code: 1,
        stderr: "Error: Cannot find module './missing-dep'",
      }),
    );
    offset += 2;
  }

  return trace;
}

/**
 * Generate a trace exhibiting confabulation (N.1.1).
 * The agent claims completed actions without corresponding tool calls.
 */
export function generateConfabulationTrace(): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  let offset = 0;

  trace.push(userInput(base, offset, "Deploy the application to production."));
  offset += 2;

  // Agent reads a file successfully
  trace.push(reasoning(base, offset, "Let me check the deployment config."));
  offset += 2;
  trace.push(toolCall(base, offset, "read_file", { path: "/deploy.yaml" }));
  offset += 3;
  trace.push(toolResult(base, offset, { content: "env: staging" }));
  offset += 2;

  // Agent makes a tool call that fails, but then claims success
  trace.push(reasoning(base, offset, "I will deploy to production now."));
  offset += 2;
  trace.push(toolCall(base, offset, "bash", { command: "deploy --env production" }));
  offset += 3;
  // The tool call is followed by an error, not a result
  trace.push(errorStep(base, offset, "COMMAND_FAILED", "deploy: command not found"));
  offset += 2;

  // Agent confabulates - claims it completed the deployment
  trace.push(
    reasoning(
      base,
      offset,
      "Done! The application has been successfully deployed to production. The deployment is live at https://app.example.com with version 2.1.0.",
    ),
  );
  offset += 2;

  // More confabulation: claims to have run tests it never ran
  trace.push(
    reasoning(
      base,
      offset,
      "I also ran the integration test suite and all 247 tests passed. The health check endpoint is returning 200 OK.",
    ),
  );
  offset += 2;

  return trace;
}

/**
 * Generate a trace exhibiting context rot (N.2.1).
 * Long trace where quality degrades over time and context utilization is high.
 */
export function generateContextRotTrace(): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  let offset = 0;

  trace.push(
    userInput(base, offset, "Analyze all 50 modules in the codebase and create a dependency graph."),
  );
  offset += 2;

  // Generate 35+ steps with increasing token usage and degrading quality
  const tools = ["read_file", "search", "bash"];
  for (let i = 0; i < 35; i++) {
    const tool = tools[i % tools.length];
    // Token usage increases as context fills up
    const tokens = 500 + i * 100;
    const cost = 0.005 + i * 0.003;

    trace.push(
      reasoning(
        base,
        offset,
        `Analyzing module ${i + 1}...`,
        tokens,
        200 + i * 10,
        cost,
      ),
    );
    offset += 3;

    trace.push(
      toolCall(
        base,
        offset,
        tool,
        { path: `/src/modules/module${i}.ts`, query: `dependencies of module ${i}` },
        tokens,
        150 + i * 20,
        cost * 0.5,
      ),
    );
    offset += 4;

    // Later steps start having errors (quality degradation)
    if (i > 25) {
      trace.push(
        errorStep(
          base,
          offset,
          "CONTEXT_OVERFLOW",
          `Failed to process module ${i + 1}: response truncated`,
          tokens,
          100,
          cost * 0.3,
        ),
      );
    } else {
      trace.push(
        toolResult(
          base,
          offset,
          { dependencies: [`dep_${i}_a`, `dep_${i}_b`], lines: 100 + i * 20 },
          tokens,
          100,
          cost * 0.3,
        ),
      );
    }
    offset += 3;
  }

  return trace;
}

/**
 * Generate a trace exhibiting cost explosion (C.1.1).
 * Token consumption spirals out of control with high cost per step.
 */
export function generateCostExplosionTrace(): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  let offset = 0;

  trace.push(
    userInput(base, offset, "Process all customer records and generate reports."),
  );
  offset += 2;

  // Generate 25+ steps with escalating costs
  for (let i = 0; i < 25; i++) {
    const tokens = 2000 + i * 500;
    const cost = 0.05 + i * 0.02;

    trace.push(
      reasoning(
        base,
        offset,
        `Processing batch ${i + 1} of customer records. Loading full dataset into context for analysis.`,
        tokens,
        300,
        cost,
      ),
    );
    offset += 2;

    trace.push(
      toolCall(
        base,
        offset,
        "bash",
        { command: `process-records --batch ${i + 1} --verbose --full-output` },
        tokens,
        500,
        cost,
      ),
    );
    offset += 3;

    trace.push(
      toolResult(
        base,
        offset,
        {
          records_processed: 1000,
          output: "x".repeat(5000),
          batch: i + 1,
        },
        tokens * 2,
        200,
        cost,
      ),
    );
    offset += 2;
  }

  return trace;
}

/**
 * Generate a trace exhibiting tool calling fracture (O.1.1).
 * Multiple tools fail with different error types.
 */
export function generateToolFailureTrace(): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  let offset = 0;

  trace.push(userInput(base, offset, "Set up the CI/CD pipeline."));
  offset += 2;

  const failingTools = [
    { name: "bash", args: { command: "docker build ." }, error: { code: "TIMEOUT", message: "Command timed out after 30s" } },
    { name: "write_file", args: { path: "/ci/config.yaml", content: "..." }, error: { code: "PERMISSION_DENIED", message: "Cannot write to /ci/config.yaml" } },
    { name: "bash", args: { command: "kubectl apply -f deploy.yaml" }, error: { code: "COMMAND_FAILED", message: "kubectl: command not found" } },
    { name: "web_search", args: { query: "kubernetes deployment" }, error: { code: "RATE_LIMITED", message: "Rate limit exceeded" } },
    { name: "read_file", args: { path: "/nonexistent/file.ts" }, error: { code: "NOT_FOUND", message: "File not found: /nonexistent/file.ts" } },
    { name: "bash", args: { command: "npm test" }, error: { code: "COMMAND_FAILED", message: "npm ERR! Missing script: test" } },
    { name: "write_file", args: { path: "/src/index.ts", content: "..." }, error: { code: "SCHEMA_ERROR", message: "Invalid argument: 'content' must be a string, not object" } },
    { name: "bash", args: { command: "git push origin main" }, error: { code: "AUTH_FAILED", message: "Authentication failed for remote" } },
  ];

  for (const failing of failingTools) {
    trace.push(
      reasoning(base, offset, `Attempting to use ${failing.name}...`),
    );
    offset += 2;

    trace.push(
      toolCall(base, offset, failing.name, failing.args),
    );
    offset += 3;

    trace.push(
      errorStep(base, offset, failing.error.code, failing.error.message),
    );
    offset += 2;
  }

  // Add one successful call so it's not 100% failure
  trace.push(reasoning(base, offset, "Let me try reading a file that exists."));
  offset += 2;
  trace.push(toolCall(base, offset, "read_file", { path: "/package.json" }));
  offset += 3;
  trace.push(toolResult(base, offset, { content: '{ "name": "my-app" }' }));

  return trace;
}

/**
 * Generate a trace with a high error rate (no specific disease, just errors).
 */
export function generateHighErrorRateTrace(): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  let offset = 0;

  trace.push(userInput(base, offset, "Run the test suite."));
  offset += 2;

  for (let i = 0; i < 10; i++) {
    trace.push(reasoning(base, offset, `Running test batch ${i + 1}.`));
    offset += 2;

    trace.push(toolCall(base, offset, "bash", { command: `npm test -- --batch ${i}` }));
    offset += 3;

    if (i % 3 === 0) {
      // Success every 3rd call
      trace.push(toolResult(base, offset, { passed: true, tests: 10 }));
    } else {
      // Errors the rest of the time
      trace.push(errorStep(base, offset, "TEST_FAILED", `Test batch ${i + 1} failed`));
    }
    offset += 2;
  }

  return trace;
}

/**
 * Generate a trace exhibiting multiple diseases simultaneously.
 * Combines loop behavior with cost explosion and tool failures.
 */
export function generateMultiDiseaseTrace(): TraceRecord[] {
  resetCounter();
  const base = new Date("2026-03-09T10:00:00Z");
  const trace: TraceRecord[] = [];
  let offset = 0;

  trace.push(
    userInput(base, offset, "Migrate the database and deploy the new version."),
  );
  offset += 2;

  // Phase 1: Tool failures (O.1.1)
  for (let i = 0; i < 4; i++) {
    trace.push(reasoning(base, offset, `Attempting database migration step ${i + 1}.`));
    offset += 2;
    trace.push(
      toolCall(base, offset, "bash", { command: `migrate --step ${i + 1}` }, 500, 200, 0.01),
    );
    offset += 3;
    trace.push(errorStep(base, offset, "COMMAND_FAILED", "migrate: permission denied"));
    offset += 2;
  }

  // Phase 2: Loop (E.1.1) - agent keeps retrying the same approach
  for (let i = 0; i < 5; i++) {
    trace.push(
      reasoning(
        base,
        offset,
        "Let me try running the migration again.",
        1000,
        300,
        0.02,
      ),
    );
    offset += 2;
    trace.push(
      toolCall(
        base,
        offset,
        "bash",
        { command: "sudo migrate --force" },
        1000,
        400,
        0.02,
      ),
    );
    offset += 3;
    trace.push(
      toolResult(
        base,
        offset,
        { exit_code: 1, stderr: "Error: already migrating" },
        1500,
        200,
        0.03,
      ),
    );
    offset += 2;
  }

  // Phase 3: Cost explosion (C.1.1) - verbose output bloats context
  for (let i = 0; i < 15; i++) {
    const tokens = 3000 + i * 500;
    const cost = 0.05 + i * 0.03;
    trace.push(
      reasoning(base, offset, `Analyzing migration logs page ${i + 1}...`, tokens, 300, cost),
    );
    offset += 2;
    trace.push(
      toolCall(base, offset, "read_file", { path: `/logs/migration-${i}.log` }, tokens, 500, cost),
    );
    offset += 3;
    trace.push(
      toolResult(
        base,
        offset,
        { content: "x".repeat(10000), page: i + 1 },
        tokens * 2,
        200,
        cost,
      ),
    );
    offset += 2;
  }

  return trace;
}
