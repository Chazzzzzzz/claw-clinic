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

// Mock verification-executor
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

  it("skips treatment and returns resolved when backend verify passes", async () => {
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
      checks: [],
      fixes: [],
    });

    // Backend verify returns steps
    client.verify.mockResolvedValue({
      diseaseCode: "CFG.1.2",
      diseaseName: "API Key Missing",
      steps: [{
        id: "v1", type: "check_config", description: "Check API key",
        instruction: "Check key", confidence: "high",
        params: { target: "apiKey", expect: "present" },
        successCondition: "key present",
      }],
    });

    // Verification plan passes (key now exists)
    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: true,
      results: [{ step: { type: "check_config", description: "Check API key" }, passed: true }],
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("resolved");
    expect(result.text).toContain("API Key Missing");
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).not.toHaveBeenCalled();
  });

  it("proceeds with treatment when backend verify fails", async () => {
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
      checks: [],
      fixes: [],
    });

    // Backend verify returns steps
    client.verify.mockResolvedValue({
      diseaseCode: "CFG.1.2",
      diseaseName: "API Key Missing",
      steps: [{
        id: "v1", type: "check_config", description: "Check API key",
        instruction: "Check key", confidence: "high",
        params: { target: "apiKey", expect: "present" },
        successCondition: "key present",
      }],
    });

    // Verification plan fails (key still missing)
    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: false,
      results: [{ step: { type: "check_config", description: "Check API key" }, passed: false, error: "Key missing" }],
    });

    const result = await handler({ args: "" });

    expect(result.text).not.toContain("resolved");
    expect(result.text).toContain("API Key Missing");
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });

  it("returns resolved for auth failure (CFG.3.1) when re-verification passes", async () => {
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
      checks: [],
      fixes: [],
    });

    // Backend verify returns steps that pass
    client.verify.mockResolvedValue({
      diseaseCode: "CFG.3.1",
      diseaseName: "Auth Failure",
      steps: [{
        id: "v1", type: "check_connectivity", description: "Check auth",
        instruction: "Check auth", confidence: "high",
        params: { target: "anthropic" },
        successCondition: "auth ok",
      }],
    });

    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: true,
      results: [{ step: { type: "check_connectivity", description: "Check auth" }, passed: true }],
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
      checks: [],
      fixes: [],
    });

    const result = await handler({ args: "" });

    expect(result.text).toContain("healthy");
    expect(result.text).toContain("No issues detected");
  });

  it("proceeds to treatment when backend verify times out", async () => {
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
      checks: [],
      fixes: [],
    });

    // Backend verify throws (timeout)
    client.verify.mockRejectedValue(new Error("timeout"));

    // Connectivity fallback: providers have issues
    const { collectConnectivityEvidence } = await import("../evidence.js");
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "connectivity",
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: false, error: "timeout" },
      ],
    });

    const result = await handler({ args: "" });

    expect(result.text).not.toContain("No action needed");
    expect(result.text).toBeDefined();
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });
});

describe("reVerify with dynamic verification", () => {
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

  it("calls backend verify for all disease codes", async () => {
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
      checks: [],
      fixes: [],
    });

    // Backend verify returns steps that pass → resolved
    client.verify.mockResolvedValue({
      diseaseCode: "CFG.1.2",
      diseaseName: "API Key Missing",
      steps: [{
        id: "v1", type: "check_config", description: "Check API key",
        instruction: "Check key", confidence: "high",
        params: { target: "apiKey", expect: "present" },
        successCondition: "key present",
      }],
    });

    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: true,
      results: [{ step: { type: "check_config", description: "Check API key" }, passed: true }],
    });

    await handler({ args: "" });

    // verify() IS called for all codes now (including CFG)
    expect(client.verify).toHaveBeenCalledWith("CFG.1.2", []);
  });

  it("falls through to connectivity fallback when backend verify returns no steps", async () => {
    client.diagnose.mockResolvedValue({
      sessionId: "sess-empty",
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
      checks: [],
      fixes: [],
    });

    // Backend verify returns no steps
    client.verify.mockResolvedValue({
      diseaseCode: "E.1.1",
      diseaseName: "Infinite Loop",
      steps: [],
    });

    // Connectivity fallback: all providers ok → pre-verify passes → resolved
    const { collectConnectivityEvidence } = await import("../evidence.js");
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "connectivity",
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "ok" },
      ],
    });

    const result = await handler({ args: "" });

    // Should resolve since connectivity passes
    expect(result.text).toContain("resolved");
    expect(client.verify).toHaveBeenCalled();
  });

  it("falls through to connectivity fallback when backend verify is unreachable", async () => {
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
      checks: [],
      fixes: [],
    });

    // Backend verify throws
    client.verify.mockRejectedValue(new Error("ECONNREFUSED"));

    // Connectivity fallback: provider unreachable → treatment proceeds
    const { collectConnectivityEvidence } = await import("../evidence.js");
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "connectivity",
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: false, error: "ECONNREFUSED" },
      ],
    });

    const result = await handler({ args: "" });

    expect(result.text).toBeDefined();
    expect(result.text).not.toContain("ECONNREFUSED");
    const { runTreatmentLoop } = await import("../treatment-loop.js");
    expect(runTreatmentLoop).toHaveBeenCalled();
  });
});
