import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerClinicChatCommand } from "../commands/chat-clinic.js";
import { ClawClinicClient } from "../client.js";
import type { PluginApi, CommandContext, DiagnosisResponse } from "../types.js";

// ─── Mocks ───────────────────────────────────────────────────────

// Mock evidence collection — we control what reVerify sees
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

// Mock validation — prevent real network calls
vi.mock("../validation.js", () => ({
  validateLocally: vi.fn().mockResolvedValue({
    openclawReachable: true,
    quickIssues: [],
    skipped: false,
  }),
}));

// Mock session-store — prevent filesystem access
vi.mock("../session-store.js", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

// Mock treatment-loop
vi.mock("../treatment-loop.js", () => ({
  runTreatmentLoop: vi.fn().mockResolvedValue({
    status: "resolved",
    stepsCompleted: 1,
    stepsTotal: 1,
    message: "Treatment completed successfully.",
  }),
}));

// Mock notifier
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

// Mock verification-executor
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
  const client = new ClawClinicClient("http://localhost:3000");
  return client;
}

/** Register the command and extract the handler function. */
function getClinicHandler(api: PluginApi, client: ClawClinicClient) {
  registerClinicChatCommand(api, client);
  const registerCall = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
  return registerCall[0].handler as (ctx: CommandContext) => Promise<{ text: string }>;
}

function makeDiagnosisResponse(overrides: Partial<DiagnosisResponse> = {}): DiagnosisResponse {
  return {
    sessionId: "sess-test-1",
    diagnosis: {
      icd_ai_code: "CFG.1.2",
      name: "API Key Missing",
      confidence: 0.95,
      severity: "Critical",
      reasoning: "No API key found in config.",
    },
    differential: [],
    treatmentPlan: [],
    checks: [],
    fixes: [],
    summary: "Missing API key",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: fetch calls for gateway health check succeed
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

describe("/clinic fresh diagnosis with checks and fixes", () => {
  it("shows compact output with checks and fixes when backend returns them", async () => {
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");
    const verifyMock = vi.spyOn(ClawClinicClient.prototype, "verify");
    const { collectConnectivityEvidence } = await import("../evidence.js");

    // Backend verify returns no steps (so reVerify falls through to connectivity fallback)
    verifyMock.mockResolvedValueOnce({ diseaseCode: "CFG.3.1", diseaseName: "Auth Failure", steps: [] });

    // Connectivity fallback: auth still failing (issue is active)
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "failed", authStatusCode: 401 },
      ],
    });

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "CFG.3.1",
        name: "Auth Failure",
        confidence: 0.9,
        severity: "Critical",
        reasoning: "API key rejected by provider.",
      },
      checks: [
        { type: "check_connectivity", target: "anthropic", expect: "reachable", label: "Anthropic API reachable" },
      ],
      fixes: [
        { label: "Paste new key", description: "Paste your API key here" },
        { label: "Run config command", command: "openclaw config set anthropic.apiKey YOUR_KEY", description: "Set key via CLI" },
      ],
    }));

    // Mock executeVerificationPlan for the checks
    const { executeVerificationPlan } = await import("../verification-executor.js");
    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: false,
      results: [
        {
          step: { type: "check_connectivity", description: "Anthropic API reachable", target: "anthropic", expect: "reachable" },
          passed: false,
          error: "auth failed (HTTP 401)",
        },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toContain("**Auth Failure**");
    expect(result.text).toContain("Checked:");
    expect(result.text).toContain("\u2717 Anthropic API reachable");
    expect(result.text).toContain("To fix");
    expect(result.text).toContain("1. Paste new key");
    expect(result.text).toContain("2. Run config command");
    expect(result.text).toContain("Reply 1-2 to apply");

    diagnoseMock.mockRestore();
    verifyMock.mockRestore();
  });

  it("saves fixes in session for later selection", async () => {
    const { saveSession } = await import("../session-store.js");
    const { collectConnectivityEvidence } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");
    const verifyMock = vi.spyOn(ClawClinicClient.prototype, "verify");

    verifyMock.mockResolvedValueOnce({ diseaseCode: "CFG.1.2", diseaseName: "API Key Missing", steps: [] });

    // Connectivity fallback: issue still active
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "failed", authStatusCode: 401 },
      ],
    });

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      fixes: [
        { label: "Add key", command: "openclaw config set anthropic.apiKey KEY", description: "Add your key" },
      ],
    }));

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    await handler({ args: "" });

    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingStepId: "fix_selection",
        pendingFixes: [{ label: "Add key", command: "openclaw config set anthropic.apiKey KEY", description: "Add your key" }],
      }),
    );

    diagnoseMock.mockRestore();
    verifyMock.mockRestore();
  });

  it("returns healthy when no diagnosis", async () => {
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: null,
      treatmentPlan: [],
      checks: [],
      fixes: [],
      summary: "No diagnosis",
    }));

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toMatch(/healthy|no issues/i);

    diagnoseMock.mockRestore();
  });

  it("falls back to treatment loop when no checks/fixes", async () => {
    const { collectConnectivityEvidence } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");
    const verifyMock = vi.spyOn(ClawClinicClient.prototype, "verify");

    verifyMock.mockResolvedValueOnce({ diseaseCode: "E.1.1", diseaseName: "Infinite Loop", steps: [] });

    // Connectivity fallback: provider unreachable (issue still active)
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: false, error: "timeout" },
      ],
    });

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "E.1.1",
        name: "Infinite Loop",
        confidence: 0.85,
        severity: "High",
        reasoning: "Agent stuck in a loop.",
      },
      checks: [],
      fixes: [],
      treatmentPlan: [
        { id: "step_1", action: "report", description: "Report loop", requiresUserInput: false },
      ],
    }));

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    // Should use fallback treatment loop (runTreatmentLoop mock returns resolved)
    expect(result.text).toMatch(/Fixed|Treatment/i);

    diagnoseMock.mockRestore();
    verifyMock.mockRestore();
  });
});

describe("/clinic follow-up with numeric fix selection", () => {
  it("selects a fix by number and shows the command", async () => {
    const { loadSession, saveSession } = await import("../session-store.js");

    const pendingSession = {
      sessionId: "sess-1",
      pendingStepId: "fix_selection",
      pendingPrompt: "Reply 1-2",
      diagnosisCode: "CFG.3.1",
      diagnosisName: "Auth Failure",
      createdAt: new Date().toISOString(),
      pendingFixes: [
        { label: "Paste new key", description: "Paste your API key" },
        { label: "Run config command", command: "openclaw config set anthropic.apiKey KEY", description: "Set via CLI" },
      ],
    };

    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pendingSession);

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "2" });

    expect(result.text).toContain("openclaw config set anthropic.apiKey KEY");
    expect(result.text).toContain("/clinic done");

    // Should save session for re-verification
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingStepId: "awaiting_fix",
      }),
    );
  });

  it("selects a fix without a command and shows description", async () => {
    const { loadSession } = await import("../session-store.js");

    const pendingSession = {
      sessionId: "sess-1",
      pendingStepId: "fix_selection",
      pendingPrompt: "Reply 1",
      diagnosisCode: "CFG.3.1",
      diagnosisName: "Auth Failure",
      createdAt: new Date().toISOString(),
      pendingFixes: [
        { label: "Paste new key", description: "Go to console.anthropic.com and create a new key, then paste it here." },
      ],
    };

    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pendingSession);

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "1" });

    expect(result.text).toContain("Go to console.anthropic.com");
    expect(result.text).toContain("/clinic done");
  });

  it("rejects out-of-range fix number", async () => {
    const { loadSession } = await import("../session-store.js");

    const pendingSession = {
      sessionId: "sess-1",
      pendingStepId: "fix_selection",
      pendingPrompt: "Reply 1-2",
      diagnosisCode: "CFG.3.1",
      diagnosisName: "Auth Failure",
      createdAt: new Date().toISOString(),
      pendingFixes: [
        { label: "Fix A", description: "desc A" },
        { label: "Fix B", description: "desc B" },
      ],
    };

    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pendingSession);

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "5" });

    expect(result.text).toBe("Pick 1-2");
  });

  it("shows help text for unknown input when fixes are pending", async () => {
    const { loadSession } = await import("../session-store.js");

    const pendingSession = {
      sessionId: "sess-1",
      pendingStepId: "fix_selection",
      pendingPrompt: "Reply 1-2",
      diagnosisCode: "CFG.3.1",
      diagnosisName: "Auth Failure",
      createdAt: new Date().toISOString(),
      pendingFixes: [
        { label: "Fix A", description: "desc A" },
        { label: "Fix B", description: "desc B" },
      ],
    };

    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pendingSession);

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "what do I do" });

    expect(result.text).toContain("Reply 1-2 to pick a fix");
    expect(result.text).toContain("/clinic done");
  });
});

describe("/clinic done re-verification", () => {
  it("clears session when re-verify passes on /clinic done", async () => {
    const { loadSession, clearSession } = await import("../session-store.js");
    const { collectConnectivityEvidence } = await import("../evidence.js");
    const verifyMock = vi.spyOn(ClawClinicClient.prototype, "verify");

    // Backend verify returns no steps, so fallback connectivity check runs
    verifyMock.mockResolvedValueOnce({ diseaseCode: "CFG.3.1", diseaseName: "Auth Failure", steps: [], });

    const pendingSession = {
      sessionId: "sess-1",
      pendingStepId: "awaiting_fix",
      pendingPrompt: "openclaw config set ...",
      diagnosisCode: "CFG.3.1",
      diagnosisName: "Auth Failure",
      createdAt: new Date().toISOString(),
    };

    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pendingSession);
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "ok" },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "done" });

    expect(result.text).toContain("Auth Failure");
    expect(result.text).toContain("Fixed");
    expect(clearSession).toHaveBeenCalled();

    verifyMock.mockRestore();
  });

  it("shows still-detected when re-verify fails on /clinic done", async () => {
    const { loadSession } = await import("../session-store.js");
    const { collectConnectivityEvidence } = await import("../evidence.js");
    const verifyMock = vi.spyOn(ClawClinicClient.prototype, "verify");

    verifyMock.mockResolvedValueOnce({ diseaseCode: "CFG.3.1", diseaseName: "Auth Failure", steps: [], });

    const pendingSession = {
      sessionId: "sess-1",
      pendingStepId: "awaiting_fix",
      pendingPrompt: "openclaw config set ...",
      diagnosisCode: "CFG.3.1",
      diagnosisName: "Auth Failure",
      createdAt: new Date().toISOString(),
    };

    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pendingSession);
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "failed", authStatusCode: 401 },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "done" });

    expect(result.text).toContain("Auth Failure");
    expect(result.text).toContain("still detected");

    verifyMock.mockRestore();
  });
});

describe("/clinic follow-up with pasted API key", () => {
  it("accepts a valid pasted API key and verifies it", async () => {
    const { loadSession, clearSession } = await import("../session-store.js");
    const { detectProvider, validateKeyFormat, writeApiKeyToAuthProfiles, collectConnectivityEvidence } = await import("../evidence.js");
    const verifyMock = vi.spyOn(ClawClinicClient.prototype, "verify");
    const treatMock = vi.spyOn(ClawClinicClient.prototype, "treat");

    verifyMock.mockResolvedValueOnce({ diseaseCode: "CFG.3.1", diseaseName: "Auth Failure", steps: [], });
    treatMock.mockResolvedValueOnce({ status: "resolved", message: "Done", sessionId: "sess-1" });

    const pendingSession = {
      sessionId: "sess-1",
      pendingStepId: "step_1",
      pendingPrompt: "Paste your key",
      diagnosisCode: "CFG.3.1",
      diagnosisName: "Auth Failure",
      createdAt: new Date().toISOString(),
    };

    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(pendingSession);
    (detectProvider as ReturnType<typeof vi.fn>).mockReturnValueOnce("anthropic");
    (validateKeyFormat as ReturnType<typeof vi.fn>).mockReturnValueOnce({ valid: true });
    (writeApiKeyToAuthProfiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true });
    // Re-verify connectivity passes
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [{ name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "ok" }],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "sk-ant-api01-testkey" });

    expect(result.text).toContain("working");
    expect(result.text).toContain("fixed");
    expect(clearSession).toHaveBeenCalled();

    verifyMock.mockRestore();
    treatMock.mockRestore();
  });
});

describe("/clinic pre-verification", () => {
  it("returns resolved when reVerify shows issue already fixed (no symptoms)", async () => {
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");
    const verifyMock = vi.spyOn(ClawClinicClient.prototype, "verify");
    const { executeVerificationPlan } = await import("../verification-executor.js");

    // Backend verify returns steps that pass
    verifyMock.mockResolvedValueOnce({
      diseaseCode: "CFG.1.2",
      diseaseName: "API Key Missing",
      steps: [{ id: "v1", type: "check_config", description: "Check API key", instruction: "Verify key exists", confidence: "high" as const, params: { target: "apiKey", expect: "present" }, successCondition: "key present" }],
    });

    (executeVerificationPlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      passed: true,
      results: [{ step: { type: "check_config", description: "Check API key" }, passed: true }],
    });

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse());

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toMatch(/resolved|no action/i);

    diagnoseMock.mockRestore();
    verifyMock.mockRestore();
  });

  it("skips reVerify shortcut when backend returns no diagnosis", async () => {
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: null,
      treatmentPlan: [],
      checks: [],
      fixes: [],
    }));

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toMatch(/healthy|no issues/i);

    diagnoseMock.mockRestore();
  });
});
