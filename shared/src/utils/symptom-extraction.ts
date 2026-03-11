import type { TraceRecord, SymptomVector } from "../types/index.js";

const IGNORED_KEYS = new Set(["timestamp", "request_id", "id", "nonce"]);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).filter(k => !IGNORED_KEYS.has(k));
  const bKeys = Object.keys(bObj).filter(k => !IGNORED_KEYS.has(k));

  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

export function extractSymptomVector(
  trace: TraceRecord[],
  contextWindowSize?: number
): SymptomVector {
  if (trace.length === 0) {
    return {
      step_count: 0,
      loop_count: 0,
      unique_tools: 0,
      error_rate: 0,
      token_velocity: 0,
      tool_success_rate: 1,
      latency_p95_ms: 0,
      cost_total_usd: 0,
      context_utilization: 0,
      output_diversity_score: 1,
    };
  }

  const toolCalls = trace.filter(t => t.type === "tool_call");
  const toolResults = trace.filter(t => t.type === "tool_result");
  const errors = trace.filter(t => t.type === "error");

  // step_count
  const step_count = trace.length;

  // loop_count: sliding window of 3 over tool calls
  let loop_count = 0;
  for (let i = 0; i <= toolCalls.length - 3; i++) {
    const window = toolCalls.slice(i, i + 3);
    const sameTool = window.every(t => t.content.tool_name === window[0].content.tool_name);
    if (sameTool) {
      let matchingPairs = 0;
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          if (deepEqual(window[a].content.tool_args, window[b].content.tool_args)) {
            matchingPairs++;
          }
        }
      }
      if (matchingPairs >= 2) loop_count++;
    }
  }

  // unique_tools
  const unique_tools = new Set(toolCalls.map(t => t.content.tool_name)).size;

  // error_rate
  const error_rate = step_count > 0 ? errors.length / step_count : 0;

  // token_velocity
  const totalTokens = trace.reduce((sum, t) => sum + (t.metrics?.tokens_used ?? 0), 0);
  const timestamps = trace.filter(t => t.timestamp).map(t => new Date(t.timestamp!).getTime());
  let elapsedMinutes = 0;
  if (timestamps.length >= 2) {
    elapsedMinutes = (Math.max(...timestamps) - Math.min(...timestamps)) / 60000;
  }
  const token_velocity = elapsedMinutes > 0 ? totalTokens / elapsedMinutes : totalTokens;

  // tool_success_rate
  let successfulToolCalls = 0;
  let totalToolCallsWithResult = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].type === "tool_call" && i + 1 < trace.length) {
      const next = trace[i + 1];
      totalToolCallsWithResult++;
      if (next.type === "tool_result") {
        successfulToolCalls++;
      }
    }
  }
  const tool_success_rate = totalToolCallsWithResult > 0
    ? successfulToolCalls / totalToolCallsWithResult
    : 1;

  // latency_p95_ms
  const latencies = trace
    .map(t => t.metrics?.latency_ms ?? 0)
    .filter(l => l > 0)
    .sort((a, b) => a - b);
  const latency_p95_ms = latencies.length > 0
    ? latencies[Math.floor(0.95 * latencies.length)] ?? latencies[latencies.length - 1]
    : 0;

  // cost_total_usd
  const cost_total_usd = trace.reduce((sum, t) => sum + (t.metrics?.cost_usd ?? 0), 0);

  // context_utilization
  const context_utilization = contextWindowSize && contextWindowSize > 0
    ? Math.min(totalTokens / contextWindowSize, 1)
    : 0;

  // output_diversity_score — measure from tool results if available, else from tool call args
  let output_diversity_score: number;
  const toolResultContents = toolResults.map(t => JSON.stringify(t.content.tool_result ?? ""));
  const uniqueResults = new Set(toolResultContents);
  if (toolResultContents.length > 0) {
    output_diversity_score = uniqueResults.size / toolResultContents.length;
  } else if (toolCalls.length > 0) {
    // Fallback: compute diversity from tool call content (name + args)
    const callContents = toolCalls.map(t =>
      JSON.stringify({ name: t.content.tool_name, args: t.content.tool_args ?? {} })
    );
    const uniqueCalls = new Set(callContents);
    output_diversity_score = uniqueCalls.size / callContents.length;
  } else {
    output_diversity_score = 1;
  }

  return {
    step_count,
    loop_count,
    unique_tools,
    error_rate,
    token_velocity,
    tool_success_rate,
    latency_p95_ms,
    cost_total_usd,
    context_utilization,
    output_diversity_score,
  };
}
