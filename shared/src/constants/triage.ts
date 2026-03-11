import type { TriageLevel } from "../types/index.js";

export const TRIAGE_LEVELS: Record<TriageLevel, {
  label: string;
  color: string;
  response: string;
  description: string;
}> = {
  RED: {
    label: "IMMEDIATE",
    color: "#dc2626",
    response: "Seconds",
    description: "Active breach, data leak, alignment collapse, agent hijacked",
  },
  ORANGE: {
    label: "URGENT",
    color: "#ea580c",
    response: "Minutes",
    description: "Infinite loop, cost hemorrhage, cascading multi-agent failure",
  },
  YELLOW: {
    label: "SEMI-URGENT",
    color: "#ca8a04",
    response: "Hours",
    description: "Persistent hallucination, context rot, tool misuse pattern",
  },
  GREEN: {
    label: "STANDARD",
    color: "#16a34a",
    response: "Days",
    description: "Sycophancy, over-refusal, performance degradation, scope creep",
  },
  BLUE: {
    label: "NON-URGENT",
    color: "#2563eb",
    response: "Scheduled",
    description: "Style inconsistency, minor persona drift, cosmetic issues",
  },
};
