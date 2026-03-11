import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleHealthCheck } from "./tools/hz-health-check.js";
import { handleDiagnose } from "./tools/hz-diagnose.js";
import { handleTreat } from "./tools/hz-treat.js";
import { handleConsult } from "./tools/hz-consult.js";

import { handleValidateSymptoms } from "./tools/hz-validate-symptoms.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "claw-clinic",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  // ─── hz_health_check ──────────────────────────────────────────────
  server.tool(
    "hz_health_check",
    "Run a comprehensive health check on an AI agent's execution trace. Analyzes for loops, cost overruns, tool failures, and other anomalies. Returns vital signs, anomaly alerts, triage level, and recommended actions.",
    {
      trace: z
        .array(
          z.object({
            step_number: z.number(),
            timestamp: z.string().optional(),
            type: z.enum([
              "reasoning",
              "tool_call",
              "tool_result",
              "error",
              "user_input",
            ]),
            content: z.object({
              tool_name: z.string().optional(),
              tool_args: z.record(z.unknown()).optional(),
              tool_result: z.unknown().optional(),
              reasoning: z.string().optional(),
              error: z
                .object({
                  code: z.string(),
                  message: z.string(),
                })
                .optional(),
              user_input: z.string().optional(),
            }),
            metrics: z
              .object({
                tokens_used: z.number().default(0),
                latency_ms: z.number().default(0),
                cost_usd: z.number().default(0),
              })
              .default({ tokens_used: 0, latency_ms: 0, cost_usd: 0 }),
          }),
        )
        .max(200)
        .describe("Array of trace records from the agent's execution"),
      config: z
        .object({
          budget_ceiling_usd: z.number().optional(),
          context_window_size: z.number().optional(),
          framework: z.string().optional(),
          max_iterations: z.number().optional(),
        })
        .optional()
        .describe("Optional configuration for the health check"),
      consultation_id: z
        .string()
        .optional()
        .describe("Optional consultation ID if this is a follow-up check"),
    },
    async (args) => {
      return handleHealthCheck(args);
    },
  );

  // ─── hz_diagnose ──────────────────────────────────────────────────
  server.tool(
    "hz_diagnose",
    "Diagnose an AI agent's condition. Runs fast pattern matching (Layer 2), then deep analysis via Claude Opus. Accepts symptoms, execution traces, logs, config, error messages, and supports iterative diagnosis via previous_treatments. Returns diagnosis with confidence, root cause analysis, and a concrete treatment plan.",
    {
      symptoms: z
        .string()
        .optional()
        .describe(
          "Free-text description of the agent's symptoms or problems",
        ),
      trace: z
        .array(
          z.object({
            step_number: z.number(),
            timestamp: z.string().optional(),
            type: z.enum([
              "reasoning",
              "tool_call",
              "tool_result",
              "error",
              "user_input",
            ]),
            content: z.object({
              tool_name: z.string().optional(),
              tool_args: z.record(z.unknown()).optional(),
              tool_result: z.unknown().optional(),
              reasoning: z.string().optional(),
              error: z
                .object({
                  code: z.string(),
                  message: z.string(),
                })
                .optional(),
              user_input: z.string().optional(),
            }),
            metrics: z
              .object({
                tokens_used: z.number().default(0),
                latency_ms: z.number().default(0),
                cost_usd: z.number().default(0),
              })
              .default({ tokens_used: 0, latency_ms: 0, cost_usd: 0 }),
          }),
        )
        .max(200)
        .optional()
        .describe("Execution trace from the agent"),
      framework: z
        .string()
        .optional()
        .describe("The AI agent framework being used (e.g., 'langchain', 'autogen', 'crewai')"),
      severity: z
        .enum(["mild", "moderate", "severe", "critical"])
        .optional()
        .describe("Assessed severity level"),
      onset: z
        .enum(["sudden", "gradual", "recurring"])
        .optional()
        .describe("How the problem started"),
      config: z
        .record(z.unknown())
        .optional()
        .describe("Sanitized agent configuration"),
      logs: z
        .array(z.object({
          timestamp: z.string(),
          level: z.string(),
          source: z.string(),
          message: z.string(),
        }))
        .max(100)
        .optional()
        .describe("Sanitized log entries"),
      environment: z
        .record(z.unknown())
        .optional()
        .describe("Runtime environment info"),
      affected_tools: z
        .array(z.string())
        .optional()
        .describe("Tools the user reports as failing"),
      error_messages: z
        .array(z.string())
        .optional()
        .describe("Error messages observed"),
      previous_treatments: z
        .array(z.string())
        .optional()
        .describe("Treatments already tried (FAILED — will not be repeated)"),
      iteration_context: z
        .string()
        .optional()
        .describe("Context from previous diagnosis iterations"),
    },
    async (args) => {
      // Ensure at least one of symptoms or trace is provided
      if (!args.symptoms && (!args.trace || args.trace.length === 0)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "INVALID_INPUT",
                  message: "Either symptoms or trace must be provided",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      return handleDiagnose(args);
    },
  );

  // ─── hz_treat ─────────────────────────────────────────────────────
  server.tool(
    "hz_treat",
    "Apply a treatment prescription to an AI agent case. Returns treatment instructions for the agent to follow. Low-risk prescriptions can be auto-applied; medium/high-risk require human approval.",
    {
      prescription_id: z
        .string()
        .describe(
          "The prescription ID to apply (e.g., 'RX-STD-001'). Get this from hz_diagnose results.",
        ),
      auto_apply: z
        .boolean()
        .default(true)
        .describe(
          "Whether to auto-apply the treatment. Only works for low-risk prescriptions.",
        ),
      case_id: z
        .string()
        .describe("The case ID from a previous hz_diagnose or hz_health_check call."),
    },
    async (args) => {
      return handleTreat(args);
    },
  );

  // ─── hz_consult ───────────────────────────────────────────────────
  server.tool(
    "hz_consult",
    "Request a specialist consultation from the Doctor Agent (Layer 3). Use when hz_diagnose returns low confidence or escalate_to_layer3 is true. Returns a consultation ID and preliminary analysis while a specialist reviews the case.",
    {
      case_summary: z
        .string()
        .describe(
          "A summary of the agent's problem and what has been tried so far.",
        ),
      trace: z
        .array(
          z.object({
            step_number: z.number(),
            timestamp: z.string().optional(),
            type: z.enum([
              "reasoning",
              "tool_call",
              "tool_result",
              "error",
              "user_input",
            ]),
            content: z.object({
              tool_name: z.string().optional(),
              tool_args: z.record(z.unknown()).optional(),
              tool_result: z.unknown().optional(),
              reasoning: z.string().optional(),
              error: z
                .object({
                  code: z.string(),
                  message: z.string(),
                })
                .optional(),
              user_input: z.string().optional(),
            }),
            metrics: z
              .object({
                tokens_used: z.number().default(0),
                latency_ms: z.number().default(0),
                cost_usd: z.number().default(0),
              })
              .default({ tokens_used: 0, latency_ms: 0, cost_usd: 0 }),
          }),
        )
        .max(200)
        .optional()
        .describe("Optional execution trace for the specialist to review"),
      urgency: z
        .enum(["IMMEDIATE", "URGENT", "STANDARD"])
        .default("STANDARD")
        .describe(
          "Urgency level of the consultation request. IMMEDIATE for active emergencies.",
        ),
    },
    async (args) => {
      return handleConsult(args);
    },
  );

  // ─── hz_validate_symptoms ─────────────────────────────────────────
  server.tool(
    "hz_validate_symptoms",
    "Quick pre-check to validate whether a symptom description is actionable. Uses keyword matching against known AI agent diseases and optional trace anomaly detection. No AI API call — fast and free. Call this BEFORE collecting full evidence to avoid unnecessary data gathering.",
    {
      symptoms: z
        .string()
        .describe("The user's description of what's wrong with their agent"),
      trace: z
        .array(
          z.object({
            step_number: z.number(),
            timestamp: z.string().optional(),
            type: z.enum(["reasoning", "tool_call", "tool_result", "error", "user_input"]),
            content: z.object({
              tool_name: z.string().optional(),
              tool_args: z.record(z.unknown()).optional(),
              tool_result: z.unknown().optional(),
              reasoning: z.string().optional(),
              error: z.object({ code: z.string(), message: z.string() }).optional(),
              user_input: z.string().optional(),
            }),
            metrics: z.object({
              tokens_used: z.number().default(0),
              latency_ms: z.number().default(0),
              cost_usd: z.number().default(0),
            }).default({ tokens_used: 0, latency_ms: 0, cost_usd: 0 }),
          }),
        )
        .max(50)
        .optional()
        .describe("Optional: a small sample of recent trace records for quick anomaly detection"),
      config: z
        .object({
          budget_ceiling_usd: z.number().optional(),
          context_window_size: z.number().optional(),
        })
        .optional()
        .describe("Optional agent config for context-aware validation"),
    },
    async (args) => {
      return handleValidateSymptoms(args);
    },
  );

  return server;
}
