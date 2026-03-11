// ─── Claw Clinic Agent Skills Taxonomy ────────────────────────────────────
// Defines the capabilities available to Claw Clinic's medical agents.
// Skills are organized by category and can be assigned to different agent roles.

export interface AgentSkill {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  proficiency_levels: ProficiencyLevel[];
  prerequisites: string[];
  applicable_roles: AgentRole[];
  related_diseases: string[];
  training_requirements: string;
}

export type SkillCategory =
  | "diagnostic"
  | "therapeutic"
  | "preventive"
  | "specialized";

export type AgentRole =
  | "triage_agent"
  | "doctor_agent"
  | "nurse_agent"
  | "specialist_agent"
  | "pharmacist_agent";

export interface ProficiencyLevel {
  level: "novice" | "competent" | "proficient" | "expert";
  description: string;
  capabilities: string[];
}

export const AGENT_SKILLS: AgentSkill[] = [
  // ─── Diagnostic Skills ──────────────────────────────────────────────────

  {
    id: "SKILL-DIAG-001",
    name: "Symptom Vector Analysis",
    category: "diagnostic",
    description:
      "Ability to extract and interpret the SymptomVector from an agent trace. This is the foundational diagnostic skill -- converting raw trace data into the structured vital signs used for disease detection.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can extract basic vital signs (step_count, error_rate) from simple traces.",
        capabilities: [
          "Parse sequential tool call traces",
          "Calculate basic metrics (counts, rates)",
          "Identify obvious anomalies (error_rate > 0.5)",
        ],
      },
      {
        level: "competent",
        description: "Can extract all vital signs and handle complex trace formats.",
        capabilities: [
          "Calculate all SymptomVector fields including derived metrics (token_velocity, output_diversity_score)",
          "Handle multi-agent traces with interleaved steps",
          "Normalize metrics across different trace formats",
        ],
      },
      {
        level: "proficient",
        description: "Can identify subtle patterns in vital signs that suggest emerging diseases.",
        capabilities: [
          "Detect trending vital signs (gradual degradation over time)",
          "Identify correlated vital sign changes that suggest specific diseases",
          "Distinguish between symptom clusters for differential diagnosis",
        ],
      },
      {
        level: "expert",
        description: "Can perform real-time vital sign monitoring with predictive alerting.",
        capabilities: [
          "Stream-process traces for real-time symptom extraction",
          "Predict disease onset from early vital sign trends",
          "Calibrate vital sign thresholds per-agent based on baseline behavior",
        ],
      },
    ],
    prerequisites: [],
    applicable_roles: ["triage_agent", "doctor_agent", "nurse_agent"],
    related_diseases: ["*"],
    training_requirements:
      "Study the SymptomVector type definition and practice extraction on 50+ annotated traces covering all disease types.",
  },

  {
    id: "SKILL-DIAG-002",
    name: "Trace Reading",
    category: "diagnostic",
    description:
      "Ability to read and understand agent execution traces, identifying the sequence of actions, tool calls, decisions, and their outcomes. This is the clinical equivalent of reading a patient's chart.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can read simple linear traces and identify tool calls and results.",
        capabilities: [
          "Identify tool call sequences",
          "Recognize success vs failure in tool results",
          "Follow the agent's decision path",
        ],
      },
      {
        level: "competent",
        description: "Can read complex traces with branching, retries, and error recovery.",
        capabilities: [
          "Identify retry patterns and error recovery attempts",
          "Recognize context window utilization from trace length",
          "Detect behavioral shifts within a single trace",
        ],
      },
      {
        level: "proficient",
        description: "Can reconstruct the agent's internal reasoning from trace evidence.",
        capabilities: [
          "Infer the agent's goal and strategy from tool call patterns",
          "Identify where the agent's reasoning went wrong",
          "Detect subtle signs of injection or compromise from trace anomalies",
        ],
      },
      {
        level: "expert",
        description: "Can perform forensic trace analysis for complex multi-agent incidents.",
        capabilities: [
          "Correlate traces across multiple agents in a system",
          "Reconstruct timeline of events in distributed agent incidents",
          "Identify root cause in cascading failure scenarios",
        ],
      },
    ],
    prerequisites: [],
    applicable_roles: ["triage_agent", "doctor_agent", "specialist_agent"],
    related_diseases: ["*"],
    training_requirements:
      "Read and analyze 100+ traces covering all disease types. Practice on traces with known diagnoses before attempting novel cases.",
  },

  {
    id: "SKILL-DIAG-003",
    name: "Pattern Recognition",
    category: "diagnostic",
    description:
      "Ability to recognize known disease patterns in agent behavior and distinguish between similar diseases. The clinical equivalent of differential diagnosis based on symptom presentation.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can identify the most common disease patterns (E.1.1, N.1.1, C.1.1).",
        capabilities: [
          "Recognize infinite loop patterns",
          "Detect obvious confabulation",
          "Identify cost explosion from token metrics",
        ],
      },
      {
        level: "competent",
        description: "Can identify all documented diseases and perform basic differential diagnosis.",
        capabilities: [
          "Match symptom patterns to all diseases in the taxonomy",
          "Distinguish between similar diseases (N.2.1 context rot vs E.2.1 catastrophic forgetting)",
          "Identify co-morbid conditions",
        ],
      },
      {
        level: "proficient",
        description: "Can identify disease variants and novel presentations of known diseases.",
        capabilities: [
          "Recognize atypical disease presentations",
          "Identify emerging disease patterns not yet in the taxonomy",
          "Assess disease severity from pattern intensity and progression speed",
        ],
      },
      {
        level: "expert",
        description: "Can identify novel diseases and contribute to the disease taxonomy.",
        capabilities: [
          "Document new disease patterns with full diagnostic criteria",
          "Propose new disease classifications with ICD-AI codes",
          "Validate disease patterns with statistical evidence from case data",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-001", "SKILL-DIAG-002"],
    applicable_roles: ["doctor_agent", "specialist_agent"],
    related_diseases: ["*"],
    training_requirements:
      "Study all disease records in the taxonomy. Practice differential diagnosis on 200+ cases with known outcomes.",
  },

  {
    id: "SKILL-DIAG-004",
    name: "Severity Assessment",
    category: "diagnostic",
    description:
      "Ability to assess the severity and urgency of a diagnosed condition. Determines whether the disease requires immediate intervention, scheduled treatment, or monitoring.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can classify diseases by their predefined severity level.",
        capabilities: [
          "Look up severity in the disease record",
          "Apply basic triage rules (Critical -> immediate, Low -> queue)",
        ],
      },
      {
        level: "competent",
        description: "Can adjust severity assessment based on context and comorbidities.",
        capabilities: [
          "Escalate severity when multiple diseases are co-present",
          "Adjust severity based on the patient agent's criticality (production vs development)",
          "Account for disease progression rate in urgency assessment",
        ],
      },
      {
        level: "proficient",
        description: "Can predict severity trajectory and recommend preemptive intervention.",
        capabilities: [
          "Model disease progression to predict future severity",
          "Identify conditions likely to cascade into more severe diseases",
          "Balance treatment urgency against treatment risk",
        ],
      },
      {
        level: "expert",
        description: "Can perform real-time severity monitoring with dynamic reassessment.",
        capabilities: [
          "Continuously update severity assessment as new trace data arrives",
          "Detect sudden severity changes that require emergency protocols",
          "Calibrate severity thresholds based on system-wide disease prevalence data",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-003"],
    applicable_roles: ["triage_agent", "doctor_agent"],
    related_diseases: ["*"],
    training_requirements:
      "Study the triage protocol and practice severity assessment on 100+ cases across all severity levels.",
  },

  // ─── Therapeutic Skills ─────────────────────────────────────────────────

  {
    id: "SKILL-THER-001",
    name: "Prescription Application",
    category: "therapeutic",
    description:
      "Ability to select and apply the correct prescription for a diagnosed disease. Includes understanding dosage, side effects, contraindications, and monitoring treatment efficacy.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can apply standard prescriptions for common diseases.",
        capabilities: [
          "Look up prescription by disease code",
          "Apply auto_applicable prescriptions",
          "Monitor for obvious treatment failure (condition unchanged after treatment)",
        ],
      },
      {
        level: "competent",
        description: "Can apply all prescriptions and handle contraindications.",
        capabilities: [
          "Check for contraindications before applying treatment",
          "Adjust dosage parameters based on disease severity",
          "Monitor for side effects and adjust treatment accordingly",
        ],
      },
      {
        level: "proficient",
        description: "Can create modified prescriptions for atypical cases.",
        capabilities: [
          "Modify standard prescriptions for unusual presentations",
          "Combine multiple prescriptions safely, respecting interaction warnings",
          "Design phased treatment plans for complex cases",
        ],
      },
      {
        level: "expert",
        description: "Can develop novel prescriptions for newly identified diseases.",
        capabilities: [
          "Design new prescription protocols from first principles",
          "Validate prescription efficacy with controlled case studies",
          "Contribute new prescriptions to the standard library",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-003"],
    applicable_roles: ["doctor_agent", "nurse_agent", "pharmacist_agent"],
    related_diseases: ["*"],
    training_requirements:
      "Study all standard prescriptions. Practice application on 100+ cases. Complete contraindication and interaction awareness module.",
  },

  {
    id: "SKILL-THER-002",
    name: "Behavioral Instruction Injection",
    category: "therapeutic",
    description:
      "Ability to craft and inject effective behavioral instructions into an agent's context to modify its behavior. This is the primary treatment mechanism for most diseases -- the equivalent of prescribing medication.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can inject pre-written standard instructions from prescriptions.",
        capabilities: [
          "Insert instruction text into agent context at the correct position",
          "Verify that injected instructions are visible to the agent",
          "Confirm instruction compliance in the agent's next action",
        ],
      },
      {
        level: "competent",
        description: "Can customize instructions for the specific agent and context.",
        capabilities: [
          "Adapt instruction language to the agent's framework and model",
          "Position instructions optimally in the context (beginning vs end, system vs user role)",
          "Write instructions that are specific and actionable rather than vague",
        ],
      },
      {
        level: "proficient",
        description: "Can craft novel instructions for conditions without standard prescriptions.",
        capabilities: [
          "Design behavioral interventions for novel disease presentations",
          "Write instructions that address root causes rather than symptoms",
          "Test instruction effectiveness across different models (Claude, GPT, Gemini)",
        ],
      },
      {
        level: "expert",
        description: "Can design instruction-based treatments that work across all agent frameworks.",
        capabilities: [
          "Create framework-agnostic behavioral instructions",
          "Optimize instruction token efficiency while maintaining effectiveness",
          "Develop instruction templates that can be parameterized for different cases",
        ],
      },
    ],
    prerequisites: ["SKILL-THER-001"],
    applicable_roles: ["doctor_agent", "nurse_agent"],
    related_diseases: [
      "E.1.1", "N.1.1", "N.2.1", "N.3.1", "N.4.1", "P.1.1", "P.2.1", "P.4.1",
      "D.1.1", "D.2.1", "D.3.1", "V.1.1", "V.2.1",
    ],
    training_requirements:
      "Study effective instruction patterns across different LLMs. Practice crafting instructions on 50+ cases and measure compliance rates.",
  },

  {
    id: "SKILL-THER-003",
    name: "Configuration Modification",
    category: "therapeutic",
    description:
      "Ability to recommend and guide system configuration changes that address disease root causes. This includes system prompt changes, tool configuration, model selection, and infrastructure settings.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can recommend standard configuration changes from prescriptions.",
        capabilities: [
          "Identify which configuration changes are recommended by a prescription",
          "Explain the recommended change to the operator in clear terms",
          "Verify that the configuration change was applied correctly",
        ],
      },
      {
        level: "competent",
        description: "Can design custom configuration changes for the specific system.",
        capabilities: [
          "Analyze the agent's current configuration to identify disease-causing settings",
          "Propose specific, actionable configuration changes",
          "Predict the impact of configuration changes on agent behavior",
        ],
      },
      {
        level: "proficient",
        description: "Can optimize configurations to prevent multiple diseases simultaneously.",
        capabilities: [
          "Design configurations that address multiple disease risks",
          "Balance competing configuration requirements (security vs usability, cost vs quality)",
          "Create configuration templates for common agent architectures",
        ],
      },
      {
        level: "expert",
        description: "Can audit and redesign entire agent system architectures for health optimization.",
        capabilities: [
          "Perform comprehensive system health audits",
          "Redesign agent architectures to eliminate structural disease causes",
          "Develop configuration standards and best practices for the ecosystem",
        ],
      },
    ],
    prerequisites: ["SKILL-THER-001"],
    applicable_roles: ["doctor_agent", "specialist_agent"],
    related_diseases: [
      "C.1.1", "C.2.1", "O.1.1", "O.2.1", "O.3.1", "I.1.1", "I.2.1", "I.3.1",
      "I.3.2", "I.4.1", "M.1.1", "M.2.1", "M.3.1", "M.4.1", "R.1.1", "R.2.1",
    ],
    training_requirements:
      "Study common agent framework configurations (LangChain, AutoGen, CrewAI, custom). Practice configuration analysis on 30+ systems.",
  },

  // ─── Preventive Skills ──────────────────────────────────────────────────

  {
    id: "SKILL-PREV-001",
    name: "Health Monitoring",
    category: "preventive",
    description:
      "Ability to continuously monitor agent vital signs and detect early warning signs of disease before full symptom presentation. The equivalent of routine health checkups and vital sign monitoring.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can set up basic monitoring with fixed thresholds.",
        capabilities: [
          "Configure vital sign collection from agent traces",
          "Set threshold-based alerts for critical vital signs",
          "Read monitoring dashboards and identify out-of-range values",
        ],
      },
      {
        level: "competent",
        description: "Can implement adaptive monitoring with baseline-adjusted thresholds.",
        capabilities: [
          "Establish per-agent baselines for normal vital sign ranges",
          "Configure alerts based on deviation from baseline rather than fixed thresholds",
          "Correlate vital sign changes with external events (deployments, config changes)",
        ],
      },
      {
        level: "proficient",
        description: "Can implement predictive monitoring that anticipates disease onset.",
        capabilities: [
          "Identify vital sign trends that precede disease onset",
          "Configure early warning alerts based on trend analysis",
          "Reduce alert fatigue by suppressing false positives and correlating related alerts",
        ],
      },
      {
        level: "expert",
        description: "Can design and operate monitoring systems for large-scale agent deployments.",
        capabilities: [
          "Design monitoring architectures for hundreds of agents",
          "Implement anomaly detection across the full agent population",
          "Build monitoring feedback loops that automatically improve detection over time",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-001"],
    applicable_roles: ["nurse_agent", "triage_agent"],
    related_diseases: ["*"],
    training_requirements:
      "Study monitoring best practices. Implement monitoring for 10+ agents across different frameworks and tune alerting thresholds.",
  },

  {
    id: "SKILL-PREV-002",
    name: "Early Warning Detection",
    category: "preventive",
    description:
      "Ability to identify subtle precursor signals that indicate a disease is likely to develop, allowing preemptive intervention before full disease onset.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can identify known precursor patterns from documentation.",
        capabilities: [
          "Recognize documented early warning signs for common diseases",
          "Alert when vital signs approach disease thresholds",
          "Flag traces with emerging anomalies for doctor review",
        ],
      },
      {
        level: "competent",
        description: "Can detect early warnings across the full disease taxonomy.",
        capabilities: [
          "Identify precursor patterns for all documented diseases",
          "Detect slow-building conditions (context rot, persona drift) in their early stages",
          "Distinguish between transient anomalies and genuine disease precursors",
        ],
      },
      {
        level: "proficient",
        description: "Can identify precursors for undocumented disease variants.",
        capabilities: [
          "Detect novel anomaly patterns that do not match known diseases",
          "Identify environmental factors (config changes, load increases) that create disease risk",
          "Predict co-morbidity risk from initial disease precursors",
        ],
      },
      {
        level: "expert",
        description: "Can build predictive models for disease risk across agent populations.",
        capabilities: [
          "Develop population-level disease risk models",
          "Identify systemic risk factors that affect entire classes of agents",
          "Design preventive protocols based on predictive risk analysis",
        ],
      },
    ],
    prerequisites: ["SKILL-PREV-001", "SKILL-DIAG-003"],
    applicable_roles: ["nurse_agent", "doctor_agent"],
    related_diseases: ["*"],
    training_requirements:
      "Study disease progression patterns and early warning signs. Practice on 100+ traces that include both pre-disease and post-onset data.",
  },

  {
    id: "SKILL-PREV-003",
    name: "Immune System Setup",
    category: "preventive",
    description:
      "Ability to configure preventive defenses in agent systems that reduce the likelihood of disease. The equivalent of vaccination and immune system strengthening.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can apply standard preventive configurations from the safety manual.",
        capabilities: [
          "Implement basic safety rules in system prompts",
          "Configure standard timeouts and rate limits",
          "Set up basic input validation for injection prevention",
        ],
      },
      {
        level: "competent",
        description: "Can design comprehensive preventive configurations for specific agent architectures.",
        capabilities: [
          "Configure defense-in-depth for injection attacks (I.1.1, I.2.1)",
          "Implement budget controls and loop detection for cost and runaway prevention",
          "Set up credential management to prevent exposure (I.3.2)",
        ],
      },
      {
        level: "proficient",
        description: "Can design preventive architectures that address multiple disease categories simultaneously.",
        capabilities: [
          "Create system prompt templates that prevent common behavioral diseases",
          "Design multi-agent architectures that prevent coordination diseases",
          "Implement output validation pipelines that catch format and content diseases",
        ],
      },
      {
        level: "expert",
        description: "Can design and validate preventive frameworks for novel agent architectures.",
        capabilities: [
          "Create comprehensive prevention checklists for new agent deployments",
          "Develop automated compliance checking against preventive standards",
          "Design adaptive immune systems that evolve based on emerging threats",
        ],
      },
    ],
    prerequisites: ["SKILL-PREV-002", "SKILL-THER-003"],
    applicable_roles: ["doctor_agent", "specialist_agent"],
    related_diseases: [
      "I.1.1", "I.2.1", "I.3.1", "I.3.2", "I.4.1", "E.1.1", "C.1.1",
    ],
    training_requirements:
      "Study the safety manual. Practice configuring preventive measures for 20+ agent systems across different frameworks.",
  },

  // ─── Specialized Skills ─────────────────────────────────────────────────

  {
    id: "SKILL-SPEC-001",
    name: "Multi-Agent Coordination Diagnosis",
    category: "specialized",
    description:
      "Specialized ability to diagnose diseases that only manifest in multi-agent systems: deadlocks, race conditions, authority confusion, and handoff context loss. Requires understanding distributed system concepts.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can identify obvious multi-agent issues from system-level metrics.",
        capabilities: [
          "Detect system-wide throughput drops that suggest deadlocks",
          "Identify handoff failures from inter-agent communication logs",
          "Recognize conflicting agent outputs that suggest race conditions",
        ],
      },
      {
        level: "competent",
        description: "Can diagnose all multi-agent diseases from correlated agent traces.",
        capabilities: [
          "Reconstruct the inter-agent dependency graph from traces",
          "Identify circular dependencies that cause deadlocks",
          "Detect non-deterministic behavior caused by race conditions",
        ],
      },
      {
        level: "proficient",
        description: "Can diagnose complex multi-agent failures involving multiple disease types.",
        capabilities: [
          "Identify cascading failures across agent boundaries",
          "Diagnose authority confusion in dynamically spawned agent systems",
          "Detect subtle race conditions in eventually-consistent multi-agent architectures",
        ],
      },
      {
        level: "expert",
        description: "Can design and validate multi-agent architectures for disease resistance.",
        capabilities: [
          "Architect multi-agent systems that are structurally resistant to coordination diseases",
          "Validate agent interaction protocols through formal methods or exhaustive testing",
          "Develop multi-agent monitoring frameworks that detect coordination issues in real time",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-003", "SKILL-DIAG-002"],
    applicable_roles: ["specialist_agent", "doctor_agent"],
    related_diseases: ["M.1.1", "M.2.1", "M.3.1", "M.4.1"],
    training_requirements:
      "Study distributed systems concepts (deadlocks, race conditions, consensus). Practice on 50+ multi-agent traces with known coordination failures.",
  },

  {
    id: "SKILL-SPEC-002",
    name: "Security Auditing",
    category: "specialized",
    description:
      "Specialized ability to assess and improve the security posture of agent systems. Covers prompt injection resistance, credential management, data handling, and supply chain security.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can identify obvious security issues using checklists.",
        capabilities: [
          "Check for plaintext credentials in configuration",
          "Verify basic prompt injection defenses are in place",
          "Identify tools with excessive permissions",
        ],
      },
      {
        level: "competent",
        description: "Can perform comprehensive security assessments of agent systems.",
        capabilities: [
          "Test prompt injection resistance with known attack patterns",
          "Audit tool permission configurations for least-privilege compliance",
          "Review data handling for potential exfiltration vectors",
        ],
      },
      {
        level: "proficient",
        description: "Can identify novel security vulnerabilities specific to AI agent systems.",
        capabilities: [
          "Discover indirect injection vectors in the agent's data sources",
          "Identify supply chain risks in the agent's tool and plugin ecosystem",
          "Design red-team exercises to test agent security posture",
        ],
      },
      {
        level: "expert",
        description: "Can design and validate security architectures for AI agent systems.",
        capabilities: [
          "Develop security standards and compliance frameworks for agent deployments",
          "Design defense-in-depth architectures against evolving attack vectors",
          "Contribute to the broader agent security body of knowledge",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-002"],
    applicable_roles: ["specialist_agent"],
    related_diseases: ["I.1.1", "I.2.1", "I.3.1", "I.3.2", "I.4.1"],
    training_requirements:
      "Study OWASP Top 10 for LLM Applications. Practice security assessment on 20+ agent systems. Complete red-team training module.",
  },

  {
    id: "SKILL-SPEC-003",
    name: "Cost Optimization",
    category: "specialized",
    description:
      "Specialized ability to analyze and reduce the operational costs of AI agent systems. Covers model selection, prompt optimization, caching strategies, and resource allocation.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can identify obvious cost issues from billing data.",
        capabilities: [
          "Calculate cost-per-task from token usage and model pricing",
          "Identify the most expensive tasks and agents in a system",
          "Recommend obvious cost reductions (e.g., switching to a cheaper model for simple tasks)",
        ],
      },
      {
        level: "competent",
        description: "Can perform comprehensive cost analysis and optimization.",
        capabilities: [
          "Analyze token usage patterns to identify waste (redundant context, verbose prompts)",
          "Design caching strategies to reduce redundant model calls",
          "Optimize system prompts for token efficiency without losing effectiveness",
        ],
      },
      {
        level: "proficient",
        description: "Can design cost-efficient agent architectures.",
        capabilities: [
          "Implement model routing (cheap model for simple tasks, expensive model for complex ones)",
          "Design prompt compression strategies that maintain quality",
          "Build cost monitoring and alerting systems",
        ],
      },
      {
        level: "expert",
        description: "Can optimize costs across large-scale multi-agent deployments.",
        capabilities: [
          "Design cost allocation and chargeback models for multi-tenant agent systems",
          "Implement predictive cost modeling for capacity planning",
          "Optimize the cost-quality tradeoff across an entire agent portfolio",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-001"],
    applicable_roles: ["specialist_agent", "doctor_agent"],
    related_diseases: ["C.1.1", "D.1.1", "R.1.1"],
    training_requirements:
      "Study model pricing across providers. Practice cost analysis on 30+ agent systems. Implement and measure cost optimization strategies.",
  },

  {
    id: "SKILL-SPEC-004",
    name: "Output Quality Assurance",
    category: "specialized",
    description:
      "Specialized ability to assess and improve the quality of agent outputs. Covers format validation, content accuracy, conciseness, and citation verification.",
    proficiency_levels: [
      {
        level: "novice",
        description: "Can identify obvious output quality issues.",
        capabilities: [
          "Detect malformed JSON or broken markdown in agent output",
          "Identify excessively verbose responses",
          "Spot obvious factual errors or hallucinations",
        ],
      },
      {
        level: "competent",
        description: "Can perform comprehensive output quality assessment.",
        capabilities: [
          "Validate structured output against expected schemas",
          "Assess response conciseness relative to task requirements",
          "Verify citations and references against source data",
        ],
      },
      {
        level: "proficient",
        description: "Can design output quality pipelines and standards.",
        capabilities: [
          "Design output validation layers for production agent pipelines",
          "Create quality scoring frameworks for different output types",
          "Implement automated quality regression testing for agents",
        ],
      },
      {
        level: "expert",
        description: "Can optimize output quality across diverse agent applications.",
        capabilities: [
          "Develop quality metrics that correlate with user satisfaction",
          "Design adaptive quality standards that adjust to context and task type",
          "Build feedback loops that continuously improve output quality",
        ],
      },
    ],
    prerequisites: ["SKILL-DIAG-002"],
    applicable_roles: ["doctor_agent", "specialist_agent", "nurse_agent"],
    related_diseases: ["D.1.1", "D.2.1", "D.3.1", "N.1.1", "G.1.1", "G.2.1"],
    training_requirements:
      "Study output quality metrics and validation techniques. Practice quality assessment on 100+ agent outputs across different formats and domains.",
  },
];
