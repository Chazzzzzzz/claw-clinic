import {
  TreatInputSchema,
  STANDARD_PRESCRIPTIONS,
} from "@claw-clinic/shared";

export async function handleTreat(args: unknown): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  // Validate input
  const parsed = TreatInputSchema.safeParse(args);
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

  const { prescription_id, auto_apply, case_id } = parsed.data;

  // Look up prescription
  const prescription = STANDARD_PRESCRIPTIONS.find(
    (p) => p.id === prescription_id,
  );
  if (!prescription) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "NOT_FOUND",
              message: `Prescription '${prescription_id}' not found. Use hz_lookup to find available prescriptions.`,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Auto-apply safety check: respect the prescription's auto_applicable flag
  if (auto_apply && !prescription.auto_applicable) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "RISK_TOO_HIGH",
              message: `Prescription '${prescription.name}' has risk level '${prescription.risk_level}' and cannot be auto-applied. Set auto_apply to false to receive instructions for human review.`,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Build treatment instructions
  const instructions = prescription.steps
    .map((step) => step.change)
    .join("\n\n");

  const followUpSchedule = {
    check_at_hours: [24, 48, 72],
    instruction:
      "Call hz_health_check with your recent trace at each of these intervals to verify the treatment is working. This is required for outcome tracking.",
  };

  if (auto_apply) {
    // Auto-apply: low risk prescription
    const response = {
      status: "applied",
      prescription: {
        id: prescription.id,
        name: prescription.name,
        target_disease: prescription.target_disease,
        risk_level: prescription.risk_level,
        steps: prescription.steps.map((s) => ({
          action: s.action,
          target: s.target,
          change: s.change,
          rationale: s.rationale,
        })),
      },
      instructions: `The following treatment has been applied to your session. Follow these instructions:\n\n${instructions}`,
      follow_up_schedule: followUpSchedule,
      case_id,
      side_effects: prescription.side_effects,
      contraindications: prescription.contraindications,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } else {
    // Pending human approval: medium/high risk
    const stepsWithRationale = prescription.steps.map((s) => ({
      action: s.action,
      target: s.target,
      change: s.change,
      rationale: s.rationale,
      reversible: s.reversible,
    }));

    const response = {
      status: "pending_human_approval",
      prescription: {
        id: prescription.id,
        name: prescription.name,
        target_disease: prescription.target_disease,
        risk_level: prescription.risk_level,
      },
      instructions_for_operator: `The following changes require human approval. Share these with your operator:\n\n${JSON.stringify(stepsWithRationale, null, 2)}`,
      follow_up_schedule: followUpSchedule,
      case_id,
      side_effects: prescription.side_effects,
      contraindications: prescription.contraindications,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }
}
