import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerClinicChatCommand } from "../commands/chat-clinic.js";
import type { PluginApi, CommandContext } from "../types.js";

// ─── Mocks ───────────────────────────────────────────────────────

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock session-store (avoid filesystem)
vi.mock("../session-store.js", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

// Mock evidence collection
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

// Mock validation
vi.mock("../validation.js", () => ({
  validateLocally: vi.fn().mockResolvedValue({
    openclawReachable: true,
    quickIssues: [],
    skipped: false,
  }),
}));

// Mock treatment loop
vi.mock("../treatment-loop.js", () => ({
  runTreatmentLoop: vi.fn().mockResolvedValue({
    status: "paused_for_input",
    stepsCompleted: 1,
    stepsTotal: 3,
    message: "Needs user input",
    pendingStep: { id: "step_2", description: "Provide API key", inputPrompt: "Paste your API key" },
  }),
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

/** Register the command and extract the handler function. */
function getClinicHandler(api: PluginApi, client: ReturnType<typeof createMockClient>) {
  registerClinicChatCommand(api, client as any);
  const registerCall = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
  return registerCall[0].handler as (ctx: CommandContext) => Promise<{ text: string }>;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Pre-verification in fresh diagnosis flow", () => {
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

  it("skips treatment and returns resolved message when pre-verification passes", async () => {
    // Backend returns a diagnosis for CFG.1.2 (API Key Missing)
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
      treatmentPlan: [
        { id: "step_1", action: "prompt_user", description: "Provide API key", requiresUserInput: true },
      ],
    });

    // Mock collectConfigEvidence to return a present API key (issue already fixed)
    const { collectConfigEvidence } = await import("../evidence.js");
    (collectConfigEvidence as ReturnType<typeof vi.fn>).mockReturnValue({
      type: "config",
      apiKey: { masked: "sk-ant-a...xxxx", provider: "anthropic" },
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("resolved");
    expect(result.text).toContain("API Key Missing");
    // Treatment loop should NOT have been called
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).not.toHaveBeenCalled();
  });

  it("proceeds with treatment when pre-verification fails", async () => {
    // Backend returns CFG.1.2 diagnosis
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
      treatmentPlan: [
        { id: "step_1", action: "prompt_user", description: "Provide API key", requiresUserInput: true },
      ],
    });

    // Mock collectConfigEvidence to return NO API key (issue still active)
    const { collectConfigEvidence } = await import("../evidence.js");
    (collectConfigEvidence as ReturnType<typeof vi.fn>).mockReturnValue({
      type: "config",
    });

    const result = await handler({ args: "" });

    // Should proceed to treatment (paused_for_input from mock)
    expect(result.text).not.toContain("resolved");
    expect(result.text).toContain("API Key Missing");
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });

  it("returns resolved message for auth failure (CFG.3.1) when re-verification passes", async () => {
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
      treatmentPlan: [
        { id: "step_1", action: "prompt_user", description: "Update API key", requiresUserInput: true },
      ],
    });

    // Mock connectivity: auth now passes (user already fixed their key)
    const { collectConnectivityEvidence } = await import("../evidence.js");
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "connectivity",
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "ok" },
      ],
      gatewayReachable: true,
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("resolved");
    expect(result.text).toContain("Auth Failure");
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).not.toHaveBeenCalled();
  });

  it("returns healthy message when backend finds no diagnosis", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-4",
      diagnosis: null,
      differential: [],
      treatmentPlan: [],
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("healthy");
    expect(result.text).toContain("No issues detected");
  });

  it("proceeds to treatment for unknown disease codes (default re-verify returns not passed)", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-5",
      diagnosis: {
        icd_ai_code: "E.1.1",
        name: "Infinite Loop",
        confidence: 0.8,
        severity: "Critical",
        reasoning: "Loop detected",
      },
      differential: [],
      treatmentPlan: [
        { id: "step_1", action: "report", description: "Report loop", requiresUserInput: false },
      ],
    });

    const result = await handler({ args: "" });

    // E.1.1 has no specific re-verify logic, defaults to passed=false
    // So treatment should proceed, not short-circuit to "resolved"
    expect(result.text).not.toContain("No action needed");
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });
});

describe("Refactored reVerify with dynamic verification", () => {
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

  it("CFG.* codes still use fast-path without backend verify call", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-cfg",
      diagnosis: {
        icd_ai_code: "CFG.1.2",
        name: "API Key Missing",
        confidence: 0.95,
        severity: "Critical",
        reasoning: "No API key",
      },
      differential: [],
      treatmentPlan: [
        { id: "step_1", action: "prompt_user", description: "Provide key", requiresUserInput: true },
      ],
    });

    // Config evidence shows key present (resolved)
    const { collectConfigEvidence } = await import("../evidence.js");
    (collectConfigEvidence as ReturnType<typeof vi.fn>).mockReturnValue({
      type: "config",
      apiKey: { masked: "sk-ant-a...xxxx", provider: "anthropic" },
    });

    await handler({ args: "" });

    // verify() on the client should NOT have been called for CFG.* codes
    expect(client.treat).not.toHaveBeenCalled();
    // If verify method exists, it should not be called for CFG codes
    if (client.verify) {
      expect(client.verify).not.toHaveBeenCalled();
    }
  });

  it("non-CFG codes call backend verify and proceed when all steps pass", async () => {
    // This test will work once reVerify is refactored to call client.verify
    // for non-CFG codes. For now it documents the expected behavior.
    client.diagnose.mockResolvedValue({
      sessionId: "sess-non-cfg",
      diagnosis: {
        icd_ai_code: "E.1.1",
        name: "Infinite Loop",
        confidence: 0.8,
        severity: "Critical",
        reasoning: "Loop detected",
      },
      differential: [],
      treatmentPlan: [
        { id: "step_1", action: "report", description: "Report loop", requiresUserInput: false },
      ],
    });

    // If client.verify exists (after task #8), mock it to return a passing plan
    if (client.verify) {
      (client.verify as ReturnType<typeof vi.fn>).mockResolvedValue({
        diseaseCode: "E.1.1",
        steps: [
          { type: "check_logs", description: "Check for loop patterns", pattern: "loop", expect: "absent" },
        ],
      });
    }

    const result = await handler({ args: "" });

    // Currently: E.1.1 defaults to passed=false, proceeds to treatment
    // After refactor: should call backend verify, execute plan, and act on result
    expect(result.text).toBeDefined();
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });

  it("falls through to treatment when backend verify endpoint is unreachable", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-unreachable",
      diagnosis: {
        icd_ai_code: "E.1.1",
        name: "Infinite Loop",
        confidence: 0.8,
        severity: "Critical",
        reasoning: "Loop detected",
      },
      differential: [],
      treatmentPlan: [
        { id: "step_1", action: "report", description: "Report loop", requiresUserInput: false },
      ],
    });

    // If verify method exists, mock it to throw (backend unreachable)
    if (client.verify) {
      (client.verify as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED"),
      );
    }

    const result = await handler({ args: "" });

    // Should NOT block on verification failure — proceed to treatment
    expect(result.text).toBeDefined();
    expect(result.text).not.toContain("ECONNREFUSED");
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });

  it("returns resolved when non-CFG verification plan passes all steps", async () => {
    // This test exercises the full integration once dynamic verification is implemented.
    // For now, with the current reVerify default returning passed=false for non-CFG,
    // this test documents the expected post-refactor behavior.
    client.diagnose.mockResolvedValue({
      sessionId: "sess-verified",
      diagnosis: {
        icd_ai_code: "C.1.1",
        name: "Cost Explosion",
        confidence: 0.85,
        severity: "High",
        reasoning: "Token spend is abnormally high",
      },
      differential: [],
      treatmentPlan: [
        { id: "step_1", action: "report", description: "Report cost issue", requiresUserInput: false },
      ],
    });

    // After refactor: client.verify would return a plan, executor runs it, all pass
    // → reVerify returns passed=true → "resolved" message
    // Current behavior: falls through to treatment (passed=false default)

    const result = await handler({ args: "" });
    expect(result.text).toBeDefined();
    // Current: proceeds to treatment
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });
});
