import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerClinicChatCommand } from "../commands/chat-clinic.js";
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

// ─── Helpers ─────────────────────────────────────────────────────

function createMockApi(): PluginApi {
  return {
    registerCommand: vi.fn(),
    registerCli: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    config: {},
  };
}

function createMockClient() {
  return {
    healthCheck: vi.fn(),
    diagnose: vi.fn(),
    treat: vi.fn(),
    verify: vi.fn(),
  };
}

function getClinicHandler(api: PluginApi, client: ReturnType<typeof createMockClient>) {
  registerClinicChatCommand(api, client as any);
  const registerCall = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
  return registerCall[0].handler as (ctx: CommandContext) => Promise<{ text: string }>;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Inline check verification in fresh diagnosis flow", () => {
  let api: PluginApi;
  let client: ReturnType<typeof createMockClient>;
  let handler: (ctx: CommandContext) => Promise<{ text: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    api = createMockApi();
    client = createMockClient();
    handler = getClinicHandler(api, client);
  });

  it("returns resolved when all inline checks pass and no symptoms", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-1",
      diagnosis: {
        icd_ai_code: "CFG.1.2",
        name: "API Key Missing",
        confidence: 0.95,
        severity: "Critical",
        reasoning: "No API key configured",
      },
      differential: [],
      treatmentPlan: [],
      checks: [
        { type: "check_config", target: "apiKey", expect: "present", label: "API key present" },
      ],
      fixes: [
        { label: "Set key", command: "openclaw config set apiKey sk-ant-...", description: "Set API key" },
      ],
    });

    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: true,
      results: [{ step: { type: "check_config", description: "API key present" }, passed: true }],
    });

    const result = await handler({ args: "" });

    expect(result.text).toMatch(/resolved|no action/i);
  });

  it("shows checks and fixes when inline checks fail", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-2",
      diagnosis: {
        icd_ai_code: "CFG.1.2",
        name: "API Key Missing",
        confidence: 0.95,
        severity: "Critical",
        reasoning: "No API key configured",
      },
      differential: [],
      treatmentPlan: [],
      checks: [
        { type: "check_config", target: "apiKey", expect: "present", label: "API key present" },
      ],
      fixes: [
        { label: "Set key", command: "openclaw config set apiKey sk-ant-...", description: "Set API key" },
      ],
    });

    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: false,
      results: [{ step: { type: "check_config", description: "API key present" }, passed: false, error: "Key missing" }],
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("**API Key Missing**");
    expect(result.text).toContain("Checked:");
    expect(result.text).toContain("\u2717 API key present");
    expect(result.text).toContain("To fix");
  });

  it("shows checks even when symptoms are reported and checks pass", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-3",
      diagnosis: {
        icd_ai_code: "CFG.3.1",
        name: "Auth Failure",
        confidence: 0.9,
        severity: "High",
        reasoning: "API key rejected",
      },
      differential: [],
      treatmentPlan: [],
      checks: [
        { type: "check_connectivity", target: "anthropic", expect: "reachable", label: "Anthropic API reachable" },
      ],
      fixes: [
        { label: "Regenerate key", command: "openclaw auth refresh", description: "Refresh credentials" },
      ],
    });

    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: true,
      results: [{ step: { type: "check_connectivity", description: "Anthropic API reachable" }, passed: true }],
    });

    // With symptoms, should NOT shortcut to resolved
    const result = await handler({ args: "my key is broken" });

    expect(result.text).toContain("**Auth Failure**");
    expect(result.text).toContain("Checked:");
    expect(result.text).toContain("\u2713 Anthropic API reachable");
  });

  it("returns healthy when backend finds no diagnosis", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-4",
      diagnosis: null,
      differential: [],
      treatmentPlan: [],
      checks: [],
      fixes: [],
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("healthy");
    expect(result.text).toContain("No issues detected");
  });

  it("shows diagnosis without checks when no checks returned", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-5",
      diagnosis: {
        icd_ai_code: "E.1.1",
        name: "Infinite Loop",
        confidence: 0.8,
        severity: "Critical",
        reasoning: "Loop detected in agent execution.",
      },
      differential: [],
      treatmentPlan: [],
      checks: [],
      fixes: [],
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("**Infinite Loop**");
    expect(result.text).toContain("Loop detected");
  });

  it("does not call backend verify or treat endpoints", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-6",
      diagnosis: {
        icd_ai_code: "CFG.1.2",
        name: "API Key Missing",
        confidence: 0.95,
        severity: "Critical",
        reasoning: "No API key",
      },
      differential: [],
      treatmentPlan: [],
      checks: [
        { type: "check_config", target: "apiKey", expect: "present", label: "API key present" },
      ],
      fixes: [
        { label: "Set key", command: "openclaw config set apiKey KEY", description: "Set key" },
      ],
    });

    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: false,
      results: [{ step: { type: "check_config", description: "API key present" }, passed: false }],
    });

    await handler({ args: "" });

    // Only diagnose is called — no verify or treat backend calls
    expect(client.diagnose).toHaveBeenCalledTimes(1);
    expect(client.verify).not.toHaveBeenCalled();
    expect(client.treat).not.toHaveBeenCalled();
  });

  it("handles backend error gracefully", async () => {
    client.diagnose.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await handler({ args: "" });

    expect(result.text).toContain("Could not reach diagnostic backend");
  });

  it("falls back to local issues when backend is down", async () => {
    const { validateLocally } = await import("../validation.js");
    (validateLocally as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      openclawReachable: true,
      quickIssues: ["No API key configured"],
      skipped: false,
    });

    client.diagnose.mockRejectedValue(new Error("timeout"));

    const result = await handler({ args: "" });

    expect(result.text).toContain("No API key configured");
  });
});
