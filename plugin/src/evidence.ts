import type { ConfigEvidence } from "./types.js";

/** Known API key format patterns by provider. */
const KEY_PATTERNS: Record<string, RegExp> = {
  anthropic: /^sk-ant-[a-zA-Z0-9_-]{20,}$/,
  openai: /^sk-[a-zA-Z0-9_-]{20,}$/,
  google: /^AIza[a-zA-Z0-9_-]{30,}$/,
};

/** Mask an API key for safe logging (show first 8 chars + last 4). */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/** Detect which provider a key belongs to based on its prefix. */
export function detectProvider(key: string): string | undefined {
  for (const [provider, pattern] of Object.entries(KEY_PATTERNS)) {
    if (pattern.test(key)) return provider;
  }
  // Fallback prefix detection
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  if (key.startsWith("AIza")) return "google";
  return undefined;
}

/** Validate an API key format against known patterns. */
export function validateKeyFormat(key: string, expectedProvider?: string): {
  valid: boolean;
  detectedProvider?: string;
  issue?: string;
} {
  if (!key || key.trim().length === 0) {
    return { valid: false, issue: "API key is empty" };
  }

  const trimmed = key.trim();
  if (trimmed !== key) {
    return { valid: false, detectedProvider: detectProvider(trimmed), issue: "API key contains leading or trailing whitespace" };
  }

  const provider = detectProvider(key);
  if (expectedProvider && provider && provider !== expectedProvider) {
    return { valid: false, detectedProvider: provider, issue: `Key appears to be for ${provider}, but expected ${expectedProvider}` };
  }

  if (provider) {
    const pattern = KEY_PATTERNS[provider];
    if (pattern && !pattern.test(key)) {
      return { valid: false, detectedProvider: provider, issue: `Key prefix matches ${provider} but format is invalid (wrong length or characters)` };
    }
    return { valid: true, detectedProvider: provider };
  }

  return { valid: false, issue: "Key format does not match any known provider pattern" };
}

/** Collect config evidence from an OpenClaw plugin API context. */
export function collectConfigEvidence(config: Record<string, unknown>): ConfigEvidence {
  const evidence: ConfigEvidence = { type: "config" };

  // Try to extract API key info from various config locations
  const apiKey = extractApiKey(config);
  if (apiKey !== undefined) {
    const masked = apiKey ? maskApiKey(apiKey) : "(empty)";
    const provider = apiKey ? detectProvider(apiKey) : undefined;
    evidence.apiKey = { masked, provider };
  }

  // Try to extract endpoint info
  const endpoint = extractEndpoint(config);
  if (endpoint) {
    evidence.endpoint = { url: endpoint };
  }

  return evidence;
}

/** Extract API key from nested config structures. */
function extractApiKey(config: Record<string, unknown>): string | undefined {
  // Direct keys
  const directKeys = ["apiKey", "api_key", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
  for (const key of directKeys) {
    if (typeof config[key] === "string") return config[key] as string;
  }

  // Nested under providers
  const providers = config.providers ?? config.modelProviders;
  if (providers && typeof providers === "object") {
    for (const val of Object.values(providers as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const nested = val as Record<string, unknown>;
        if (typeof nested.apiKey === "string") return nested.apiKey;
        if (typeof nested.api_key === "string") return nested.api_key;
      }
    }
  }

  return undefined;
}

/** Extract endpoint URL from config. */
function extractEndpoint(config: Record<string, unknown>): string | undefined {
  const keys = ["baseUrl", "base_url", "endpoint", "apiEndpoint"];
  for (const key of keys) {
    if (typeof config[key] === "string") return config[key] as string;
  }

  const providers = config.providers ?? config.modelProviders;
  if (providers && typeof providers === "object") {
    for (const val of Object.values(providers as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const nested = val as Record<string, unknown>;
        if (typeof nested.baseUrl === "string") return nested.baseUrl;
        if (typeof nested.base_url === "string") return nested.base_url;
      }
    }
  }

  return undefined;
}
