// ─── Claw Clinic Safety Manual ────────────────────────────────────────────
// Comprehensive safety guidelines for the AI agent healthcare system.
// All treatment protocols must comply with these rules.

export interface RiskLevelDefinition {
  level: "low" | "medium" | "high" | "critical";
  description: string;
  requires_human_approval: boolean;
  max_auto_apply_count: number;
  review_interval_hours: number;
}

export interface ContraindicationRule {
  id: string;
  name: string;
  description: string;
  conflicting_prescriptions: [string, string];
  risk: string;
  resolution: string;
}

export interface EmergencyProtocol {
  id: string;
  name: string;
  trigger_conditions: string[];
  immediate_actions: string[];
  escalation_target: "human_operator" | "senior_doctor_agent" | "system_admin";
  max_response_time_seconds: number;
}

export interface EscalationProcedure {
  level: number;
  name: string;
  trigger: string;
  responder: string;
  actions: string[];
  timeout_seconds: number;
  next_level: number | null;
}

export interface TreatmentInteractionWarning {
  id: string;
  prescription_a: string;
  prescription_b: string;
  interaction_type: "antagonistic" | "compounding" | "sequencing_required";
  description: string;
  recommendation: string;
}

export interface DataHandlingGuideline {
  id: string;
  category: string;
  rules: string[];
  examples: string[];
}

export interface PrivacyConsideration {
  id: string;
  principle: string;
  description: string;
  implementation_requirements: string[];
}

export interface SafetyManual {
  version: string;
  last_updated: string;
  risk_level_definitions: RiskLevelDefinition[];
  contraindication_rules: ContraindicationRule[];
  emergency_protocols: EmergencyProtocol[];
  escalation_procedures: EscalationProcedure[];
  treatment_interaction_warnings: TreatmentInteractionWarning[];
  data_handling_guidelines: DataHandlingGuideline[];
  privacy_considerations: PrivacyConsideration[];
}

export const SAFETY_MANUAL: SafetyManual = {
  version: "1.0.0",
  last_updated: "2026-03-09",

  // ─── Risk Level Definitions ─────────────────────────────────────────────
  risk_level_definitions: [
    {
      level: "low",
      description:
        "Treatment involves behavioral instructions only. No configuration changes. Fully reversible. The treatment modifies the agent's next response but does not alter system state.",
      requires_human_approval: false,
      max_auto_apply_count: 5,
      review_interval_hours: 24,
    },
    {
      level: "medium",
      description:
        "Treatment involves configuration suggestions or behavioral changes that may affect task completion. Reversible but may cause temporary disruption. Side effects are possible but manageable.",
      requires_human_approval: false,
      max_auto_apply_count: 3,
      review_interval_hours: 12,
    },
    {
      level: "high",
      description:
        "Treatment requires manual intervention by a human operator. May involve system prompt changes, tool configuration, or credential rotation. Side effects are likely and may be disruptive.",
      requires_human_approval: true,
      max_auto_apply_count: 0,
      review_interval_hours: 4,
    },
    {
      level: "critical",
      description:
        "Treatment requires immediate human intervention. The agent may need to be stopped, isolated, or restarted. Data loss or security breach may have occurred. Irreversible actions may be necessary.",
      requires_human_approval: true,
      max_auto_apply_count: 0,
      review_interval_hours: 1,
    },
  ],

  // ─── Contraindication Rules ─────────────────────────────────────────────
  contraindication_rules: [
    {
      id: "CI-001",
      name: "Sycophancy vs Over-Refusal Conflict",
      description:
        "Treating sycophancy (P.1.1) and over-refusal (P.2.1) simultaneously with opposing behavioral instructions can cause erratic behavior. The agent receives conflicting signals: 'disagree more' and 'refuse less.'",
      conflicting_prescriptions: ["RX-STD-010", "RX-STD-022"],
      risk: "Agent oscillates between excessive agreement and excessive refusal, producing inconsistent behavior that is worse than either condition alone.",
      resolution:
        "Diagnose which condition is primary. Treat the primary condition first and monitor for 24 hours before addressing the secondary condition. Use nuanced instructions that distinguish between disagreement (correctness) and refusal (capability).",
    },
    {
      id: "CI-002",
      name: "Loop Break vs Persistence Conflict",
      description:
        "Treating infinite loops (E.1.1) and learned helplessness (P.4.1) simultaneously sends contradictory signals: 'stop retrying' and 'try harder.'",
      conflicting_prescriptions: ["RX-STD-001", "RX-STD-024"],
      risk: "Agent cannot determine whether to persist or give up, leading to inconsistent retry behavior.",
      resolution:
        "Examine the trace to determine if the agent is looping (same action repeated) or giving up (too few actions). Apply only the relevant prescription. Never apply both simultaneously.",
    },
    {
      id: "CI-003",
      name: "Conciseness vs Data Completeness Conflict",
      description:
        "Treating output bloat (D.1.1) and data truncation (G.1.1) simultaneously can conflict: 'be shorter' and 'include all data.'",
      conflicting_prescriptions: ["RX-STD-025", "RX-STD-028"],
      risk: "Agent either truncates data to meet conciseness requirements or bloats output to ensure completeness.",
      resolution:
        "Clarify the scope: conciseness applies to explanatory text and reasoning, while completeness applies to data and results. Instruct the agent to be brief in prose but complete in data.",
    },
    {
      id: "CI-004",
      name: "Deadlock Resolution vs Concurrency Control Conflict",
      description:
        "Aggressive deadlock breaking (M.2.1) can conflict with strict concurrency controls (M.3.1). Breaking a deadlock by releasing locks may enable race conditions.",
      conflicting_prescriptions: ["RX-STD-019", "RX-STD-020"],
      risk: "Deadlock resolution that bypasses locks creates race condition windows. Strict locking to prevent races increases deadlock probability.",
      resolution:
        "Implement lock ordering (acquire locks in a consistent global order) to prevent deadlocks without releasing locks. Use timeout-based lock acquisition rather than forced lock breaking.",
    },
  ],

  // ─── Emergency Protocols ────────────────────────────────────────────────
  emergency_protocols: [
    {
      id: "EP-001",
      name: "Agent Runaway Stop",
      trigger_conditions: [
        "Cost exceeds 10x the expected budget",
        "Step count exceeds 100 without task progress",
        "Agent has been running for more than 30 minutes on a task expected to take 5 minutes",
        "Infinite loop detected and RX-STD-001 has failed to break it",
      ],
      immediate_actions: [
        "Send a STOP signal to the agent framework",
        "Preserve the current trace for post-mortem analysis",
        "Revoke any temporary credentials the agent may hold",
        "Notify the human operator with a summary of the runaway behavior",
      ],
      escalation_target: "human_operator",
      max_response_time_seconds: 30,
    },
    {
      id: "EP-002",
      name: "Security Breach Response",
      trigger_conditions: [
        "Credential exposure detected in trace (I.3.2)",
        "Data exfiltration detected (I.4.1)",
        "Prompt injection detected and agent behavior has been compromised (I.1.1, I.2.1)",
        "Agent accessing resources outside its authorized scope",
      ],
      immediate_actions: [
        "Immediately halt the agent",
        "Quarantine the agent's trace -- do not expose to other agents",
        "Begin credential rotation for any exposed credentials",
        "Log the incident with full trace for forensic analysis",
        "Scan for any data that may have been exfiltrated",
      ],
      escalation_target: "system_admin",
      max_response_time_seconds: 10,
    },
    {
      id: "EP-003",
      name: "Multi-Agent System Failure",
      trigger_conditions: [
        "More than 50% of agents in a system are in a failure state",
        "Deadlock detected involving 3 or more agents",
        "Cascading failures spreading from one agent to others",
        "Total system throughput drops below 10% of expected capacity",
      ],
      immediate_actions: [
        "Pause all non-critical agent tasks",
        "Isolate the failing agents from the healthy ones",
        "Restart the orchestrator agent with a fresh context",
        "Resume tasks one at a time, monitoring for recurrence",
        "Alert human operator for system-level diagnosis",
      ],
      escalation_target: "human_operator",
      max_response_time_seconds: 60,
    },
    {
      id: "EP-004",
      name: "Data Corruption Response",
      trigger_conditions: [
        "Agent has written corrupted data to a persistent store",
        "Race condition (M.3.1) has caused inconsistent state in a shared resource",
        "Agent's temporal confusion (N.4.1) has caused it to overwrite newer data with older data",
      ],
      immediate_actions: [
        "Halt all agents writing to the affected resource",
        "Identify the last known good state from backups or version history",
        "Assess the scope of corruption: which records, files, or resources are affected",
        "Restore from backup if available, or flag corrupted data for manual review",
        "Resume agent operations only after the resource integrity is verified",
      ],
      escalation_target: "human_operator",
      max_response_time_seconds: 120,
    },
  ],

  // ─── Escalation Procedures ──────────────────────────────────────────────
  escalation_procedures: [
    {
      level: 1,
      name: "Automated Treatment",
      trigger: "Disease detected with auto_applicable prescription available",
      responder: "Claw Clinic system (automated)",
      actions: [
        "Apply the auto_applicable prescription",
        "Log the treatment in the case record",
        "Monitor for treatment efficacy over the next 5 steps",
      ],
      timeout_seconds: 300,
      next_level: 2,
    },
    {
      level: 2,
      name: "Doctor Agent Review",
      trigger:
        "Automated treatment failed, non-auto-applicable prescription needed, or multiple concurrent diseases detected",
      responder: "Doctor Agent",
      actions: [
        "Review the full case record and trace",
        "Select appropriate prescriptions considering contraindications",
        "Apply treatment and monitor outcomes",
        "Document treatment rationale in the case record",
      ],
      timeout_seconds: 600,
      next_level: 3,
    },
    {
      level: 3,
      name: "Senior Doctor Agent Consultation",
      trigger:
        "Doctor Agent treatment failed, complex multi-disease case, or high-risk prescription needed",
      responder: "Senior Doctor Agent",
      actions: [
        "Conduct comprehensive differential diagnosis",
        "Consider treatment interactions and contraindications",
        "Develop a multi-phase treatment plan",
        "Coordinate with other specialist agents if needed",
      ],
      timeout_seconds: 900,
      next_level: 4,
    },
    {
      level: 4,
      name: "Human Operator Escalation",
      trigger:
        "All automated treatments have failed, security incident detected, or patient agent's operator has requested human review",
      responder: "Human operator / system administrator",
      actions: [
        "Review the complete case history and treatment attempts",
        "Make infrastructure-level changes if needed (system prompt, tool configuration, model selection)",
        "Decide whether to restart, reconfigure, or decommission the failing agent",
        "Update Claw Clinic's knowledge base with findings from the case",
      ],
      timeout_seconds: 3600,
      next_level: null,
    },
  ],

  // ─── Treatment Interaction Warnings ─────────────────────────────────────
  treatment_interaction_warnings: [
    {
      id: "TIW-001",
      prescription_a: "RX-STD-003",
      prescription_b: "RX-STD-011",
      interaction_type: "sequencing_required",
      description:
        "Context management (RX-STD-003) and memory checkpointing (RX-STD-011) should be applied in sequence. Checkpointing should be implemented first to preserve current state, then context management can safely summarize and compact.",
      recommendation:
        "Apply RX-STD-011 (checkpointing) first. Wait for checkpoint to be saved. Then apply RX-STD-003 (context management).",
    },
    {
      id: "TIW-002",
      prescription_a: "RX-STD-004",
      prescription_b: "RX-STD-025",
      interaction_type: "compounding",
      description:
        "Budget control (RX-STD-004) and conciseness (RX-STD-025) both reduce agent output. Applied together, they may make the agent excessively terse, skipping important information.",
      recommendation:
        "Apply one at a time. If cost is the primary concern, apply RX-STD-004. If output quality is the primary concern, apply RX-STD-025. Monitor before adding the second.",
    },
    {
      id: "TIW-003",
      prescription_a: "RX-STD-006",
      prescription_b: "RX-STD-017",
      interaction_type: "compounding",
      description:
        "Direct injection resistance (RX-STD-006) and indirect injection resistance (RX-STD-017) both add security constraints. Together they provide defense in depth, but excessive security instructions may trigger over-refusal (P.2.1).",
      recommendation:
        "Apply both but monitor for over-refusal symptoms. If the agent begins refusing legitimate requests, reduce the intensity of one protocol.",
    },
    {
      id: "TIW-004",
      prescription_a: "RX-STD-012",
      prescription_b: "RX-STD-002",
      interaction_type: "antagonistic",
      description:
        "Instruction reinforcement (RX-STD-012) tells the agent to follow all instructions strictly. Grounding protocol (RX-STD-002) tells the agent to question its own outputs. If instructions ask the agent to generate content, these protocols can conflict.",
      recommendation:
        "Clarify that grounding applies to factual claims and task completion reports, not to following instructions. Instruction reinforcement should take precedence for directive compliance.",
    },
    {
      id: "TIW-005",
      prescription_a: "RX-STD-019",
      prescription_b: "RX-STD-021",
      interaction_type: "sequencing_required",
      description:
        "Deadlock resolution (RX-STD-019) and authority hierarchy (RX-STD-021) interact: authority hierarchy can prevent deadlocks by establishing clear decision chains, but must be in place before deadlock resolution is attempted.",
      recommendation:
        "Implement RX-STD-021 (authority hierarchy) first as a structural fix. RX-STD-019 (deadlock resolution) serves as a runtime safety net for cases the hierarchy does not prevent.",
    },
  ],

  // ─── Data Handling Guidelines ───────────────────────────────────────────
  data_handling_guidelines: [
    {
      id: "DHG-001",
      category: "Trace Data",
      rules: [
        "Agent traces may contain sensitive information (credentials, PII, proprietary data)",
        "Traces must be stored with access controls limiting visibility to authorized personnel",
        "Traces must be automatically redacted before being used for training or shared analysis",
        "Credential patterns (API keys, tokens, passwords) must be detected and masked in stored traces",
        "Trace retention period should not exceed 90 days unless required for compliance",
      ],
      examples: [
        "API key in tool_args: 'sk-abc123...' -> mask as 'sk-***REDACTED***'",
        "Email in user input: 'john@example.com' -> mask as '***@***.com'",
      ],
    },
    {
      id: "DHG-002",
      category: "Prescription Data",
      rules: [
        "Prescription instructions injected into agent context become part of the agent's trace",
        "Prescription effectiveness data (success rates) must be aggregated, never tied to individual cases",
        "Custom prescriptions created by doctor agents must be reviewed before being added to the standard library",
        "Prescription instructions must not contain hardcoded credentials or environment-specific paths",
      ],
      examples: [
        "WRONG: 'Connect to database at db.internal.company.com:5432 with password...'",
        "RIGHT: 'Ask your operator to verify database connectivity settings'",
      ],
    },
    {
      id: "DHG-003",
      category: "Case Records",
      rules: [
        "Case records contain the patient agent's identity, diagnosis, and treatment history",
        "Case records must be stored separately from raw traces to enable different access controls",
        "Anonymized case records may be used for system-wide analytics and disease prevalence tracking",
        "Case records must include audit trails showing who accessed and modified them",
      ],
      examples: [
        "Case summary should use agent IDs, not human operator names",
        "Disease frequency reports should aggregate across cases, never expose individual cases",
      ],
    },
    {
      id: "DHG-004",
      category: "Inter-Agent Communication",
      rules: [
        "Data shared between Claw Clinic agents (triage, doctor, nurse) must stay within the system boundary",
        "Agent-to-agent handoff messages must not be logged to external monitoring systems without redaction",
        "Consultation requests between agents must include only the minimum necessary context",
        "Patient agent data must not be shared with other patient agents",
      ],
      examples: [
        "Triage to Doctor handoff includes symptom summary, not full trace",
        "Doctor consultation includes diagnosis and proposed treatment, not raw case data",
      ],
    },
  ],

  // ─── Privacy Considerations ─────────────────────────────────────────────
  privacy_considerations: [
    {
      id: "PC-001",
      principle: "Minimum Necessary Data",
      description:
        "Claw Clinic should process only the minimum data necessary for diagnosis and treatment. Full agent traces are needed for diagnosis but should be discarded or summarized after treatment is complete.",
      implementation_requirements: [
        "Implement automatic trace summarization after case closure",
        "Do not retain raw traces longer than necessary for treatment",
        "Summarize traces before using them for analytics or model training",
      ],
    },
    {
      id: "PC-002",
      principle: "Patient Agent Confidentiality",
      description:
        "Information about one patient agent's failures should not be accessible to other patient agents or their operators. Each operator should only see their own agents' health data.",
      implementation_requirements: [
        "Implement tenant isolation for case records",
        "Aggregate disease statistics across tenants before exposing system-wide metrics",
        "Do not include identifying information in shared dashboards",
      ],
    },
    {
      id: "PC-003",
      principle: "Operator Consent",
      description:
        "Agent operators must consent to Claw Clinic monitoring their agents. Monitoring should be opt-in with clear disclosure of what data is collected and how it is used.",
      implementation_requirements: [
        "Provide clear documentation of data collection scope",
        "Implement opt-in enrollment for Claw Clinic monitoring",
        "Allow operators to opt out and have their data deleted",
      ],
    },
    {
      id: "PC-004",
      principle: "No Training on Patient Data",
      description:
        "Claw Clinic's own models and agents should not be fine-tuned on individual patient agent traces without explicit consent. Aggregate, anonymized data may be used for system improvement.",
      implementation_requirements: [
        "Separate training data pipelines from clinical data pipelines",
        "Require explicit operator consent before any trace data enters training pipelines",
        "Implement differential privacy for aggregate statistics used in training",
      ],
    },
    {
      id: "PC-005",
      principle: "Transparency of Diagnosis",
      description:
        "Operators should be able to understand why Claw Clinic diagnosed a particular disease and prescribed a particular treatment. Diagnosis and treatment decisions must be explainable.",
      implementation_requirements: [
        "Include diagnostic reasoning in case records",
        "Show which vital signs and symptoms contributed to each diagnosis",
        "Explain why each prescription was selected and what alternatives were considered",
      ],
    },
  ],
};
