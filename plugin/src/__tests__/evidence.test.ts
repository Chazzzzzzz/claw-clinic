import { describe, it, expect } from "vitest";
import {
  maskApiKey,
  detectProvider,
  validateKeyFormat,
  collectConfigEvidence,
} from "../evidence.js";

describe("maskApiKey()", () => {
  it("returns *** for short keys (<=12 chars)", () => {
    expect(maskApiKey("short")).toBe("***");
    expect(maskApiKey("exactly12chr")).toBe("***");
  });

  it("shows first 8 and last 4 chars for long keys", () => {
    const key = "sk-ant-abcdefghijklmnop";
    expect(maskApiKey(key)).toBe("sk-ant-a...mnop");
  });
});

describe("detectProvider()", () => {
  it("detects Anthropic keys", () => {
    expect(detectProvider("sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCDE")).toBe("anthropic");
  });

  it("detects OpenAI keys", () => {
    expect(detectProvider("sk-abcdefghijklmnopqrstuvwxyz")).toBe("openai");
  });

  it("detects Google keys", () => {
    expect(detectProvider("AIzaSyAbcdefghijklmnopqrstuvwxyz01234567")).toBe("google");
  });

  it("returns undefined for unknown keys", () => {
    expect(detectProvider("some-random-key")).toBeUndefined();
  });
});

describe("validateKeyFormat()", () => {
  it("rejects empty key", () => {
    const result = validateKeyFormat("");
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("API key is empty");
  });

  it("rejects key with whitespace", () => {
    const result = validateKeyFormat("  sk-ant-abcdefghijklmnopqrstuvwx  ");
    expect(result.valid).toBe(false);
    expect(result.issue).toContain("whitespace");
  });

  it("accepts a valid Anthropic key", () => {
    const result = validateKeyFormat("sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCDE");
    expect(result.valid).toBe(true);
    expect(result.detectedProvider).toBe("anthropic");
  });

  it("rejects when key provider mismatches expected provider", () => {
    const result = validateKeyFormat("sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCDE", "openai");
    expect(result.valid).toBe(false);
    expect(result.issue).toContain("anthropic");
    expect(result.issue).toContain("openai");
  });

  it("rejects unknown format keys", () => {
    const result = validateKeyFormat("totally-unknown-key-format");
    expect(result.valid).toBe(false);
    expect(result.issue).toContain("does not match any known provider");
  });
});

describe("collectConfigEvidence()", () => {
  it("extracts a direct apiKey from config", () => {
    const evidence = collectConfigEvidence({
      apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCDE",
    });
    expect(evidence.type).toBe("config");
    expect(evidence.apiKey).toBeDefined();
    expect(evidence.apiKey!.masked).toBe("sk-ant-a...BCDE");
    expect(evidence.apiKey!.provider).toBe("anthropic");
  });

  it("extracts apiKey nested under providers", () => {
    const evidence = collectConfigEvidence({
      providers: {
        anthropic: {
          apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCDE",
        },
      },
    });
    expect(evidence.apiKey).toBeDefined();
    expect(evidence.apiKey!.provider).toBe("anthropic");
  });

  it("returns no apiKey info when config has no key", () => {
    const evidence = collectConfigEvidence({ somethingElse: true });
    expect(evidence.apiKey).toBeUndefined();
  });

  it("extracts endpoint from direct config keys", () => {
    const evidence = collectConfigEvidence({
      baseUrl: "https://api.anthropic.com",
    });
    expect(evidence.endpoint).toBeDefined();
    expect(evidence.endpoint!.url).toBe("https://api.anthropic.com");
  });

  it("extracts endpoint nested under providers", () => {
    const evidence = collectConfigEvidence({
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
        },
      },
    });
    expect(evidence.endpoint).toBeDefined();
    expect(evidence.endpoint!.url).toBe("https://api.openai.com/v1");
  });

  it("extracts endpoint using alternative key names", () => {
    const evidence = collectConfigEvidence({
      apiEndpoint: "https://custom.endpoint.com",
    });
    expect(evidence.endpoint).toBeDefined();
    expect(evidence.endpoint!.url).toBe("https://custom.endpoint.com");
  });
});
