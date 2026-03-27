import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerClinicChatCommand } from "../commands/chat-clinic.js";
import { ClawClinicClient } from "../client.js";
import type { PluginApi, CommandContext } from "../types.js";

// ─── Mocks ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../session-store.js", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../evidence.js", async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    collectAllEvidence: vi.fn().mockResolvedValue([]),
    collectConnectivityEvidence: vi.fn().mockResolvedValue({
      type: "connectivity",
      providers: [],
      gatewayReachable: true,
    }),
    collectConfigEvidence: vi.fn().mockReturnValue({ type: "config" }),
    extractApiKeyFromAuthProfiles: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../validation.js", () => ({
  validateLocally: vi.fn().mockResolvedValue({
    openclawReachable: true,
    quickIssues: [],
    skipped: false,
  }),
}));

vi.mock("../verification-executor.js", () => ({
  executeVerificationPlan: vi.fn().mockResolvedValue({ passed: true, results: [] }),
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

// ─── Helpers ─────────────────────────────────────────────────────

function createMockApi(config: Record<string, unknown> = {}): PluginApi {
  return {
    registerCommand: vi.fn(),
    registerCli: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    config,
  };
}

function getClinicHandler(api: PluginApi, client: ClawClinicClient) {
  registerClinicChatCommand(api, client);
  const call = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
  return call[0].handler as (ctx: CommandContext) => Promise<{ text: string }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

// ─── Tests ───────────────────────────────────────────────────────

describe("Agentic consultation flow — evidence and approval", () => {
  it("collects evidence and sends to /consult on fresh diagnosis", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Healthy agent.",
      toolCalls: [],
      done: true,
      assistantContent: [{ type: "text", text: "Healthy agent." }],
    });

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(consultMock).toHaveBeenCalledTimes(1);
    const messages = consultMock.mock.calls[0][0];
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("Evidence");
    expect(result.text).toContain("Healthy");
    consultMock.mockRestore();
  });

  it("includes user symptoms in evidence message", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Investigating...",
      toolCalls: [{ id: "t1", name: "run_command", input: { command: "echo test", reason: "test" } }],
      done: false,
      assistantContent: [{ type: "tool_use", id: "t1", name: "run_command", input: { command: "echo test", reason: "test" } }],
    });

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    await handler({ args: "my agent loops forever" });

    const messages = consultMock.mock.calls[0][0];
    expect(messages[0].content).toContain("my agent loops forever");
    consultMock.mockRestore();
  });

  it("asks for user approval before running diagnostic commands", async () => {
    const { saveSession } = await import("../session-store.js");
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [{ id: "t1", name: "run_command", input: { command: "cat ~/.openclaw/openclaw.json", reason: "Reading config" } }],
      done: false,
      assistantContent: [{ type: "tool_use", id: "t1", name: "run_command", input: { command: "cat ~/.openclaw/openclaw.json", reason: "Reading config" } }],
    });

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "test" });

    // Shows the command and asks for approval
    expect(result.text).toContain("cat ~/.openclaw/openclaw.json");
    expect(result.text).toContain("/clinic yes");

    // Saves session with tool ID for approval flow
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingToolId: "t1",
        pendingCommand: "cat ~/.openclaw/openclaw.json",
      }),
    );

    consultMock.mockRestore();
  });

  it("asks for approval before applying fixes", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Found the issue.",
      toolCalls: [{ id: "t2", name: "propose_fix", input: { command: "openclaw gateway restart", description: "Restart to load new config", risk: "low" } }],
      done: false,
      assistantContent: [
        { type: "text", text: "Found the issue." },
        { type: "tool_use", id: "t2", name: "propose_fix", input: { command: "openclaw gateway restart", description: "Restart to load new config", risk: "low" } },
      ],
    });

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "not responding" });

    expect(result.text).toContain("Proposed fix");
    expect(result.text).toContain("openclaw gateway restart");
    expect(result.text).toContain("/clinic yes");
    consultMock.mockRestore();
  });

  it("handles backend error gracefully", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockRejectedValueOnce(new Error("Connection refused"));

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "help" });

    expect(result.text).toContain("error");
    expect(result.text).toContain("Connection refused");
    consultMock.mockRestore();
  });

  it("clears session on mark_resolved", async () => {
    const { clearSession } = await import("../session-store.js");
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [{ id: "t3", name: "mark_resolved", input: { icd_ai_code: "CFG.1.1", name: "Missing Key", summary: "Fixed it" } }],
      done: false,
      assistantContent: [{ type: "tool_use", id: "t3", name: "mark_resolved", input: { icd_ai_code: "CFG.1.1", name: "Missing Key", summary: "Fixed it" } }],
    });

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "test" });

    expect(result.text).toContain("Resolved");
    expect(clearSession).toHaveBeenCalled();
    consultMock.mockRestore();
  });

  it("includes local validation issues in evidence", async () => {
    const { validateLocally } = await import("../validation.js");
    (validateLocally as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      openclawReachable: false,
      quickIssues: ["Gateway not running"],
      skipped: false,
    });

    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockResolvedValueOnce({
      text: "Gateway appears down.",
      toolCalls: [],
      done: true,
      assistantContent: [{ type: "text", text: "Gateway appears down." }],
    });

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    await handler({ args: "" });

    const messages = consultMock.mock.calls[0][0];
    expect(messages[0].content).toContain("Gateway not running");
    consultMock.mockRestore();
  });

  it("falls back gracefully when /consult endpoint is down", async () => {
    const consultMock = vi.spyOn(ClawClinicClient.prototype, "consult");
    consultMock.mockRejectedValueOnce(new Error("503 — AI diagnostician unavailable"));

    const { validateLocally } = await import("../validation.js");
    (validateLocally as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      openclawReachable: true,
      quickIssues: ["No API key configured"],
      skipped: false,
    });

    const api = createMockApi();
    const client = new ClawClinicClient("http://localhost:3000");
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    // Should show error but not crash
    expect(result.text).toContain("error");
    consultMock.mockRestore();
  });
});
