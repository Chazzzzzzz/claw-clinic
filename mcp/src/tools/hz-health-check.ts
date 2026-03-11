import { HealthCheckInputSchema } from "@claw-clinic/shared";
import { runImmuneSystem } from "../layer1/immune-system.js";
import { normalizeTrace } from "../utils/normalize-trace.js";

export async function handleHealthCheck(args: unknown): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  // Validate input
  const parsed = HealthCheckInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "INVALID_INPUT",
              message: parsed.error.message,
              details: parsed.error.issues,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  const { config } = parsed.data;
  const trace = normalizeTrace(
    parsed.data.trace as unknown as Array<Record<string, unknown>>,
  );

  // Run the immune system analysis
  const report = runImmuneSystem(trace, {
    budget_ceiling_usd: config?.budget_ceiling_usd,
    context_window_size: config?.context_window_size,
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(report, null, 2),
      },
    ],
  };
}
