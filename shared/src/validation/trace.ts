import { z } from "zod";

export const TraceRecordSchema = z.object({
  step_number: z.number(),
  timestamp: z.string().optional(),
  type: z.enum(["reasoning", "tool_call", "tool_result", "error", "user_input"]),
  content: z.object({
    tool_name: z.string().optional(),
    tool_args: z.record(z.unknown()).optional(),
    tool_result: z.unknown().optional(),
    reasoning: z.string().optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
    }).optional(),
    user_input: z.string().optional(),
  }),
  metrics: z.object({
    tokens_used: z.number().default(0),
    latency_ms: z.number().default(0),
    cost_usd: z.number().default(0),
  }).default({ tokens_used: 0, latency_ms: 0, cost_usd: 0 }),
});

export const TraceArraySchema = z.array(TraceRecordSchema).max(200);

export const HealthCheckInputSchema = z.object({
  trace: TraceArraySchema,
  config: z.object({
    budget_ceiling_usd: z.number().default(5.0).optional(),
    context_window_size: z.number().optional(),
    framework: z.string().optional(),
    max_iterations: z.number().optional(),
  }).optional(),
  consultation_id: z.string().optional(),
});

export const LogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.string(),
  source: z.string(),
  message: z.string(),
});

export const DiagnoseInputSchema = z.object({
  symptoms: z.string().optional(),
  trace: TraceArraySchema.optional(),
  framework: z.string().optional(),
  severity: z.enum(["mild", "moderate", "severe", "critical"]).optional(),
  onset: z.enum(["sudden", "gradual", "recurring"]).optional(),
  config: z.record(z.unknown()).optional(),
  logs: z.array(LogEntrySchema).max(100).optional(),
  environment: z.record(z.unknown()).optional(),
  affected_tools: z.array(z.string()).optional(),
  error_messages: z.array(z.string()).optional(),
  previous_treatments: z.array(z.string()).optional(),
  iteration_context: z.string().optional(),
}).refine(data => data.symptoms || data.trace, {
  message: "Either symptoms or trace must be provided",
});

export const TreatInputSchema = z.object({
  prescription_id: z.string(),
  auto_apply: z.boolean().default(true),
  case_id: z.string(),
});

export const ConsultInputSchema = z.object({
  case_summary: z.string(),
  trace: TraceArraySchema.optional(),
  urgency: z.enum(["IMMEDIATE", "URGENT", "STANDARD"]).default("STANDARD"),
});

export const LookupInputSchema = z.object({
  query: z.string(),
});
