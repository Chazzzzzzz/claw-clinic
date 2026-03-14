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

// Mock user-guides
vi.mock("../user-guides.js", () => ({
  getUserGuide: vi.fn().mockReturnValue("Follow the guide."),
  getKeyLengthGuide: vi.fn().mockReturnValue("Key length info."),
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
    treatmentPlan: [
      { id: "step_1", action: "prompt_user", description: "Ask for key", requiresUserInput: true },
    ],
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

describe("/clinic fresh diagnosis with pre-verification", () => {
  it("returns healthy when backend diagnoses an issue but reVerify shows it is already resolved", async () => {
    // Scenario: Backend says CFG.1.2 (API Key Missing), but reVerify finds the key is now present.
    // The reVerify for CFG.1.2 calls collectConfigEvidence and checks apiKey presence.
    const { collectConfigEvidence } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    // Backend returns a diagnosis of "API Key Missing"
    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "CFG.1.2",
        name: "API Key Missing",
        confidence: 0.95,
        severity: "Critical",
        reasoning: "No API key found.",
      },
    }));

    // But when reVerify runs collectConfigEvidence, the key IS present (user fixed it)
    (collectConfigEvidence as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      apiKey: { masked: "sk-ant-a...BCDE", provider: "anthropic" },
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    // Should indicate healthy / resolved — NOT show treatment plan
    expect(result.text).toMatch(/healthy|resolved|no issues/i);
    // Should NOT contain treatment instructions
    expect(result.text).not.toContain("prompt_user");
    expect(result.text).not.toContain("Follow the guide");

    diagnoseMock.mockRestore();
  });

  it("shows diagnosis and treatment when reVerify confirms the issue is still active", async () => {
    // Scenario: Backend says CFG.1.2, reVerify confirms key is still missing.
    const { collectConfigEvidence } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse());

    // reVerify: collectConfigEvidence returns no apiKey → issue still active
    (collectConfigEvidence as ReturnType<typeof vi.fn>).mockReturnValueOnce({});

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    // Should show the diagnosis / treatment — NOT healthy
    expect(result.text).toMatch(/API Key Missing|guide|done/i);
    expect(result.text).not.toMatch(/^Your agent appears healthy/);

    diagnoseMock.mockRestore();
  });

  it("proceeds to treatment for unknown disease codes (reVerify default returns not passed)", async () => {
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "E.1.1",
        name: "Infinite Loop",
        confidence: 0.85,
        severity: "High",
        reasoning: "Agent stuck in a loop.",
      },
      treatmentPlan: [
        { id: "step_1", action: "report", description: "Report loop", requiresUserInput: false },
      ],
    }));

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    // reVerify returns passed=false for unknown codes, so treatment proceeds
    expect(result.text).toMatch(/Fixed|Treatment/i);
    expect(result.text).not.toContain("No action needed");

    diagnoseMock.mockRestore();
  });

  it("skips reVerify when backend returns no diagnosis", async () => {
    // Scenario: Backend finds nothing wrong — diagnosis is null.
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: null,
      treatmentPlan: [],
      summary: "No diagnosis",
    }));

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    // Should return the existing "healthy" message — no reVerify needed
    expect(result.text).toMatch(/healthy|no issues/i);

    diagnoseMock.mockRestore();
  });

  it("returns healthy message for CFG.3.1 when auth is no longer failing", async () => {
    // Scenario: Backend diagnoses auth failure, but re-check shows auth is now OK.
    const { collectConnectivityEvidence } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "CFG.3.1",
        name: "Auth Failure",
        confidence: 0.9,
        severity: "Critical",
        reasoning: "API key rejected by provider.",
      },
    }));

    // reVerify for CFG.3.1 calls collectConnectivityEvidence — no failed providers
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "ok" },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toMatch(/healthy|resolved|no issues/i);

    diagnoseMock.mockRestore();
  });

  it("shows diagnosis for CFG.3.1 when auth is still failing", async () => {
    const { collectConnectivityEvidence } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "CFG.3.1",
        name: "Auth Failure",
        confidence: 0.9,
        severity: "Critical",
        reasoning: "API key rejected by provider.",
      },
      treatmentPlan: [
        { id: "step_1", action: "validate_config", description: "Inspect key", requiresUserInput: false },
        { id: "step_2", action: "prompt_user", description: "Get new key", requiresUserInput: true },
      ],
    }));

    // reVerify: auth still failing
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true, authStatus: "failed", authStatusCode: 401 },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    // Should proceed with diagnosis/treatment, not return healthy
    expect(result.text).toMatch(/Auth Failure|guide|done/i);
    expect(result.text).not.toMatch(/^Your agent appears healthy/);

    diagnoseMock.mockRestore();
  });

  it("returns healthy for CFG.2.1 when endpoint is now reachable", async () => {
    const { collectConnectivityEvidence } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "CFG.2.1",
        name: "Endpoint Misconfiguration",
        confidence: 0.85,
        severity: "High",
        reasoning: "Endpoint unreachable.",
      },
    }));

    // reVerify: all providers reachable now
    (collectConnectivityEvidence as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providers: [
        { name: "anthropic", endpoint: "https://api.anthropic.com", reachable: true },
      ],
    });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toMatch(/healthy|resolved|no issues/i);

    diagnoseMock.mockRestore();
  });

  it("returns healthy for CFG.1.1 when key format is now valid", async () => {
    const { extractApiKey, validateKeyFormat } = await import("../evidence.js");
    const diagnoseMock = vi.spyOn(ClawClinicClient.prototype, "diagnose");

    diagnoseMock.mockResolvedValueOnce(makeDiagnosisResponse({
      diagnosis: {
        icd_ai_code: "CFG.1.1",
        name: "API Key Format Error",
        confidence: 0.8,
        severity: "High",
        reasoning: "Key format unrecognized.",
      },
    }));

    // extractApiKey is called once in runDiagnosis (line 205, for provider detection)
    // and once in reVerify for CFG.1.1 — need to provide values for both calls
    const validKey = "sk-ant-api01-" + "a".repeat(80);
    (extractApiKey as ReturnType<typeof vi.fn>).mockReturnValueOnce(validKey); // provider detection
    (extractApiKey as ReturnType<typeof vi.fn>).mockReturnValueOnce(validKey); // reVerify
    (validateKeyFormat as ReturnType<typeof vi.fn>).mockReturnValueOnce({ valid: true, detectedProvider: "anthropic" });

    const api = createMockApi();
    const client = createMockClient();
    const handler = getClinicHandler(api, client);

    const result = await handler({ args: "" });

    expect(result.text).toMatch(/healthy|resolved|no issues/i);

    diagnoseMock.mockRestore();
  });
});
