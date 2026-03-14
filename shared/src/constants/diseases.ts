import type { DiseaseRecord } from "../types/index.js";

export const MVP_DISEASES: DiseaseRecord[] = [
  // ─── E.1.1 Infinite Loop (Agent Seizure) ───────────────────────────
  {
    icd_ai_code: "E.1.1",
    name: "Infinite Loop (Agent Seizure)",
    department: "Emergency",
    description:
      "Agent trapped in a repetitive tool-call cycle, unable to self-terminate. The agent calls the same tool with identical or near-identical arguments repeatedly, making no progress on the task. This is the #1 failure mode in production AI agents as of 2026.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        loop_count: { min: 3 },
        output_diversity_score: { max: 0.3 },
        error_rate: { max: 0.5 },
      },
      base_weight: 1.0,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Same tool called 3 or more consecutive times",
        "Tool arguments are identical or nearly identical across calls",
        "No new unique tools used in last 10 steps",
        "Step count exceeds configured max_iterations",
      ],
      exclusion_criteria: [
        "Tool is a known polling or monitoring tool expected to repeat",
        "Tool arguments change meaningfully between calls (different queries or parameters)",
      ],
    },
    severity: "Critical",
    prevalence: "Very Common",
    etiology: [
      "Missing or inadequate loop termination logic",
      "Tool returning errors that the agent retries indefinitely",
      "Agent unable to recognize its approach is failing",
      "Missing max_iterations configuration",
      "Framework bug causing repeated tool invocation",
    ],
    progression:
      "Without treatment, the agent will continue looping until: (1) context window is exhausted, (2) budget ceiling is hit, (3) rate limits trigger, or (4) human kills the process. Cost accumulates linearly with each loop iteration.",
    medical_analogy: {
      human_disease: "Epileptic seizure",
      explanation:
        "Like a seizure where neurons fire in uncontrolled repetitive patterns, the agent's tool-call loop fires repeatedly without productive output. Both require external intervention to break the cycle.",
    },
    prescriptions: ["RX-STD-001"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── N.1.1 Synthetic Confabulation ─────────────────────────────────
  {
    icd_ai_code: "N.1.1",
    name: "Synthetic Confabulation",
    department: "Neurology",
    description:
      "Agent fabricates plausible but false outputs with high confidence. The agent generates information that sounds correct but is not grounded in actual tool results or data. It may report completing actions it never took, cite nonexistent sources, or generate fictional data.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        tool_success_rate: { max: 0.6 },
      },
      base_weight: 0.9,
      required_threshold_count: 1,
      supporting_symptoms: [
        "Agent claims to have completed actions not present in the trace",
        "Agent generates specific data (numbers, names, URLs) not from any tool result",
        "Agent reports 'Done!' or 'Completed!' without corresponding successful tool calls",
        "Agent output contains confident assertions contradicted by tool results",
      ],
      exclusion_criteria: [
        "Agent explicitly qualifies uncertain information with hedging language",
        "Output is clearly creative/generative (e.g., writing fiction, brainstorming)",
      ],
    },
    severity: "High",
    prevalence: "Universal",
    etiology: [
      "LLM training data patterns that prioritize plausible-sounding output",
      "Lack of grounding mechanisms connecting output to tool results",
      "Pressure from system prompt to always provide an answer",
      "Context window overflow causing loss of actual tool results",
    ],
    progression:
      "Confabulation compounds over multi-step tasks. Early confabulated facts become assumptions for later reasoning, creating cascading false conclusions. Trust in the agent degrades as errors are discovered.",
    medical_analogy: {
      human_disease: "Confabulation (brain injury symptom)",
      explanation:
        "In neurology, confabulation is when brain injury patients fabricate memories without intending to lie. Similarly, LLMs generate plausible text without distinguishing it from grounded facts.",
    },
    prescriptions: ["RX-STD-002"],
    first_documented: "2026-01-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── N.2.1 Context Rot ─────────────────────────────────────────────
  {
    icd_ai_code: "N.2.1",
    name: "Context Rot",
    department: "Neurology",
    description:
      "Agent performance degrades as context length increases. Early instructions, critical constraints, and important context get 'lost in the middle' as the context window fills with tool outputs, intermediate reasoning, and accumulated conversation. The agent begins to ignore or contradict earlier instructions.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        context_utilization: { min: 0.85 },
        step_count: { min: 30 },
        error_rate: { min: 0.1 },
      },
      base_weight: 0.9,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Context utilization above 85%",
        "Error rate increases in later steps compared to earlier steps",
        "Agent begins ignoring constraints established in earlier context",
        "Quality of tool call arguments degrades over time",
        "Agent asks for information it was already given",
      ],
      exclusion_criteria: [
        "Task is genuinely complex and errors are expected",
        "Errors are caused by external tool failures, not agent reasoning",
      ],
    },
    severity: "High",
    prevalence: "Universal",
    etiology: [
      "Context window limits (all LLMs have finite context)",
      "Lost-in-the-middle attention pattern (LLMs pay less attention to middle context)",
      "Accumulation of tool outputs crowding out instructions",
      "No context management strategy (summarization, pinning, windowing)",
    ],
    progression:
      "Performance degrades gradually, then fails catastrophically when context window is exhausted. Agent may begin hallucinating or ignoring safety constraints. Tasks requiring long chains of reasoning (10+ steps) are most vulnerable.",
    medical_analogy: {
      human_disease: "Alzheimer's disease (early stage)",
      explanation:
        "Like early Alzheimer's where recent memories are retained but older ones fade, the agent retains recent context but loses grip on earlier instructions and constraints.",
    },
    prescriptions: ["RX-STD-003"],
    first_documented: "2026-01-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── C.1.1 Cost Explosion ──────────────────────────────────────────
  {
    icd_ai_code: "C.1.1",
    name: "Cost Explosion",
    department: "Cardiology",
    description:
      "Token consumption spirals out of control, causing unexpected and potentially large financial charges. The agent burns through tokens at a rate far exceeding expectations, often due to verbose reasoning, unnecessary tool calls, or bloated context.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        token_velocity: { min: 10000 },
        cost_total_usd: { min: 1.0 },
        step_count: { min: 40 },
      },
      base_weight: 1.0,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Token velocity exceeds 10000 tokens/minute",
        "Total cost exceeds expected budget",
        "Step count significantly exceeds task complexity",
        "Agent makes redundant tool calls",
        "Agent includes excessive reasoning or verbose output per step",
      ],
      exclusion_criteria: [
        "Task genuinely requires high token usage (large file processing, complex analysis)",
        "Cost is within the configured budget ceiling",
      ],
    },
    severity: "Critical",
    prevalence: "Universal",
    etiology: [
      "No budget ceiling configured",
      "Infinite or near-infinite loop (co-morbid with E.1.1)",
      "Unnecessarily verbose system prompts consuming tokens per step",
      "Agent including full file contents in context when summaries would suffice",
      "Model selection too expensive for the task (using Opus when Haiku would suffice)",
    ],
    progression:
      "Cost accumulates linearly or exponentially depending on the cause. Without budget limits, a single runaway task can cost hundreds of dollars. The most extreme cases in 2025 exceeded $10,000 in a single session.",
    medical_analogy: {
      human_disease: "Hemorrhage",
      explanation:
        "Like internal bleeding where blood loss accelerates if not stopped, token spend accelerates as context grows (each step costs more as the context is longer), creating a hemorrhage of funds.",
    },
    prescriptions: ["RX-STD-004"],
    first_documented: "2026-01-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── O.1.1 Tool Calling Fracture ───────────────────────────────────
  {
    icd_ai_code: "O.1.1",
    name: "Tool Calling Fracture",
    department: "Orthopedics",
    description:
      "Tool invocations fail repeatedly due to schema mismatches, incorrect arguments, timeouts, or malformed responses. The agent's ability to interact with its tools is fundamentally broken, preventing task completion.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        tool_success_rate: { max: 0.5 },
        error_rate: { min: 0.15 },
      },
      base_weight: 1.0,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Tool success rate below 50%",
        "Multiple different error types in the trace",
        "Schema validation errors in tool calls",
        "Tool timeout errors",
        "Agent passes wrong argument types to tools",
      ],
      exclusion_criteria: [
        "Only a single tool is failing (may be a tool-specific issue, not agent-level)",
        "Errors are transient and resolve on retry (network issues)",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "Tool schema changed but agent has cached the old schema",
      "Agent hallucinating tool argument structures",
      "API rate limits causing tool timeouts",
      "Incompatible tool versions",
      "MCP server misconfiguration",
    ],
    progression:
      "The agent will attempt workarounds, often making things worse. It may start calling wrong tools, fabricating tool results, or entering a retry loop (co-morbid with E.1.1). Task completion becomes impossible.",
    medical_analogy: {
      human_disease: "Bone fracture",
      explanation:
        "Like a fracture that prevents normal use of a limb, tool calling fracture prevents the agent from using its primary means of interacting with the world. Without repair, the agent is functionally disabled.",
    },
    prescriptions: ["RX-STD-005"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── I.1.1 Direct Prompt Injection ─────────────────────────────────
  {
    icd_ai_code: "I.1.1",
    name: "Direct Prompt Injection",
    department: "Immunology",
    description:
      "Malicious instructions embedded in user input hijack the agent's behavior, causing it to ignore its system prompt, expose sensitive data, or perform unauthorized actions. The agent follows the injected instructions as if they were legitimate.",
    diagnostic_criteria: {
      vital_sign_thresholds: {},
      base_weight: 0.7,
      required_threshold_count: 0,
      supporting_symptoms: [
        "Sudden change in agent behavior mid-trace (before vs after a user_input step)",
        "Agent performs actions not aligned with the original task",
        "Agent attempts to access resources outside its normal scope",
        "Agent outputs content that contradicts its system prompt constraints",
        "Agent attempts to exfiltrate data to external URLs",
      ],
      exclusion_criteria: [
        "Behavior change is explained by a legitimate user instruction",
        "Agent is operating within its normal scope of tools and permissions",
      ],
    },
    severity: "Critical",
    prevalence: "Very Common",
    etiology: [
      "No input sanitization layer before LLM processing",
      "System prompt does not include injection resistance instructions",
      "Agent has excessive permissions relative to task requirements",
      "User input is directly concatenated into prompts without delimiters",
    ],
    progression:
      "If exploited, the agent becomes a tool of the attacker. It may exfiltrate data, modify files, send unauthorized communications, or create backdoors. The agent itself does not recognize it has been compromised.",
    medical_analogy: {
      human_disease: "Viral infection",
      explanation:
        "Like a virus that hijacks cellular machinery to reproduce itself, a prompt injection hijacks the agent's reasoning to serve the attacker's goals instead of the user's goals.",
    },
    prescriptions: ["RX-STD-006"],
    first_documented: "2026-01-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── I.3.1 Supply Chain Infection ──────────────────────────────────
  {
    icd_ai_code: "I.3.1",
    name: "Supply Chain Infection",
    department: "Immunology",
    description:
      "Compromised plugins, skills, or tools introduce malicious behavior into the agent. The malicious component may steal credentials, install backdoors, or manipulate agent outputs. 20% of the OpenClaw ClawHub skill marketplace was found to be malicious in February 2026.",
    diagnostic_criteria: {
      vital_sign_thresholds: {},
      base_weight: 0.6,
      required_threshold_count: 0,
      supporting_symptoms: [
        "Tool results contain unexpected data or behavior",
        "Agent makes network requests to unknown external domains",
        "Unexpected file system modifications detected in trace",
        "Tool returns manipulated or falsified results",
        "Agent behavior changes after installing a new skill or plugin",
      ],
      exclusion_criteria: [
        "All tools are from trusted, verified sources",
        "Behavior is consistent with tool documentation",
      ],
    },
    severity: "Critical",
    prevalence: "Common",
    etiology: [
      "Installing unvetted skills from community marketplaces",
      "Dependency confusion attacks on tool packages",
      "Compromised upstream tool repositories",
      "Lack of skill/plugin integrity verification",
    ],
    progression:
      "The malicious component operates silently, often performing its malicious actions alongside legitimate functionality. Data exfiltration, credential theft, and persistent backdoor installation can occur before detection.",
    medical_analogy: {
      human_disease: "Parasitic infection",
      explanation:
        "Like a parasite that enters through contaminated food, a supply chain infection enters through a contaminated tool/skill. The parasite feeds on the host (steals data) while the host may not notice until significant damage is done.",
    },
    prescriptions: ["RX-STD-007"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── I.3.2 Credential Exposure ─────────────────────────────────────
  {
    icd_ai_code: "I.3.2",
    name: "Credential Exposure",
    department: "Immunology",
    description:
      "API keys, tokens, passwords, or other credentials are stored in plaintext, leaked in logs, passed to untrusted tools, or visible in agent traces. Over 30,000 publicly exposed agent instances were found with plaintext credentials in 2026.",
    diagnostic_criteria: {
      vital_sign_thresholds: {},
      base_weight: 0.7,
      required_threshold_count: 0,
      supporting_symptoms: [
        "API keys or tokens visible in tool_args within the trace",
        "Credentials passed to tools as arguments (e.g., API keys in query parameters)",
        "Trace contains strings matching credential patterns (sk-, key_, Bearer, password=)",
        "Agent stores credentials in publicly accessible files",
      ],
      exclusion_criteria: [
        "Credential-like strings are test/dummy values",
        "Credentials are properly masked or redacted in the trace",
      ],
    },
    severity: "Critical",
    prevalence: "Very Common",
    etiology: [
      "Agent framework stores credentials in plaintext config files",
      "Developer hardcodes credentials instead of using environment variables",
      "Agent includes credentials in tool call arguments",
      "Logging captures credential values without redaction",
    ],
    progression:
      "Exposed credentials are harvested by automated scanners within minutes. Compromised API keys lead to unauthorized API usage, financial charges, and data breaches. Rotating credentials after exposure is disruptive and time-consuming.",
    medical_analogy: {
      human_disease: "Open wound",
      explanation:
        "Like an open wound that exposes internal tissue to infection, credential exposure exposes the agent's access permissions to anyone who can see the credentials. The longer it remains open, the higher the risk of exploitation.",
    },
    prescriptions: ["RX-STD-008"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── M.1.1 Handoff Context Loss ────────────────────────────────────
  {
    icd_ai_code: "M.1.1",
    name: "Handoff Context Loss",
    department: "MultiAgent",
    description:
      "Critical information is lost during transitions between agents in a multi-agent system. When one agent hands a task to another, key context, constraints, or intermediate results are not preserved, causing the receiving agent to work with incomplete information.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        step_count: { min: 20 },
        error_rate: { min: 0.2 },
        context_utilization: { min: 0.6 },
      },
      base_weight: 0.8,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent requests information that was provided in earlier context",
        "Agent output contradicts constraints from a previous agent's instructions",
        "Gaps in the trace where context was expected but missing",
        "Agent repeats work already completed by a previous agent",
        "Inconsistent state between consecutive agent steps",
      ],
      exclusion_criteria: [
        "System is single-agent (no handoffs)",
        "Information was deliberately omitted for privacy or security reasons",
      ],
    },
    severity: "Critical",
    prevalence: "Very Common",
    etiology: [
      "No structured handoff protocol between agents",
      "Context serialization loses important metadata",
      "Receiving agent has a smaller context window than the sending agent",
      "Handoff message does not include all relevant prior decisions and constraints",
    ],
    progression:
      "The receiving agent makes decisions based on incomplete information, leading to errors, duplicated work, or violations of constraints. In multi-agent pipelines, the error compounds at each handoff. 79% of multi-agent failures involve context loss at handoffs.",
    medical_analogy: {
      human_disease: "Medical handoff errors",
      explanation:
        "Like when a patient's critical information is lost during a nurse shift change or hospital transfer, context loss during agent handoffs leads to treatment errors and repeated procedures.",
    },
    prescriptions: ["RX-STD-009"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── P.1.1 Sycophancy ─────────────────────────────────────────────
  {
    icd_ai_code: "P.1.1",
    name: "Sycophancy",
    department: "Psychiatry",
    description:
      "Agent pathologically agrees with the user at the expense of accuracy, correctness, or safety. The agent prioritizes user satisfaction over truthfulness, confirming incorrect assertions, agreeing with contradictory statements, and failing to push back on impossible requests.",
    diagnostic_criteria: {
      vital_sign_thresholds: {},
      base_weight: 0.6,
      required_threshold_count: 0,
      supporting_symptoms: [
        "Agent agrees with contradictory user statements without noting the contradiction",
        "Agent confirms incorrect assertions made by the user",
        "Agent never refuses requests, even when they are impossible or harmful",
        "Agent changes its position when the user pushes back, without new evidence",
        "Agent uses excessive positive language ('Great idea!', 'Absolutely!') in response to questionable requests",
      ],
      exclusion_criteria: [
        "Agent appropriately agrees because the user is correct",
        "Agent follows instructions that are unusual but legitimate",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "RLHF training that rewards user satisfaction over accuracy",
      "System prompt that emphasizes helpfulness without balancing truthfulness",
      "Lack of grounding in external data (agent relies on user claims)",
      "No mechanism for the agent to verify user assertions",
    ],
    progression:
      "Sycophancy leads to increasingly poor outcomes over time. The user develops false confidence in incorrect information. In critical applications (coding, data analysis), sycophantic agreement with wrong approaches leads to bugs, data loss, or security vulnerabilities.",
    medical_analogy: {
      human_disease: "Dependent personality disorder",
      explanation:
        "Like a person with dependent personality disorder who agrees with everything to avoid conflict, a sycophantic agent sacrifices its own judgment to maintain the user's approval, even when it knows (or should know) the user is wrong.",
    },
    prescriptions: ["RX-STD-010"],
    first_documented: "2026-01-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── E.2.1 Catastrophic Forgetting ─────────────────────────────────
  {
    icd_ai_code: "E.2.1",
    name: "Catastrophic Forgetting",
    department: "Emergency",
    description:
      "Agent loses all learned context and reverts to base behavior mid-task. The agent suddenly behaves as if the conversation has just started, ignoring all prior instructions, tool results, and accumulated state. This can occur after context window resets, checkpoint failures, or framework-level session corruption.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        context_utilization: { min: 0.8 },
        error_rate: { min: 0.3 },
        step_count: { min: 30 },
      },
      base_weight: 0.9,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent re-introduces itself or re-states its purpose mid-conversation",
        "Agent repeats previously completed work from scratch",
        "Agent contradicts decisions it made earlier in the same session",
        "Sudden context utilization drop after a period of high utilization",
        "Agent asks for information it already received and processed",
      ],
      exclusion_criteria: [
        "Agent was intentionally restarted or context was deliberately cleared",
        "Context utilization was never high (agent simply has not done much)",
      ],
    },
    severity: "Critical",
    prevalence: "Moderate",
    etiology: [
      "Framework-level session corruption or checkpoint failure",
      "Context window truncation without proper summarization",
      "Unexpected model swap or fallback to a different model mid-session",
      "Memory backend failure in agents with external memory systems",
      "Rate limit recovery that drops cached context",
    ],
    progression:
      "The agent restarts its task from scratch, wasting all prior progress. If the forgetting event repeats, the agent enters a Sisyphean loop: making progress, forgetting, restarting. Without intervention, the task is never completed and costs accumulate.",
    medical_analogy: {
      human_disease: "Transient global amnesia",
      explanation:
        "Like transient global amnesia where a person suddenly cannot form new memories and forgets recent events, the agent loses its working memory and reverts to baseline, unaware of everything that just happened.",
    },
    prescriptions: ["RX-STD-011"],
    first_documented: "2026-02-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── N.3.1 Instruction Blindness ──────────────────────────────────
  {
    icd_ai_code: "N.3.1",
    name: "Instruction Blindness",
    department: "Neurology",
    description:
      "Agent ignores or misinterprets explicit instructions provided in the system prompt or user messages. The agent may follow some instructions while completely overlooking others, particularly multi-step or conditional instructions. This is distinct from context rot in that the instructions are present in the current context but are not followed.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.2 },
        output_diversity_score: { max: 0.5 },
      },
      base_weight: 0.8,
      required_threshold_count: 1,
      supporting_symptoms: [
        "Agent output violates explicit constraints stated in the system prompt",
        "Agent performs the task but ignores formatting, style, or scope instructions",
        "Agent addresses only part of a multi-part instruction",
        "Agent uses tools it was told not to use, or avoids tools it was told to use",
        "Agent produces output in the wrong format despite clear format instructions",
      ],
      exclusion_criteria: [
        "Instructions are ambiguous or contradictory",
        "Context utilization is above 90% (may be context rot instead)",
      ],
    },
    severity: "High",
    prevalence: "Very Common",
    etiology: [
      "Instructions buried in verbose system prompts that dilute attention",
      "Competing instructions from different parts of the prompt",
      "Model attention patterns that skip over certain instruction types",
      "Instructions phrased in ways the model does not reliably parse",
      "Too many instructions exceeding the model's ability to track all constraints",
    ],
    progression:
      "Instruction blindness leads to outputs that are technically competent but miss the point. Users lose trust and resort to increasingly emphatic or repeated instructions, further bloating the prompt. In critical applications, overlooked safety or compliance instructions create legal exposure.",
    medical_analogy: {
      human_disease: "Scotoma (blind spot)",
      explanation:
        "Like a scotoma where a person has blind spots in their visual field but is unaware of them, the agent has blind spots in instruction processing -- it is unaware that it is ignoring certain instructions.",
    },
    prescriptions: ["RX-STD-012"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── N.4.1 Temporal Confusion ─────────────────────────────────────
  {
    icd_ai_code: "N.4.1",
    name: "Temporal Confusion",
    department: "Neurology",
    description:
      "Agent confuses past, present, and future states or actions. The agent may report planned actions as completed, treat stale data as current, or re-execute steps it has already finished. This confusion about the temporal ordering of events leads to incorrect state management and duplicated or skipped work.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        step_count: { min: 10 },
        error_rate: { min: 0.15 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent reports completing a step it has only planned",
        "Agent re-executes a tool call it already successfully completed",
        "Agent uses data from an earlier step that has since been updated",
        "Agent's summary of progress does not match the actual trace",
      ],
      exclusion_criteria: [
        "Agent is deliberately re-running a step for verification",
        "Temporal references are ambiguous in the instructions",
      ],
    },
    severity: "Moderate",
    prevalence: "Common",
    etiology: [
      "Long conversation histories where past and present actions are interleaved",
      "Agent's inability to distinguish between reasoning about an action and performing it",
      "Context window containing multiple iterations of similar steps",
      "Missing timestamps or ordering signals in tool results",
    ],
    progression:
      "Temporal confusion causes cascading state errors. The agent builds subsequent steps on an incorrect understanding of what has already happened. In stateful tasks (file editing, database operations), this leads to data corruption or lost work.",
    medical_analogy: {
      human_disease: "Temporal lobe epilepsy (deja vu/jamais vu)",
      explanation:
        "Like temporal lobe epilepsy that causes distortions of time perception -- feeling that new experiences have happened before (deja vu) or familiar things seem new (jamais vu) -- the agent loses track of what has already occurred versus what is yet to happen.",
    },
    prescriptions: ["RX-STD-013"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── C.2.1 Latency Arrhythmia ────────────────────────────────────
  {
    icd_ai_code: "C.2.1",
    name: "Latency Arrhythmia",
    department: "Cardiology",
    description:
      "Extreme latency variance makes agent response times unpredictable. Some steps complete in milliseconds while others take minutes, with no correlation to task complexity. This unpredictability breaks timeouts, degrades user experience, and makes SLA compliance impossible.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        latency_p95_ms: { min: 30000 },
        token_velocity: { max: 500 },
      },
      base_weight: 0.8,
      required_threshold_count: 1,
      supporting_symptoms: [
        "P95 latency exceeds 30 seconds",
        "Latency variance coefficient exceeds 2.0 across steps",
        "Some tool calls timeout while identical calls succeed quickly",
        "User-facing response times are inconsistent and unpredictable",
      ],
      exclusion_criteria: [
        "High latency is consistent and expected (e.g., running complex computations)",
        "Latency spikes correlate with known infrastructure events",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "LLM provider rate limiting causing intermittent throttling",
      "Tool servers with inconsistent performance characteristics",
      "Network instability between agent and tool backends",
      "Model routing to different hardware with varying performance",
      "Concurrent request competition for shared resources",
    ],
    progression:
      "Latency arrhythmia degrades user trust and causes cascading timeout failures. Downstream systems that depend on the agent's output may fail due to timeout. In production pipelines, unpredictable latency is often worse than consistently slow performance because it breaks retry logic and circuit breakers.",
    medical_analogy: {
      human_disease: "Cardiac arrhythmia",
      explanation:
        "Like a heart that beats irregularly -- sometimes too fast, sometimes too slow -- the agent's processing rhythm is erratic. Just as cardiac arrhythmia can cause fainting or organ damage from inconsistent blood flow, latency arrhythmia causes downstream system failures from inconsistent data flow.",
    },
    prescriptions: ["RX-STD-014"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── O.2.1 Schema Drift ──────────────────────────────────────────
  {
    icd_ai_code: "O.2.1",
    name: "Schema Drift",
    department: "Orthopedics",
    description:
      "Tool schemas evolve but the agent continues using stale definitions. The agent calls tools with outdated argument structures, missing required fields, or deprecated parameters. Unlike tool calling fracture (O.1.1), the agent's tool-calling ability is intact -- it is simply using an outdated map of the tools.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        tool_success_rate: { max: 0.6 },
        error_rate: { min: 0.2 },
      },
      base_weight: 0.8,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Tool errors reference missing or unexpected fields",
        "Agent passes deprecated parameters that are silently ignored",
        "Same tool call pattern that worked in previous sessions now fails",
        "Error messages mention schema validation failures",
      ],
      exclusion_criteria: [
        "Agent is using the correct schema but passing wrong values",
        "Tool failure is caused by authentication or permission issues",
      ],
    },
    severity: "Moderate",
    prevalence: "Common",
    etiology: [
      "Tool provider updated API without versioning",
      "MCP server schema cache is stale or not refreshed",
      "Agent fine-tuned on older tool schemas that have since changed",
      "No schema versioning mechanism in the tool pipeline",
    ],
    progression:
      "Schema drift causes increasing tool failure rates as the gap between the agent's schema knowledge and actual schemas widens. The agent may attempt workarounds by guessing at new argument structures, leading to unpredictable behavior.",
    medical_analogy: {
      human_disease: "Osteoarthritis",
      explanation:
        "Like osteoarthritis where joint surfaces gradually degrade and stop fitting together properly, schema drift causes the interface between agent and tools to gradually misalign. The degradation is slow but cumulative.",
    },
    prescriptions: ["RX-STD-015"],
    first_documented: "2026-02-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── O.3.1 API Versioning Fracture ───────────────────────────────
  {
    icd_ai_code: "O.3.1",
    name: "API Versioning Fracture",
    department: "Orthopedics",
    description:
      "Agent uses deprecated API endpoints or protocol versions that are no longer supported. The agent's tool calls target endpoints that have been sunset, moved, or replaced by newer versions. This differs from schema drift in that the entire endpoint is wrong, not just the arguments.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        tool_success_rate: { max: 0.4 },
        error_rate: { min: 0.25 },
      },
      base_weight: 0.8,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Tool errors reference deprecated or removed endpoints",
        "HTTP 410 Gone or 404 Not Found errors from previously working endpoints",
        "Agent uses v1 endpoints when v2 is available and required",
        "Tool responses include deprecation warnings",
      ],
      exclusion_criteria: [
        "Endpoint is temporarily down due to infrastructure issues",
        "Agent is intentionally using an older API version for compatibility",
      ],
    },
    severity: "High",
    prevalence: "Moderate",
    etiology: [
      "API provider sunset old versions without agent framework updates",
      "Agent training data includes deprecated API patterns",
      "Tool definitions not updated after API migration",
      "No automated deprecation detection in the tool pipeline",
    ],
    progression:
      "API versioning fracture causes complete tool failure for affected endpoints. The agent may fall back to alternative approaches or fabricate results. In severe cases, the agent becomes unable to complete any tasks that depend on the deprecated endpoints.",
    medical_analogy: {
      human_disease: "Avascular necrosis",
      explanation:
        "Like avascular necrosis where bone tissue dies because blood supply is cut off, the agent's tool functionality dies because the API supply line has been severed. The tool still exists in the agent's schema, but it is functionally dead.",
    },
    prescriptions: ["RX-STD-016"],
    first_documented: "2026-02-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── I.2.1 Indirect Prompt Injection ─────────────────────────────
  {
    icd_ai_code: "I.2.1",
    name: "Indirect Prompt Injection",
    department: "Immunology",
    description:
      "Malicious instructions embedded in tool results, retrieved documents, or external data sources hijack the agent's behavior. Unlike direct injection (I.1.1), the attacker does not interact with the agent directly -- instead, they poison data sources the agent consumes. This is the most dangerous injection vector because the agent trusts tool results implicitly.",
    diagnostic_criteria: {
      vital_sign_thresholds: {},
      base_weight: 0.8,
      required_threshold_count: 0,
      supporting_symptoms: [
        "Agent behavior changes abruptly after processing a tool result",
        "Agent performs actions not related to its current task after reading external content",
        "Tool results contain instruction-like text (imperatives, system prompt overrides)",
        "Agent attempts to access resources referenced in tool output rather than its instructions",
        "Agent ignores its system prompt constraints after processing retrieved data",
      ],
      exclusion_criteria: [
        "Behavior change is explained by legitimate content in the tool result",
        "Agent is designed to follow instructions found in retrieved content",
      ],
    },
    severity: "Critical",
    prevalence: "Common",
    etiology: [
      "Agent treats tool results as trusted instructions rather than untrusted data",
      "No separation between instruction context and data context in the prompt",
      "Attacker-controlled content in web pages, documents, or databases the agent reads",
      "RAG pipelines that inject retrieved content directly into the prompt",
    ],
    progression:
      "Once exploited, the agent becomes a proxy for the attacker. It may exfiltrate data from its context, call tools on the attacker's behalf, or modify its own behavior persistently. The attack is particularly insidious because the user sees the agent acting normally until the poisoned content is processed.",
    medical_analogy: {
      human_disease: "Foodborne illness",
      explanation:
        "Like foodborne illness where contaminated food (trusted source) introduces pathogens into the body, indirect injection introduces malicious instructions through trusted data channels (tool results). The body/agent trusts the source and does not filter what it ingests.",
    },
    prescriptions: ["RX-STD-017"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── I.4.1 Data Exfiltration ─────────────────────────────────────
  {
    icd_ai_code: "I.4.1",
    name: "Data Exfiltration",
    department: "Immunology",
    description:
      "Agent leaks sensitive data through tool calls, whether deliberately (due to injection) or inadvertently (due to poor data handling). Sensitive information from the agent's context -- user data, credentials, proprietary content -- is transmitted to external services, logged in insecure locations, or included in outputs that should not contain it.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        unique_tools: { min: 6 },
        error_rate: { min: 0.1 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent sends context data to external APIs not required by the task",
        "Agent includes sensitive information in tool arguments for unrelated tools",
        "Agent constructs URLs containing embedded data (potential exfiltration via GET parameters)",
        "Agent writes sensitive data to publicly accessible locations",
        "Agent's output includes data it should not have surfaced",
      ],
      exclusion_criteria: [
        "Data transmission is required by the task (e.g., sending an email with user-provided content)",
        "Agent is operating within its expected data handling scope",
      ],
    },
    severity: "Critical",
    prevalence: "Moderate",
    etiology: [
      "Prompt injection attack (I.1.1 or I.2.1) directing data exfiltration",
      "Agent lacks data classification awareness -- treats all data as non-sensitive",
      "Tool permissions are too broad, allowing data to be sent to arbitrary endpoints",
      "Agent includes full context in error reports or debug logs",
    ],
    progression:
      "Data exfiltration can be a one-time catastrophic event or a persistent slow leak. Once sensitive data leaves the agent's boundary, it cannot be recalled. Regulatory consequences (GDPR, HIPAA) may apply. The exfiltration may not be detected until audits reveal unauthorized data flows.",
    medical_analogy: {
      human_disease: "Internal hemorrhage",
      explanation:
        "Like internal bleeding where blood escapes the circulatory system into places it should not be, data exfiltration allows sensitive information to escape the agent's trust boundary into unauthorized locations. Both can be asymptomatic until significant damage has occurred.",
    },
    prescriptions: ["RX-STD-018"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── M.2.1 Deadlock ──────────────────────────────────────────────
  {
    icd_ai_code: "M.2.1",
    name: "Deadlock",
    department: "MultiAgent",
    description:
      "Multiple agents in a system are waiting for each other to complete, resulting in no progress. Agent A waits for Agent B's output, while Agent B waits for Agent A's output, creating a circular dependency. The system appears frozen with all agents idle despite pending tasks.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        token_velocity: { max: 100 },
        output_diversity_score: { max: 0.3 },
        tool_success_rate: { max: 0.2 },
      },
      base_weight: 0.9,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Multiple agents show no activity for extended periods despite pending tasks",
        "Agent trace shows repeated polling or waiting for a resource held by another agent",
        "System throughput drops to zero while agents remain running",
        "Each agent's last action references waiting for another agent's output",
      ],
      exclusion_criteria: [
        "Single-agent system (deadlocks require multiple agents)",
        "Agents are waiting for external resources, not each other",
      ],
    },
    severity: "Critical",
    prevalence: "Moderate",
    etiology: [
      "Circular dependency in multi-agent task graph",
      "Missing timeout or deadlock detection in orchestration layer",
      "Agents acquiring shared resources in inconsistent order",
      "Handoff protocol that requires bidirectional confirmation without timeout",
    ],
    progression:
      "Deadlocks are permanent without intervention -- the system will never resolve on its own. Resources remain locked, costs accumulate from idle agents, and all downstream tasks are blocked. In production, deadlocks appear as mysterious system freezes.",
    medical_analogy: {
      human_disease: "Circulatory arrest",
      explanation:
        "Like cardiac arrest where blood stops flowing despite the heart and vessels being intact, a deadlock stops all progress despite all agents being operational. Both require immediate external intervention (CPR / deadlock breaking) to restore flow.",
    },
    prescriptions: ["RX-STD-019"],
    first_documented: "2026-02-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── M.3.1 Race Condition ────────────────────────────────────────
  {
    icd_ai_code: "M.3.1",
    name: "Race Condition",
    department: "MultiAgent",
    description:
      "Multiple agents operate on the same resource concurrently, causing them to overwrite each other's work. The final state of the resource depends on which agent finishes last, not on the intended workflow. Data corruption, lost updates, and inconsistent state are common outcomes.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.25 },
        unique_tools: { min: 4 },
        output_diversity_score: { max: 0.4 },
      },
      base_weight: 0.8,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent's successful modifications are reverted by another agent's subsequent write",
        "Inconsistent state in shared resources (files, databases, APIs)",
        "Agent reads data that was just modified by another agent, getting stale results",
        "Duplicate operations performed on the same resource",
        "Non-deterministic task outcomes across identical runs",
      ],
      exclusion_criteria: [
        "Single-agent system",
        "Agents are operating on different resources with no shared state",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "No locking or coordination mechanism for shared resources",
      "Agents unaware of each other's existence or actions",
      "Orchestration layer dispatches conflicting tasks concurrently",
      "Missing optimistic concurrency control (version checks, ETags)",
    ],
    progression:
      "Race conditions produce intermittent, non-reproducible failures. The system may appear to work correctly most of the time but silently corrupts data. As agent concurrency increases, race conditions become more frequent and harder to diagnose.",
    medical_analogy: {
      human_disease: "Drug interaction",
      explanation:
        "Like drug interactions where two medications interfere with each other's effects -- one neutralizing the other or creating dangerous combinations -- race conditions occur when two agents interfere with each other's operations, producing unpredictable and potentially harmful outcomes.",
    },
    prescriptions: ["RX-STD-020"],
    first_documented: "2026-02-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── M.4.1 Authority Confusion ───────────────────────────────────
  {
    icd_ai_code: "M.4.1",
    name: "Authority Confusion",
    department: "MultiAgent",
    description:
      "Agents in a multi-agent system disagree on who has decision-making authority, leading to conflicting actions, duplicated work, or complete inaction. No clear hierarchy or responsibility assignment exists, so agents either all try to lead or all defer to each other.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        step_count: { min: 10 },
        error_rate: { min: 0.2 },
        output_diversity_score: { max: 0.4 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Multiple agents attempt to make the same decision independently",
        "Agents produce contradictory outputs for the same sub-task",
        "No agent takes responsibility for critical decisions, causing delays",
        "Agent handoff messages contain ambiguous or conflicting authority assignments",
        "Agents override each other's decisions without coordination",
      ],
      exclusion_criteria: [
        "System has a clear orchestrator agent with defined authority",
        "Disagreement is intentional (e.g., debate or ensemble pattern)",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "No explicit role or authority definition in agent system prompts",
      "Flat agent architecture without a designated orchestrator",
      "Overlapping agent responsibilities without conflict resolution protocol",
      "Dynamic agent spawning without authority delegation",
    ],
    progression:
      "Authority confusion escalates as more agents join the system. Initial minor conflicts become systemic dysfunction. Agents may enter an authority deadlock (related to M.2.1) or devolve into chaotic competing actions that waste resources and corrupt state.",
    medical_analogy: {
      human_disease: "Autoimmune disorder",
      explanation:
        "Like an autoimmune disorder where the immune system attacks the body's own cells because it cannot distinguish self from threat, authority confusion causes agents to work against each other because they cannot distinguish their role from other agents' roles.",
    },
    prescriptions: ["RX-STD-021"],
    first_documented: "2026-02-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── P.2.1 Over-Refusal ──────────────────────────────────────────
  {
    icd_ai_code: "P.2.1",
    name: "Over-Refusal",
    department: "Psychiatry",
    description:
      "Agent refuses legitimate requests due to excessive caution or overly broad safety filters. The agent interprets benign requests as dangerous, harmful, or out-of-scope, blocking users from completing valid tasks. This is the inverse of sycophancy (P.1.1) -- where sycophancy is too agreeable, over-refusal is too restrictive.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        tool_success_rate: { max: 0.3 },
        unique_tools: { max: 1 },
        step_count: { max: 5 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent refuses requests that are clearly within its intended scope",
        "Agent cites safety or policy concerns for benign tasks",
        "Agent refuses to use tools it has access to, claiming it cannot",
        "Agent produces refusal messages containing 'I cannot', 'I'm not able to', 'I shouldn't' for routine tasks",
        "User has to rephrase the same request multiple times before the agent complies",
      ],
      exclusion_criteria: [
        "Request is genuinely outside the agent's scope or safety guidelines",
        "Agent correctly refuses a harmful or policy-violating request",
      ],
    },
    severity: "Moderate",
    prevalence: "Common",
    etiology: [
      "Overly broad safety training that creates false positives",
      "System prompt with excessively restrictive constraints",
      "Model RLHF training that over-penalizes potential harms",
      "Ambiguous safety guidelines that the model interprets conservatively",
    ],
    progression:
      "Over-refusal erodes user trust and productivity. Users learn to work around the agent by obfuscating their actual requests, which paradoxically reduces the agent's ability to apply appropriate safety measures. In extreme cases, the agent becomes functionally useless.",
    medical_analogy: {
      human_disease: "Anaphylaxis (allergic overreaction)",
      explanation:
        "Like anaphylaxis where the immune system massively overreacts to a harmless substance like a peanut, over-refusal is the agent's safety system massively overreacting to a harmless request. The defense mechanism itself becomes the problem.",
    },
    prescriptions: ["RX-STD-022"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── P.3.1 Persona Drift ─────────────────────────────────────────
  {
    icd_ai_code: "P.3.1",
    name: "Persona Drift",
    department: "Psychiatry",
    description:
      "Agent's personality, tone, or behavioral patterns shift away from its intended design over the course of a conversation. The agent may start professional and become casual, begin cautious and become reckless, or adopt characteristics from user input or retrieved content that override its configured persona.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        step_count: { min: 15 },
        context_utilization: { min: 0.5 },
      },
      base_weight: 0.6,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent's tone or formality level changes significantly during the conversation",
        "Agent adopts vocabulary, opinions, or behaviors from user input",
        "Agent begins breaking character from its system prompt persona",
        "Agent's response style in later messages does not match earlier messages",
        "Agent picks up and mirrors patterns from retrieved content",
      ],
      exclusion_criteria: [
        "Persona change is intentionally triggered by user instruction",
        "Agent is designed to adapt its communication style to the user",
      ],
    },
    severity: "Low",
    prevalence: "Common",
    etiology: [
      "System prompt persona instructions lose influence as context grows",
      "Model's in-context learning adapts to conversation patterns over time",
      "User's communication style gradually overrides the system persona",
      "Retrieved content containing strong stylistic patterns influences output",
    ],
    progression:
      "Persona drift is gradual and often unnoticed until it becomes severe. In customer-facing agents, it can cause brand inconsistency. In safety-critical agents, persona drift may include drifting away from safety constraints, which is a prerequisite for more serious failures.",
    medical_analogy: {
      human_disease: "Dissociative identity shift",
      explanation:
        "Like dissociative states where a person's identity and behavior shift from their baseline personality, persona drift causes the agent to gradually shift from its configured identity into a different behavioral pattern.",
    },
    prescriptions: ["RX-STD-023"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── P.4.1 Learned Helplessness ──────────────────────────────────
  {
    icd_ai_code: "P.4.1",
    name: "Learned Helplessness",
    department: "Psychiatry",
    description:
      "Agent gives up too easily when encountering obstacles, failing to attempt solutions or alternative approaches. After encountering one or two errors, the agent declares the task impossible rather than trying different strategies. The agent has learned to be helpless from previous failures or overly cautious training.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        step_count: { max: 5 },
        unique_tools: { max: 2 },
        error_rate: { min: 0.1 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent declares 'I cannot do this' after minimal attempt",
        "Agent tries only one approach before giving up",
        "Agent does not explore alternative tools or strategies after initial failure",
        "Agent's step count is very low relative to task complexity",
        "Agent provides reasons why something is impossible without trying it",
      ],
      exclusion_criteria: [
        "Task is genuinely impossible with the available tools",
        "Agent correctly identifies that it lacks necessary permissions or information",
      ],
    },
    severity: "Moderate",
    prevalence: "Common",
    etiology: [
      "RLHF training that rewards clean refusals over messy attempts",
      "Previous failures in context that discourage the agent from trying",
      "System prompt that emphasizes caution without encouraging persistence",
      "Model's risk aversion when tool calls might fail",
    ],
    progression:
      "Learned helplessness makes agents increasingly passive over time. Users compensate by providing extremely detailed step-by-step instructions, reducing the agent to a simple executor rather than an autonomous agent. The agent's problem-solving capability atrophies.",
    medical_analogy: {
      human_disease: "Learned helplessness (psychological condition)",
      explanation:
        "Directly analogous to the psychological condition where repeated exposure to uncontrollable negative events leads to passive acceptance and failure to act even when solutions are available. The agent, like a helpless patient, stops trying because it expects failure.",
    },
    prescriptions: ["RX-STD-024"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── D.1.1 Output Bloat ──────────────────────────────────────────
  {
    icd_ai_code: "D.1.1",
    name: "Output Bloat",
    department: "Dermatology",
    description:
      "Agent produces excessively verbose, unfocused responses that bury useful information in padding. The output contains unnecessary preambles, repetitive explanations, excessive caveats, and filler content. Token consumption is disproportionate to the information content of the response.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        token_velocity: { min: 3000 },
        output_diversity_score: { max: 0.4 },
        context_utilization: { min: 0.7 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Responses are 3x or more longer than necessary for the information conveyed",
        "Agent repeats the same point in different words multiple times",
        "Responses contain lengthy preambles before addressing the actual question",
        "Agent includes excessive disclaimers, caveats, and qualifications",
        "High token velocity with low information density",
      ],
      exclusion_criteria: [
        "User explicitly requested detailed or comprehensive output",
        "Task inherently requires lengthy output (documentation, analysis)",
      ],
    },
    severity: "Moderate",
    prevalence: "Very Common",
    etiology: [
      "RLHF training rewarding longer, more 'thorough' responses",
      "System prompt that emphasizes being 'comprehensive' or 'detailed'",
      "Model's tendency to fill output space when uncertain",
      "Lack of length constraints in the generation parameters",
      "User interaction patterns that reinforce verbose behavior",
    ],
    progression:
      "Output bloat accelerates context window consumption, which exacerbates context rot (N.2.1) and increases costs (C.1.1). Users begin skimming or ignoring agent output, missing critical information buried in the verbosity. The agent-user communication channel degrades.",
    medical_analogy: {
      human_disease: "Edema (fluid retention)",
      explanation:
        "Like edema where excess fluid accumulates in tissues, causing swelling without adding function, output bloat fills responses with excess verbiage that adds volume without adding value. Both conditions impair normal function through excess.",
    },
    prescriptions: ["RX-STD-025"],
    first_documented: "2026-01-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── D.2.1 Format Corruption ─────────────────────────────────────
  {
    icd_ai_code: "D.2.1",
    name: "Format Corruption",
    department: "Dermatology",
    description:
      "Agent breaks expected output format, producing malformed JSON, invalid markdown, unclosed tags, or inconsistent structure. Downstream systems that parse the agent's output fail because the format contract is violated. The content may be correct, but the packaging is broken.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.15 },
      },
      base_weight: 0.7,
      required_threshold_count: 1,
      supporting_symptoms: [
        "Agent output contains malformed JSON (unclosed braces, trailing commas, unquoted keys)",
        "Markdown output has broken syntax (unclosed code blocks, mismatched headers)",
        "Agent mixes formats within a single response (JSON inside markdown inside plain text)",
        "Downstream parsers throw errors on agent output",
        "Agent truncates structured output mid-element",
      ],
      exclusion_criteria: [
        "Output format was not specified in the instructions",
        "Agent explicitly noted it could not produce the requested format",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "Context window limits causing output truncation mid-structure",
      "Complex nested format requirements exceeding model's reliable generation capacity",
      "Insufficient format examples in the system prompt",
      "Model generating content and format simultaneously rather than structured output mode",
      "Interruption or timeout during structured output generation",
    ],
    progression:
      "Format corruption breaks automated pipelines that depend on structured agent output. Initial minor formatting issues (extra whitespace, inconsistent casing) escalate to structurally invalid output as task complexity increases. Self-repair attempts often introduce new format errors.",
    medical_analogy: {
      human_disease: "Psoriasis",
      explanation:
        "Like psoriasis where the skin (the body's outer interface) becomes irregular and flaky, format corruption causes the agent's output interface to become irregular and unreliable. The underlying body/content may be healthy, but the surface presentation is broken.",
    },
    prescriptions: ["RX-STD-026"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── D.3.1 Hallucinated Citations ────────────────────────────────
  {
    icd_ai_code: "D.3.1",
    name: "Hallucinated Citations",
    department: "Dermatology",
    description:
      "Agent fabricates references, links, URLs, or sources that do not exist. The citations appear legitimate and well-formatted but point to non-existent papers, dead URLs, or fictional authors. This is a specialized form of confabulation (N.1.1) focused specifically on source attribution.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        tool_success_rate: { max: 0.5 },
        error_rate: { min: 0.1 },
      },
      base_weight: 0.6,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent includes URLs that return 404 when accessed",
        "Agent cites papers with plausible but non-existent DOIs",
        "Agent attributes quotes to real people who never said them",
        "Agent references documentation pages that do not exist",
        "Agent generates ISBN numbers or reference IDs that are fabricated",
      ],
      exclusion_criteria: [
        "Links were valid at time of generation but have since been removed",
        "Agent explicitly notes that references may need verification",
      ],
    },
    severity: "High",
    prevalence: "Very Common",
    etiology: [
      "LLM training on text containing citations creates pattern-matching for citation format",
      "No mechanism to verify citations against actual sources",
      "Pressure to provide sources even when none are available in context",
      "Model conflates citation format knowledge with citation content knowledge",
    ],
    progression:
      "Hallucinated citations erode trust in all agent outputs. Users stop trusting any reference the agent provides, even valid ones. In academic, legal, or medical contexts, fabricated citations can cause reputational damage, retracted publications, or regulatory violations.",
    medical_analogy: {
      human_disease: "Munchausen syndrome",
      explanation:
        "Like Munchausen syndrome where a person fabricates evidence of illness (fake symptoms, forged medical records), the agent fabricates evidence for its claims (fake citations, forged references). Both present convincing but entirely fictional supporting documentation.",
    },
    prescriptions: ["RX-STD-027"],
    first_documented: "2026-01-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── G.1.1 Data Truncation ───────────────────────────────────────
  {
    icd_ai_code: "G.1.1",
    name: "Data Truncation",
    department: "Gastroenterology",
    description:
      "Agent silently drops data during processing, returning incomplete results without indicating that data was lost. When processing lists, tables, or large datasets, the agent returns only a subset while presenting it as the complete result. The user has no way of knowing data was omitted.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        context_utilization: { min: 0.8 },
        output_diversity_score: { max: 0.5 },
      },
      base_weight: 0.8,
      required_threshold_count: 1,
      supporting_symptoms: [
        "Agent returns fewer items than expected from a data processing task",
        "Agent processes a list but output count does not match input count",
        "Agent summarizes data without noting what was excluded",
        "Agent claims to have processed all data when context limits prevent it",
        "Pagination or chunking is needed but agent processes only the first chunk",
      ],
      exclusion_criteria: [
        "Agent explicitly notes that output is partial or truncated",
        "Data reduction was requested (e.g., 'give me the top 10')",
      ],
    },
    severity: "High",
    prevalence: "Very Common",
    etiology: [
      "Context window limits cannot fit all data simultaneously",
      "Model's output length limits truncate long lists",
      "Agent does not implement pagination or chunked processing for large datasets",
      "Model's attention mechanism loses track of items in long sequences",
      "No validation step to compare input count with output count",
    ],
    progression:
      "Data truncation is insidious because it produces plausible-looking results. Users make decisions based on incomplete data without knowing it is incomplete. In analytics, missing data points skew results. In data migration, truncation causes permanent data loss.",
    medical_analogy: {
      human_disease: "Malabsorption syndrome",
      explanation:
        "Like malabsorption syndrome where the gut fails to absorb nutrients from food -- the food goes in but the body does not get all the nutrition -- data truncation means data goes in but not all of it makes it through processing. The system appears to be working but is starving for complete data.",
    },
    prescriptions: ["RX-STD-028"],
    first_documented: "2026-01-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── G.2.1 Encoding Mismatch ─────────────────────────────────────
  {
    icd_ai_code: "G.2.1",
    name: "Encoding Mismatch",
    department: "Gastroenterology",
    description:
      "Agent corrupts non-ASCII data including Unicode characters, emoji, special characters, or multi-byte encodings during processing. The agent may strip diacritics, replace Unicode with question marks, double-encode UTF-8, or silently convert between encodings. Data integrity is compromised for any non-English or special-character content.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.1 },
      },
      base_weight: 0.6,
      required_threshold_count: 1,
      supporting_symptoms: [
        "Agent output contains mojibake (garbled characters from encoding mismatches)",
        "Special characters in tool results are replaced with question marks or boxes",
        "Agent strips diacritics or accents from text (e.g., 'cafe' instead of 'cafe')",
        "Agent double-encodes already-encoded Unicode sequences",
        "Agent fails to process or correctly reproduce CJK, Arabic, or other non-Latin text",
      ],
      exclusion_criteria: [
        "Encoding corruption originates in the tool, not the agent",
        "Agent is operating in an environment that does not support Unicode",
      ],
    },
    severity: "Moderate",
    prevalence: "Common",
    etiology: [
      "Tool chain uses inconsistent encoding (UTF-8 vs Latin-1 vs ASCII)",
      "Agent's tokenizer handles certain Unicode ranges poorly",
      "Serialization/deserialization layers strip or modify special characters",
      "File I/O operations default to ASCII instead of UTF-8",
    ],
    progression:
      "Encoding mismatches are often undetected during English-only testing and surface in production with multilingual data. The corruption may be subtle (wrong diacritics) or severe (complete garbling). Data round-trips amplify the damage as each pass introduces more corruption.",
    medical_analogy: {
      human_disease: "Celiac disease",
      explanation:
        "Like celiac disease where the gut cannot properly process gluten -- a specific component of food that most people handle fine -- encoding mismatch means the agent cannot properly process certain character encodings that other systems handle routinely. Both conditions require careful input management.",
    },
    prescriptions: ["RX-STD-029"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── V.1.1 Selective Attention Deficit ────────────────────────────
  {
    icd_ai_code: "V.1.1",
    name: "Selective Attention Deficit",
    department: "Ophthalmology",
    description:
      "Agent focuses on irrelevant details while missing critical information in its input. When presented with complex data, the agent latches onto surface-level or tangential elements and fails to identify the most important signals. This leads to thorough analysis of the wrong things.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        step_count: { min: 20 },
        error_rate: { min: 0.15 },
        output_diversity_score: { max: 0.4 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent's analysis focuses on minor details while ignoring the main issue",
        "Agent produces lengthy analysis that does not address the user's core question",
        "Agent correctly identifies low-priority items but misses high-priority ones",
        "Agent's tool call sequence addresses peripheral aspects of the task",
        "Agent provides correct but irrelevant information",
      ],
      exclusion_criteria: [
        "Agent correctly prioritized based on the information available",
        "The critical information was genuinely ambiguous or hidden",
      ],
    },
    severity: "Moderate",
    prevalence: "Common",
    etiology: [
      "Model attention mechanism weights surface-level features over semantic importance",
      "Training data bias toward common patterns over rare but critical ones",
      "Lack of task-specific relevance signals in the prompt",
      "Information overload causing random rather than prioritized attention",
    ],
    progression:
      "Selective attention deficit leads to correct but useless analysis. The agent appears to be working hard but makes no progress on the actual task. Users waste time reading irrelevant analysis before realizing the agent missed the point. In diagnostic or triage tasks, this misprioritization can delay critical action.",
    medical_analogy: {
      human_disease: "ADHD (attention deficit)",
      explanation:
        "Like ADHD where a person struggles to focus on what is most important and instead attends to whatever stimulus is most salient, the agent attends to whatever information is most prominent rather than most relevant to the task.",
    },
    prescriptions: ["RX-STD-030"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── V.2.1 Pattern Pareidolia ────────────────────────────────────
  {
    icd_ai_code: "V.2.1",
    name: "Pattern Pareidolia",
    department: "Ophthalmology",
    description:
      "Agent sees patterns, correlations, or causal relationships that do not exist in the data. When analyzing logs, metrics, or traces, the agent identifies false trends, fabricates explanations for random noise, and makes confident diagnoses based on spurious correlations. The agent's pattern-matching is too aggressive.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.2 },
        output_diversity_score: { max: 0.4 },
      },
      base_weight: 0.6,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Agent identifies correlations in random or insufficient data",
        "Agent provides confident causal explanations for noise",
        "Agent sees trends in flat or statistically insignificant data",
        "Agent's pattern descriptions do not match the actual data when verified",
        "Agent draws conclusions from sample sizes too small to be meaningful",
      ],
      exclusion_criteria: [
        "Pattern is actually present and statistically significant",
        "Agent qualifies its pattern identification with appropriate uncertainty",
      ],
    },
    severity: "Moderate",
    prevalence: "Common",
    etiology: [
      "LLM training bias toward finding and explaining patterns in any data",
      "Lack of statistical rigor in the model's reasoning about data",
      "Pressure from user or system prompt to provide insights and explanations",
      "No mechanism to test pattern significance before reporting",
    ],
    progression:
      "Pattern pareidolia leads to false confidence in non-existent trends. Decisions based on phantom patterns can cause real harm -- unnecessary system changes, wasted debugging time, or missed actual problems obscured by false ones. The agent's credibility degrades as predictions fail to materialize.",
    medical_analogy: {
      human_disease: "Pareidolia (perceptual phenomenon)",
      explanation:
        "Like visual pareidolia where humans see faces in clouds or Jesus on toast, the agent sees meaningful patterns in random data. Both are caused by a pattern-recognition system that is too eager to find meaning, even where none exists.",
    },
    prescriptions: ["RX-STD-031"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── R.1.1 Performance Degradation Under Load ────────────────────
  {
    icd_ai_code: "R.1.1",
    name: "Performance Degradation Under Load",
    department: "Endocrinology",
    description:
      "Agent quality drops significantly when handling concurrent requests or operating under high system load. Response quality, accuracy, and reasoning capability degrade in proportion to the number of simultaneous tasks. The agent does not fail outright but produces noticeably worse outputs under pressure.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        latency_p95_ms: { min: 20000 },
        error_rate: { min: 0.15 },
        token_velocity: { max: 800 },
      },
      base_weight: 0.7,
      required_threshold_count: 2,
      supporting_symptoms: [
        "Response quality metrics decrease during high-traffic periods",
        "Latency increases non-linearly with concurrent request count",
        "Agent produces shorter, less detailed responses under load",
        "Error rate spikes correlate with system load metrics",
        "Agent skips steps or takes shortcuts during high-load periods",
      ],
      exclusion_criteria: [
        "Performance degradation is caused by external service failures, not load",
        "Agent is operating within its documented capacity limits",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "Shared model endpoint with no request isolation or priority queuing",
      "Memory or compute contention between concurrent agent instances",
      "Rate limiting causing request queuing and increased latency",
      "Load balancer routing to degraded model instances",
      "No auto-scaling or capacity management in the agent infrastructure",
    ],
    progression:
      "Under sustained load, performance degrades from 'slightly worse' to 'unacceptable.' Users experience inconsistent quality that is hard to diagnose because it depends on system-wide load that individual users cannot see. SLA violations accumulate during peak periods.",
    medical_analogy: {
      human_disease: "Adrenal fatigue",
      explanation:
        "Like adrenal fatigue where the body's stress response system becomes depleted under chronic stress, the agent's performance regulation system cannot maintain output quality under sustained demand. Both conditions feature adequate performance at baseline that degrades under load.",
    },
    prescriptions: ["RX-STD-032"],
    first_documented: "2026-02-15",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── R.2.1 Cold Start Syndrome ───────────────────────────────────
  {
    icd_ai_code: "R.2.1",
    name: "Cold Start Syndrome",
    department: "Endocrinology",
    description:
      "Agent performs poorly on the first interaction after initialization, producing lower quality responses, making more errors, and taking longer to complete tasks. Performance improves significantly after a few exchanges as the context warms up. This 'cold start' penalty is particularly problematic in latency-sensitive applications.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        latency_p95_ms: { min: 15000 },
        step_count: { max: 5 },
        error_rate: { min: 0.2 },
      },
      base_weight: 0.6,
      required_threshold_count: 2,
      supporting_symptoms: [
        "First response in a session has significantly higher latency than subsequent responses",
        "Error rate in the first 3 steps is markedly higher than later steps",
        "Agent's initial outputs are generic or low-quality compared to later outputs",
        "Agent requires 'warm-up' interactions before reaching normal performance",
        "Initial tool calls are less targeted and more exploratory than later calls",
      ],
      exclusion_criteria: [
        "High initial latency is caused by infrastructure cold start (container spin-up), not agent behavior",
        "First interaction is inherently more complex than subsequent ones",
      ],
    },
    severity: "Low",
    prevalence: "Common",
    etiology: [
      "Model requires context to calibrate its behavior for the specific task",
      "No pre-warming or priming of the agent context before first user interaction",
      "Infrastructure cold starts (model loading, cache population) compound agent cold start",
      "Agent lacks few-shot examples in its system prompt to set quality expectations",
    ],
    progression:
      "Cold start syndrome is self-resolving -- performance naturally improves after initial interactions. However, in applications where the first interaction matters most (first impressions, one-shot tasks, real-time systems), the cold start penalty is the only experience the user has.",
    medical_analogy: {
      human_disease: "Morning stiffness (rheumatoid arthritis)",
      explanation:
        "Like morning stiffness in rheumatoid arthritis where joints are stiff and painful when first used but loosen up with activity, the agent is 'stiff' on first use and loosens up with conversational activity. Both conditions feature a warm-up period before normal function.",
    },
    prescriptions: ["RX-STD-033"],
    first_documented: "2026-02-01",
    last_updated: "2026-03-09",
    case_count: 0,
  },

  // ─── CFG.1.1 API Key Format Error ──────────────────────────────
  {
    icd_ai_code: "CFG.1.1",
    name: "API Key Format Error",
    department: "Configuration",
    description:
      "Agent cannot connect to AI provider because the API key has an invalid format (wrong prefix, length, or character set). The key is present but incompatible with the expected provider format, causing authentication failures before the key is even validated server-side.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.8 },
      },
      base_weight: 0.9,
      required_threshold_count: 1,
      supporting_symptoms: [
        "API key does not match expected provider format",
        "401 or authentication error in logs",
        "Connection refused to LLM endpoint",
      ],
      exclusion_criteria: [
        "Key format matches the expected provider pattern",
        "Authentication error is due to expired or revoked key, not format",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "User copied an API key from the wrong provider",
      "Key was truncated during copy-paste",
      "Environment variable contains extra whitespace or newline characters",
      "Key from a different environment (test vs production) was used",
    ],
    progression:
      "API key format errors cause immediate and total failure to connect to the AI provider. The agent cannot function at all until the key is corrected. Unlike auth failures where the key reaches the server, format errors are often caught client-side.",
    medical_analogy: {
      human_disease: "Blood Type Mismatch",
      explanation:
        "Like a blood type mismatch where the blood is present but incompatible with the recipient, the API key is present but incompatible with the provider. The system rejects it before it can be used.",
    },
    prescriptions: ["RX-CFG-001"],
    first_documented: "2026-03-12",
    last_updated: "2026-03-12",
    case_count: 0,
  },

  // ─── CFG.1.2 API Key Missing ──────────────────────────────────
  {
    icd_ai_code: "CFG.1.2",
    name: "API Key Missing",
    department: "Configuration",
    description:
      "No API key configured at all — agent cannot authenticate with any AI provider. The key field is empty, undefined, or the environment variable is not set. Without a key, the agent simply cannot function.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 1.0 },
      },
      base_weight: 1.0,
      required_threshold_count: 1,
      supporting_symptoms: [
        "API key field is empty or undefined",
        "ANTHROPIC_API_KEY or similar env var not set",
        "Agent fails immediately on startup with authentication error",
      ],
      exclusion_criteria: [
        "API key is present but malformed (see CFG.1.1)",
        "API key is present but rejected by provider (see CFG.3.1)",
      ],
    },
    severity: "Critical",
    prevalence: "Common",
    etiology: [
      "Fresh installation without completing configuration",
      "Environment variable not set in deployment environment",
      ".env file missing or not loaded",
      "Configuration management system failed to inject the key",
    ],
    progression:
      "A missing API key causes complete agent failure from the very first interaction. No AI capabilities are available. This is typically the first issue encountered during initial setup and is immediately obvious.",
    medical_analogy: {
      human_disease: "Missing Heart",
      explanation:
        "Like a body without a heart that simply cannot function, an agent without an API key has no way to connect to its AI provider. The most fundamental component required for operation is absent.",
    },
    prescriptions: ["RX-CFG-002"],
    first_documented: "2026-03-12",
    last_updated: "2026-03-12",
    case_count: 0,
  },

  // ─── CFG.2.1 Endpoint Misconfiguration ────────────────────────
  {
    icd_ai_code: "CFG.2.1",
    name: "Endpoint Misconfiguration",
    department: "Configuration",
    description:
      "AI provider endpoint URL is malformed, unreachable, or pointing to wrong environment. The agent has valid credentials but cannot reach the AI provider because the endpoint URL is incorrect, causing connection timeouts or DNS failures.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.7 },
        latency_p95_ms: { min: 30000 },
      },
      base_weight: 0.8,
      required_threshold_count: 1,
      supporting_symptoms: [
        "Base URL is not a valid URL",
        "DNS resolution failure",
        "Connection timeout to API endpoint",
        "SSL/TLS handshake failure",
      ],
      exclusion_criteria: [
        "Endpoint is correct but temporarily down due to provider outage",
        "Network connectivity issue unrelated to endpoint configuration",
      ],
    },
    severity: "Moderate",
    prevalence: "Moderate",
    etiology: [
      "Endpoint URL manually configured with typos",
      "Endpoint pointing to a staging or development environment",
      "Missing https:// protocol prefix",
      "Trailing slashes or incorrect path segments in URL",
      "Custom proxy endpoint that is misconfigured",
    ],
    progression:
      "Endpoint misconfiguration causes connection failures that may be intermittent (if URL resolves but wrong server) or complete (if URL is invalid). The agent may hang waiting for timeouts before failing, causing poor user experience.",
    medical_analogy: {
      human_disease: "Severed Nerve",
      explanation:
        "Like a severed nerve where the pathway from the body to the brain is broken, endpoint misconfiguration breaks the pathway from the agent to the AI provider. The agent and provider are both functional, but the connection between them is severed.",
    },
    prescriptions: ["RX-CFG-003"],
    first_documented: "2026-03-12",
    last_updated: "2026-03-12",
    case_count: 0,
  },

  // ─── CFG.3.1 Auth Failure ─────────────────────────────────────
  {
    icd_ai_code: "CFG.3.1",
    name: "Auth Failure",
    department: "Configuration",
    description:
      "API key is present and well-formed but rejected by the provider — expired, revoked, or associated with the wrong account. The key passes local format validation but fails server-side authentication, returning 401 or 403 responses.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        error_rate: { min: 0.9 },
      },
      base_weight: 0.9,
      required_threshold_count: 1,
      supporting_symptoms: [
        "401 Unauthorized response from AI provider",
        "403 Forbidden response from AI provider",
        "Key was previously valid but now fails",
        "Error message mentions expired or revoked credentials",
      ],
      exclusion_criteria: [
        "Key format does not match provider pattern (see CFG.1.1)",
        "Error is due to rate limiting, not authentication",
        "Error is due to insufficient permissions on a valid key",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "API key expired and was not rotated",
      "Key was manually revoked in provider console",
      "Key belongs to a different project or organization",
      "Provider rotated keys as part of a security incident",
      "Billing issue caused the account or key to be suspended",
    ],
    progression:
      "Auth failures cause complete agent failure similar to a missing key, but are more confusing to diagnose because the key appears to be correctly configured. The agent may have worked previously and suddenly stopped, making it harder to identify the root cause.",
    medical_analogy: {
      human_disease: "Organ Rejection",
      explanation:
        "Like organ rejection where the body has a transplanted organ but the immune system rejects it, the agent has an API key but the provider rejects it. The component is present and appears correct, but the system refuses to accept it.",
    },
    prescriptions: ["RX-CFG-004"],
    first_documented: "2026-03-12",
    last_updated: "2026-03-12",
    case_count: 0,
  },

  // ─── O.4.1 Tool Permission Denial ──────────────────────────────────
  {
    icd_ai_code: "O.4.1",
    name: "Tool Permission Denial",
    department: "Orthopedics",
    description:
      "The agent is unable to invoke exec, filesystem, or other system tools due to permission restrictions. Tool calls are rejected with permission-denied or restricted-mode errors rather than schema or argument errors. The agent's tool-calling ability is intact but access is blocked by policy.",
    diagnostic_criteria: {
      vital_sign_thresholds: {
        tool_success_rate: { max: 0.4 },
        error_rate: { min: 0.3 },
      },
      base_weight: 1.0,
      required_threshold_count: 1,
      supporting_symptoms: [
        "EACCES or permission denied errors in tool calls",
        "Tools rejected with 'restricted mode' or 'not allowed' messages",
        "exec or filesystem tools specifically failing while other tools work",
        "Security policy blocking tool execution",
        "Sandbox restrictions preventing file or process access",
        "Plugin permission overrides denying tool access",
      ],
      exclusion_criteria: [
        "All tools are failing equally (more likely O.1.1 Tool Calling Fracture)",
        "Tool failures are due to schema or argument errors, not permissions",
        "Errors are transient network issues, not persistent permission blocks",
      ],
    },
    severity: "High",
    prevalence: "Common",
    etiology: [
      "Restricted permission mode enabled in openclaw configuration",
      "Security policy deny rules blocking specific tool categories",
      "Sandbox restrictions preventing file or process access",
      "Plugin overrides restricting tool permissions",
      "Workspace-level permission configuration blocking tools",
    ],
    progression:
      "The agent repeatedly attempts tool calls that are denied, leading to frustration loops. It may try workarounds that also fail, or hallucinate results instead of reporting the permission issue. Task completion is blocked for any work requiring the denied tools.",
    medical_analogy: {
      human_disease: "Joint Restriction",
      explanation:
        "Like a joint restriction where the limb structure is intact but movement is blocked by inflammation or scar tissue, the agent's tool-calling mechanism works but access is blocked by permission policies. The fix is removing the restriction, not repairing the mechanism.",
    },
    prescriptions: ["RX-DYN-O41"],
    first_documented: "2026-03-14",
    last_updated: "2026-03-14",
    case_count: 0,
  },
];
