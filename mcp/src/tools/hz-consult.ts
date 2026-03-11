import {
  ConsultInputSchema,
  MVP_DISEASES,
} from "@claw-clinic/shared";
import { diagnose } from "../layer2/pattern-matcher.js";
import { normalizeTrace } from "../utils/normalize-trace.js";
import { processCaseConsultation } from "@claw-clinic/workers/doctor-agent";
import type { ConsultationRequest } from "@claw-clinic/workers/doctor-agent";

export async function handleConsult(args: unknown): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  // Validate input
  const parsed = ConsultInputSchema.safeParse(args);
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

  const { case_summary, urgency } = parsed.data;
  const trace = parsed.data.trace
    ? normalizeTrace(parsed.data.trace as unknown as Array<Record<string, unknown>>)
    : undefined;

  // Run a preliminary Layer 2 diagnosis if trace is available
  let preliminaryDiagnosis: ConsultationRequest["preliminary_diagnosis"] = undefined;
  if (trace && trace.length > 0) {
    const diagResult = diagnose(
      { symptoms: case_summary, trace },
      MVP_DISEASES,
    );
    if (diagResult.primary) {
      preliminaryDiagnosis = {
        icd_ai_code: diagResult.primary.icd_ai_code,
        confidence: diagResult.primary.confidence,
      };
    }
  }

  // Run the Doctor Agent (Layer 3) for a full consultation
  try {
    const consultationRequest: ConsultationRequest = {
      case_summary,
      trace,
      urgency: urgency ?? "STANDARD",
      preliminary_diagnosis: preliminaryDiagnosis,
    };

    const result = await processCaseConsultation(consultationRequest);

    // Format the response for MCP output
    const response = {
      consultation_id: result.consultation_id,
      status: result.status,
      diagnosis: result.diagnosis,
      prescription: result.prescription
        ? {
            id: result.prescription.id,
            name: result.prescription.name,
            custom_instructions: result.prescription.custom_instructions,
            steps: result.prescription.steps,
          }
        : null,
      risk_assessment: result.risk_assessment,
      doctor_notes: result.doctor_notes,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    // Fallback to the preliminary diagnosis if the Doctor Agent fails
    const fallbackResponse = {
      consultation_id: `consult_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`,
      status: "error" as const,
      diagnosis: preliminaryDiagnosis
        ? {
            primary: {
              icd_ai_code: preliminaryDiagnosis.icd_ai_code,
              confidence: preliminaryDiagnosis.confidence,
              reasoning: "Fallback to Layer 2 pattern matching due to Doctor Agent error.",
            },
            differential: [],
            comorbidities: [],
          }
        : { primary: null, differential: [], comorbidities: [] },
      prescription: null,
      risk_assessment: {
        severity: "Unknown",
        urgency,
        recommended_monitoring: "Standard follow-up schedule: T+24h, T+48h, T+72h.",
      },
      doctor_notes: `Doctor Agent encountered an error: ${error instanceof Error ? error.message : "Unknown error"}. Fell back to Layer 2 preliminary diagnosis.`,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(fallbackResponse, null, 2),
        },
      ],
      isError: true,
    };
  }
}
