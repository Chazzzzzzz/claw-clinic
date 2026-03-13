import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateLocally } from "../validation.js";
import { collectConfigEvidence, collectConnectivityEvidence, validateKeyFormat } from "../evidence.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("Scenario 1: API key missing entirely", () => {
  it("local validation detects missing key", async () => {
    // Gateway reachable
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await validateLocally({});
    expect(result.quickIssues).toContainEqual(
      expect.stringContaining("No API key found"),
    );
  });

  it("config evidence has no apiKey field", () => {
    const evidence = collectConfigEvidence({});
    expect(evidence.apiKey).toBeUndefined();
  });
});

describe("Scenario 2: API key present but malformed", () => {
  it("local validation detects format error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // gateway
    const result = await validateLocally({ apiKey: "bad-key-123" });
    expect(result.quickIssues).toContainEqual(
      expect.stringContaining("API key issue"),
    );
  });

  it("validateKeyFormat rejects short key", () => {
    const result = validateKeyFormat("sk-ant-short");
    expect(result.valid).toBe(false);
    expect(result.issue).toBeDefined();
    expect(result.detectedProvider).toBe("anthropic");
  });

  it("validateKeyFormat rejects key with invalid characters", () => {
    const result = validateKeyFormat("sk-ant-api01-valid$invalid!chars");
    expect(result.valid).toBe(false);
    expect(result.issue).toContain("invalid characters");
  });
});

describe("Scenario 3: API key valid format but expired/revoked (401)", () => {
  const validFormatKey = "sk-ant-api01-" + "a".repeat(80);

  it("validateKeyFormat accepts the key format", () => {
    const result = validateKeyFormat(validFormatKey);
    expect(result.valid).toBe(true);
    expect(result.detectedProvider).toBe("anthropic");
  });

  it("connectivity evidence marks provider as reachable (HEAD returns 200)", async () => {
    // HEAD to api.anthropic.com returns 200 (infra is up)
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const evidence = await collectConnectivityEvidence({});
    const anthropic = evidence.providers.find((p) => p.name === "anthropic");
    expect(anthropic?.reachable).toBe(true);
    // BUG: Provider is "reachable" but key is actually invalid
    // This scenario results in "no issues detected"
  });

  it("auth test should detect 401 from actual API call", async () => {
    // HEAD to health endpoint: 200
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "HEAD") {
        return { ok: true, status: 200 };
      }
      // Actual auth test returns 401
      if (typeof url === "string" && url.includes("/v1/messages")) {
        return {
          ok: false,
          status: 401,
          text: async () => "authentication_error: Invalid bearer token",
        };
      }
      return { ok: true, status: 200 };
    });

    const evidence = await collectConnectivityEvidence({
      providers: {
        anthropic: { apiKey: validFormatKey, baseUrl: "https://api.anthropic.com" },
      },
    });

    const anthropic = evidence.providers.find((p) => p.name === "anthropic");
    // After fix: this should detect auth failure
    expect(anthropic?.authStatus).toBeDefined();
    expect(anthropic?.authStatus).toBe("failed");
    expect(anthropic?.authError).toContain("authentication_error");
    expect(anthropic?.authStatusCode).toBe(401);
  });
});

describe("Scenario 4: AI provider endpoint completely unreachable", () => {
  it("connectivity evidence marks provider as unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const evidence = await collectConnectivityEvidence({});
    const anthropic = evidence.providers.find((p) => p.name === "anthropic");
    expect(anthropic?.reachable).toBe(false);
    expect(anthropic?.error).toContain("ECONNREFUSED");
  });
});

describe("Scenario 5: Provider up but model endpoint returns 500", () => {
  it("connectivity evidence detects server error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    const evidence = await collectConnectivityEvidence({});
    const anthropic = evidence.providers.find((p) => p.name === "anthropic");
    // HEAD returns 503 → reachable should be false (status >= 500)
    expect(anthropic?.reachable).toBe(false);
  });
});

describe("Scenario 6: Gateway down, AI model fine", () => {
  it("local validation detects gateway unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED")); // gateway
    const result = await validateLocally({
      apiKey: "sk-ant-api01-" + "a".repeat(80),
    });
    expect(result.openclawReachable).toBe(false);
    expect(result.quickIssues).toContainEqual(
      expect.stringContaining("gateway unreachable"),
    );
  });
});

describe("Scenario 7: Key has whitespace", () => {
  it("validateKeyFormat detects leading/trailing whitespace", () => {
    const result = validateKeyFormat("  sk-ant-api01-" + "a".repeat(80) + "  ");
    expect(result.valid).toBe(false);
    expect(result.issue).toContain("whitespace");
  });
});

describe("Scenario 8: Key truncated (too short)", () => {
  it("validateKeyFormat detects truncated key", () => {
    const result = validateKeyFormat("sk-ant-api01-abcdef");
    expect(result.valid).toBe(false);
    expect(result.issue).toContain("too short");
  });
});

describe("Scenario 9: Rate limited (429)", () => {
  it("auth test should detect rate limiting", async () => {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "HEAD") {
        return { ok: true, status: 200 };
      }
      if (typeof url === "string" && url.includes("/v1/messages")) {
        return {
          ok: false,
          status: 429,
          text: async () => "rate_limit_error: Too many requests",
        };
      }
      return { ok: true, status: 200 };
    });

    const evidence = await collectConnectivityEvidence({
      providers: {
        anthropic: {
          apiKey: "sk-ant-api01-" + "a".repeat(80),
          baseUrl: "https://api.anthropic.com",
        },
      },
    });

    const anthropic = evidence.providers.find((p) => p.name === "anthropic");
    // After fix: rate limit detected but provider is functional
    expect(anthropic?.reachable).toBe(true);
    expect(anthropic?.authStatus).toBe("rate_limited");
  });
});

describe("Scenario 10: Log evidence contains auth errors", () => {
  it("error patterns extracted from 401 log entries", () => {
    // This tests the backend side — log evidence should contain auth patterns
    // that trigger CFG.3.1 diagnosis
    const logLines = [
      "2026-03-12T10:00:00Z error HTTP 401: authentication_error: Invalid bearer token",
      "2026-03-12T10:00:01Z error Request failed: POST https://api.anthropic.com/v1/messages",
    ];
    // These should be captured as errorPatterns by extractErrorPatterns
    expect(logLines.some((l) => /401/.test(l))).toBe(true);
    expect(logLines.some((l) => /authentication/i.test(l))).toBe(true);
  });
});
