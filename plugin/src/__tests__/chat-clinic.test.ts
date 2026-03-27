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
  it("starts consultation and shows AI text when AI responds with text only", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Let me check your config.",
      toolCalls: [{ id: "tool-1", name: "run_command", input: { command: "cat ~/.openclaw/openclaw.json", reason: "Checking your config" } }],
      done: false,
      assistantContent: [
        { type: "text", text: "Let me check your config." },
        { type: "tool_use", id: "tool-1", name: "run_command", input: { command: "cat ~/.openclaw/openclaw.json", reason: "Checking your config" } },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "agent not working" });

    expect(result.text).toContain("Checking your config");
    expect(result.text).toContain("cat ~/.openclaw/openclaw.json");
    expect(result.text).toContain("/clinic yes");
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

  it("saves session with conversation history for multi-turn", async () => {
    const { saveSession } = await import("../session-store.js");
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Checking...",
      toolCalls: [{ id: "tool-1", name: "run_command", input: { command: "ls", reason: "test" } }],
      done: false,
      assistantContent: [{ type: "text", text: "Checking..." }, { type: "tool_use", id: "tool-1", name: "run_command", input: { command: "ls", reason: "test" } }],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    await handler({ args: "test" });

    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingStepId: "awaiting_approval",
        pendingCommand: "ls",
        pendingToolId: "tool-1",
        conversation: expect.arrayContaining([
          expect.objectContaining({ role: "user" }),
          expect.objectContaining({ role: "assistant" }),
        ]),
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
