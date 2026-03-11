import type { TraceRecord } from "@claw-clinic/shared";

export function normalizeTrace(input: Array<Record<string, unknown>>): TraceRecord[] {
  return input.map((item, index) => ({
    step_number: (item.step_number as number) ?? index,
    timestamp: (item.timestamp as string) ?? new Date().toISOString(),
    type: (item.type as TraceRecord["type"]) ?? "reasoning",
    content: (item.content as TraceRecord["content"]) ?? {},
    metrics: {
      tokens_used: ((item.metrics as Record<string, unknown>)?.tokens_used as number) ?? 0,
      latency_ms: ((item.metrics as Record<string, unknown>)?.latency_ms as number) ?? 0,
      cost_usd: ((item.metrics as Record<string, unknown>)?.cost_usd as number) ?? 0,
    },
  }));
}
