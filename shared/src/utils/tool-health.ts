import type { TraceRecord } from "../types/index.js";

export interface ToolHealthReport {
  tools: Array<{
    tool_name: string;
    call_count: number;
    success_count: number;
    error_count: number;
    success_rate: number;
    avg_latency_ms: number;
    status: "healthy" | "degraded" | "unhealthy";
  }>;
  overall_tool_success_rate: number;
  unreliable_tools: string[];
}

export function analyzeToolHealth(trace: TraceRecord[]): ToolHealthReport {
  // Group tool calls by tool_name and pair with their results
  const toolStats = new Map<
    string,
    {
      call_count: number;
      success_count: number;
      error_count: number;
      total_latency_ms: number;
    }
  >();

  for (let i = 0; i < trace.length; i++) {
    const step = trace[i];
    if (step.type !== "tool_call" || !step.content.tool_name) continue;

    const toolName = step.content.tool_name;
    if (!toolStats.has(toolName)) {
      toolStats.set(toolName, {
        call_count: 0,
        success_count: 0,
        error_count: 0,
        total_latency_ms: 0,
      });
    }

    const stats = toolStats.get(toolName)!;
    stats.call_count++;
    stats.total_latency_ms += step.metrics?.latency_ms ?? 0;

    // Check the next step to determine success/error
    if (i + 1 < trace.length) {
      const next = trace[i + 1];
      if (next.type === "tool_result" && !next.content.error) {
        stats.success_count++;
      } else {
        stats.error_count++;
      }
    }
  }

  const tools = Array.from(toolStats.entries()).map(([tool_name, stats]) => {
    const success_rate =
      stats.call_count > 0 ? stats.success_count / stats.call_count : 1;
    const avg_latency_ms =
      stats.call_count > 0 ? stats.total_latency_ms / stats.call_count : 0;

    let status: "healthy" | "degraded" | "unhealthy";
    if (success_rate >= 0.8) {
      status = "healthy";
    } else if (success_rate >= 0.5) {
      status = "degraded";
    } else {
      status = "unhealthy";
    }

    return {
      tool_name,
      call_count: stats.call_count,
      success_count: stats.success_count,
      error_count: stats.error_count,
      success_rate,
      avg_latency_ms,
      status,
    };
  });

  const totalCalls = tools.reduce((sum, t) => sum + t.call_count, 0);
  const totalSuccesses = tools.reduce((sum, t) => sum + t.success_count, 0);
  const overall_tool_success_rate =
    totalCalls > 0 ? totalSuccesses / totalCalls : 1;

  const unreliable_tools = tools
    .filter((t) => t.status === "unhealthy")
    .map((t) => t.tool_name);

  return {
    tools,
    overall_tool_success_rate,
    unreliable_tools,
  };
}
