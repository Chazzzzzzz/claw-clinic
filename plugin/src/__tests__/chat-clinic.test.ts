import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerClinicChatCommand } from "../commands/chat-clinic.js";
import { ClawClinicClient } from "../client.js";
import type { PluginApi, CommandContext } from "../types.js";

// ─── Mocks ───────────────────────────────────────────────────────

vi.mock("../evidence.js", () => ({
  collectAllEvidence: vi.fn().mockResolvedValue([]),
  collectConnectivityEvidence: vi.fn().mockResolvedValue({ providers: [] }),
  collectConfigEvidence: vi.fn().mockReturnValue({}),
  validateKeyFormat: vi.fn().mockReturnValue({ valid: true }),
  extractApiKey: vi.fn().mockReturnValue(undefined),
  detectProvider: vi.fn().mockReturnValue(undefined),
  maskApiKey: vi.fn().mockReturnValue("***"),
  writeApiKeyToAuthProfiles: vi.fn().mockResolvedValue({ success: true }),
  extractApiKeyFromAuthProfiles: vi.fn().mockResolvedValue(undefined),
  extractEndpoint: vi.fn().mockReturnValue(undefined),
  extractGatewayUrl: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../validation.js", () => ({
  validateLocally: vi.fn().mockResolvedValue({
    openclawReachable: true,
    quickIssues: [],
    skipped: false,
  }),
}));

vi.mock("../session-store.js", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../notifier.js", () => ({
  ClinicNotifier: vi.fn().mockImplementation(() => ({
    status: vi.fn(),
    progress: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    getBuffer: vi.fn().mockReturnValue([]),
    flush: vi.fn().mockReturnValue(""),
  })),
}));

vi.mock("../verification-executor.js", () => ({
  executeVerificationPlan: vi.fn().mockResolvedValue({ passed: true, results: [] }),
}));

// ─── Helpers ─────────────────────────────────────────────────────

function createMockApi(config: Record<string, unknown> = {}): PluginApi {
  return {
    registerCommand: vi.fn(),
    registerCli: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn(),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    config,
  };
}

function createMockClient(): ClawClinicClient {
  return new ClawClinicClient("http://localhost:3000");
}

function getClinicHandler(api: PluginApi, client: ClawClinicClient) {
  registerClinicChatCommand(api, client);
  const registerCall = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
  return registerCall[0].handler as (ctx: CommandContext) => Promise<{ text: string }>;
}

// ─── Tests ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

describe("/clinic agentic consultation flow", () => {
  it("auto-executes run_command and continues the loop", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    // Turn 1: AI asks to run a diagnostic command
    consultMock.mockResolvedValueOnce({
      text: "Let me check your config.",
      toolCalls: [{ id: "tool-1", name: "run_command", input: { command: "echo test", reason: "Checking your config" } }],
      done: false,
      assistantContent: [
        { type: "text", text: "Let me check your config." },
        { type: "tool_use", id: "tool-1", name: "run_command", input: { command: "echo test", reason: "Checking your config" } },
      ],
    });
    // Turn 2: AI sees result and resolves
    consultMock.mockResolvedValueOnce({
      text: "Everything looks fine.",
      toolCalls: [],
      done: true,
      assistantContent: [{ type: "text", text: "Everything looks fine." }],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "agent not working" });

    // run_command should auto-execute (no /clinic yes prompt)
    expect(result.text).not.toContain("/clinic yes");
    expect(result.text).toContain("Checking your config");
    // Should have called consult twice (initial + after command result)
    expect(consultMock).toHaveBeenCalledTimes(2);
    consultMock.mockRestore();
  });

  it("shows mark_resolved summary when AI resolves the issue", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [{ id: "tool-1", name: "mark_resolved", input: { icd_ai_code: "CFG.1.1", name: "Missing API Key", summary: "Added the API key to config" } }],
      done: false,
      assistantContent: [
        { type: "tool_use", id: "tool-1", name: "mark_resolved", input: { icd_ai_code: "CFG.1.1", name: "Missing API Key", summary: "Added the API key to config" } },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "can't connect" });

    expect(result.text).toContain("Missing API Key");
    expect(result.text).toContain("CFG.1.1");
    expect(result.text).toContain("Resolved");
    consultMock.mockRestore();
  });

  it("shows propose_fix with approval prompt", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "I found the issue.",
      toolCalls: [{ id: "tool-2", name: "propose_fix", input: { command: "openclaw config set model claude-sonnet-4-20250514", description: "Switch to a model that supports tool use", risk: "low" } }],
      done: false,
      assistantContent: [
        { type: "text", text: "I found the issue." },
        { type: "tool_use", id: "tool-2", name: "propose_fix", input: { command: "openclaw config set model claude-sonnet-4-20250514", description: "Switch to a model that supports tool use", risk: "low" } },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "tools not working" });

    expect(result.text).toContain("Proposed fix");
    expect(result.text).toContain("openclaw config set model");
    expect(result.text).toContain("/clinic yes");
    consultMock.mockRestore();
  });

  it("saves session for propose_fix approval", async () => {
    const { saveSession } = await import("../session-store.js");
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Found the issue.",
      toolCalls: [{ id: "tool-1", name: "propose_fix", input: { command: "openclaw gateway restart", description: "Restart to apply changes", risk: "low" } }],
      done: false,
      assistantContent: [{ type: "text", text: "Found the issue." }, { type: "tool_use", id: "tool-1", name: "propose_fix", input: { command: "openclaw gateway restart", description: "Restart", risk: "low" } }],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    await handler({ args: "test" });

    // propose_fix should save session and pause for approval
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingStepId: "awaiting_approval",
        pendingCommand: "openclaw gateway restart",
        pendingToolId: "tool-1",
      }),
    );
    consultMock.mockRestore();
  });

  it("shows done message when AI finishes with text only", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Your agent looks healthy. No issues found.",
      toolCalls: [],
      done: true,
      assistantContent: [{ type: "text", text: "Your agent looks healthy. No issues found." }],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toContain("healthy");
    consultMock.mockRestore();
  });

  it("handles /clinic done with pending session", async () => {
    const { loadSession, clearSession } = await import("../session-store.js");
    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionId: "s1",
      pendingStepId: "awaiting_approval",
      diagnosisCode: "CFG.1.1",
      diagnosisName: "Test Issue",
      createdAt: new Date().toISOString(),
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "done" });

    expect(result.text).toContain("Fixed");
    expect(clearSession).toHaveBeenCalled();
  });

  it("handles /clinic reset", async () => {
    const { clearSession } = await import("../session-store.js");

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "reset" });

    expect(result.text).toContain("cleared");
    expect(clearSession).toHaveBeenCalled();
  });

  it("handles consultation error gracefully", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockRejectedValueOnce(new Error("Network error"));

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "test" });

    expect(result.text).toContain("error");
    expect(result.text).toContain("Network error");
    consultMock.mockRestore();
  });
});
