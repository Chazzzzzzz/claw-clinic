import type {
  ConfigEvidence,
  LogEvidence,
  ConnectivityEvidence,
  EnvironmentEvidence,
  RuntimeEvidence,
  Evidence,
} from "./types.js";
import { readFile } from "node:fs/promises";
import { homedir, platform, release, freemem, uptime } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Sensitive Data Sanitization ────────────────────────────────

/** Known API key format patterns by provider. */
/** Known API key format patterns by provider with expected length ranges. */
const KEY_PATTERNS: Record<string, { regex: RegExp; minLen: number; maxLen: number }> = {
  anthropic_api: { regex: /^sk-ant-api\d{2}-[a-zA-Z0-9_-]+$/, minLen: 90, maxLen: 130 },
  anthropic_oauth: { regex: /^sk-ant-oat\d{2}-[a-zA-Z0-9_-]+$/, minLen: 90, maxLen: 130 },
  anthropic_legacy: { regex: /^sk-ant-[a-zA-Z0-9_-]{20,}$/, minLen: 40, maxLen: 130 },
  openai: { regex: /^sk-[a-zA-Z0-9_-]{20,}$/, minLen: 40, maxLen: 200 },
  google: { regex: /^AIza[a-zA-Z0-9_-]{30,}$/, minLen: 35, maxLen: 60 },
};

/** Patterns that look like secrets in arbitrary text. */
const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_-]{10,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /AIza[a-zA-Z0-9_-]{30,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /xoxb-[a-zA-Z0-9-]+/g,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
  /token["':\s]+["']?[a-zA-Z0-9._-]{20,}["']?/gi,
  /password["':\s]+["']?[^\s"']{6,}["']?/gi,
];

/** Mask an API key for safe logging (show first 8 chars + last 4). */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/** Detect which provider a key belongs to based on its prefix. */
export function detectProvider(key: string): string | undefined {
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  if (key.startsWith("AIza")) return "google";
  return undefined;
}

/** Detect specific key type (api, oauth, legacy). */
function detectKeyType(key: string): string | undefined {
  for (const [type, { regex }] of Object.entries(KEY_PATTERNS)) {
    if (regex.test(key)) return type;
  }
  return undefined;
}

/** Validate an API key format against known patterns. */
export function validateKeyFormat(key: string, expectedProvider?: string): {
  valid: boolean;
  detectedProvider?: string;
  keyType?: string;
  issue?: string;
} {
  if (!key || key.trim().length === 0) {
    return { valid: false, issue: "API key is empty" };
  }

  const trimmed = key.trim();
  if (trimmed !== key) {
    return { valid: false, detectedProvider: detectProvider(trimmed), issue: "API key contains leading or trailing whitespace" };
  }

  // Check for invalid characters
  if (/[^a-zA-Z0-9_-]/.test(key)) {
    return { valid: false, detectedProvider: detectProvider(key), issue: "API key contains invalid characters (only alphanumeric, underscore, hyphen allowed)" };
  }

  const provider = detectProvider(key);
  if (expectedProvider && provider && provider !== expectedProvider) {
    return { valid: false, detectedProvider: provider, issue: `Key appears to be for ${provider}, but expected ${expectedProvider}` };
  }

  if (provider) {
    const keyType = detectKeyType(key);

    if (keyType) {
      const spec = KEY_PATTERNS[keyType];
      // Check length
      if (key.length < spec.minLen) {
        return { valid: false, detectedProvider: provider, keyType, issue: `Key too short (${key.length} chars, expected at least ${spec.minLen}). It may be truncated.` };
      }
      if (key.length > spec.maxLen) {
        return { valid: false, detectedProvider: provider, keyType, issue: `Key too long (${key.length} chars, expected at most ${spec.maxLen}). It may contain extra characters.` };
      }
      return { valid: true, detectedProvider: provider, keyType };
    }

    // Provider matched by prefix but no specific pattern matched
    return { valid: false, detectedProvider: provider, issue: `Key prefix matches ${provider} but format is unrecognized. It may be corrupted or from an unsupported key type.` };
  }

  return { valid: false, issue: `Key format does not match any known provider (length: ${key.length} chars)` };
}

/** Redact secrets from arbitrary text. */
function sanitizeText(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.length <= 12) return "***REDACTED***";
      return `${match.slice(0, 8)}...***REDACTED***`;
    });
  }
  return result;
}

/** Deep-sanitize an object: redact known secret keys, mask API key values. */
function sanitizeConfig(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = /apiKey|api_key|secret|password|token|credential|auth/i;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.test(key) && typeof value === "string") {
      result[key] = maskApiKey(value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeConfig(value as Record<string, unknown>);
    } else if (typeof value === "string" && value.length > 20) {
      result[key] = sanitizeText(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Evidence Collectors ────────────────────────────────────────

/** Collect config evidence from the OpenClaw plugin API context. */
export function collectConfigEvidence(config: Record<string, unknown>): ConfigEvidence {
  const evidence: ConfigEvidence = { type: "config" };

  const apiKey = extractApiKey(config);
  if (apiKey !== undefined) {
    const masked = apiKey ? maskApiKey(apiKey) : "(empty)";
    const provider = apiKey ? detectProvider(apiKey) : undefined;
    const validation = apiKey ? validateKeyFormat(apiKey) : undefined;
    evidence.apiKey = {
      masked,
      provider,
      ...(validation && !validation.valid ? {} : {}),
    };
    // Include validation issue in errorLogs if key is invalid
    if (validation && !validation.valid && validation.issue) {
      evidence.errorLogs = [...(evidence.errorLogs || []), `API key issue: ${validation.issue}`];
    }
  }

  const endpoint = extractEndpoint(config);
  if (endpoint) {
    evidence.endpoint = { url: endpoint };
  }

  // Include sanitized raw config for deeper analysis
  evidence.rawConfig = sanitizeConfig(config);

  return evidence;
}

/** Read and sanitize openclaw.json config file. */
export async function collectFullConfig(): Promise<ConfigEvidence> {
  const evidence: ConfigEvidence = { type: "config" };

  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    evidence.rawConfig = sanitizeConfig(parsed);

    // Extract API key from main config first
    let apiKey = extractApiKey(parsed);

    // Also check auth-profiles.json where API keys are typically stored
    if (apiKey === undefined) {
      apiKey = await extractApiKeyFromAuthProfiles();
    }

    if (apiKey !== undefined) {
      evidence.apiKey = {
        masked: apiKey ? maskApiKey(apiKey) : "(empty)",
        provider: apiKey ? detectProvider(apiKey) : undefined,
      };
      const validation = apiKey ? validateKeyFormat(apiKey) : undefined;
      if (validation && !validation.valid && validation.issue) {
        evidence.errorLogs = [`API key issue: ${validation.issue}`];
      }
    }

    // Extract endpoint info
    const endpoint = extractEndpoint(parsed);
    if (endpoint) {
      evidence.endpoint = { url: endpoint };
    }
  } catch (err) {
    evidence.errorLogs = [`Failed to read openclaw.json: ${err instanceof Error ? err.message : String(err)}`];
  }

  return evidence;
}

/**
 * Extract API key from auth-profiles.json.
 *
 * Structure:
 * {
 *   "version": 1,
 *   "profiles": {
 *     "anthropic:default": { "type": "token", "provider": "anthropic", "token": "sk-ant-..." },
 *     ...
 *   },
 *   "lastGood": { "anthropic": "anthropic:default" }
 * }
 */
export async function extractApiKeyFromAuthProfiles(): Promise<string | undefined> {
  const paths = [
    join(homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json"),
    join(homedir(), ".openclaw", "agents", "default", "agent", "auth-profiles.json"),
  ];

  for (const authPath of paths) {
    try {
      const raw = await readFile(authPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      const profiles = parsed.profiles as Record<string, unknown> | undefined;
      if (!profiles) continue;

      // Try lastGood profile first, then iterate all
      const lastGood = parsed.lastGood as Record<string, string> | undefined;
      const profileOrder = lastGood
        ? [...new Set([...Object.values(lastGood), ...Object.keys(profiles)])]
        : Object.keys(profiles);

      for (const profileId of profileOrder) {
        const profile = profiles[profileId] as Record<string, unknown> | undefined;
        if (!profile) continue;

        const token = profile.token as string | undefined;
        if (typeof token === "string" && token.length > 0) return token;

        // Fallback: check other common key fields
        const key = (profile.apiKey ?? profile.api_key ?? profile.key) as string | undefined;
        if (typeof key === "string" && key.length > 0) return key;
      }
    } catch {
      // File may not exist
    }
  }
  return undefined;
}

/** Collect recent gateway logs, sanitized. */
export async function collectLogEvidence(maxLines = 200): Promise<LogEvidence> {
  const evidence: LogEvidence = { type: "log", entries: [] };

  const logPaths = [
    join(homedir(), ".openclaw", "logs", "gateway.log"),
    join(homedir(), ".openclaw", "logs", "gateway.err.log"),
  ];

  for (const logPath of logPaths) {
    try {
      const content = await readFile(logPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      // Take the most recent lines
      const recent = lines.slice(-maxLines);
      evidence.entries.push(...recent.map(sanitizeText));
    } catch {
      // Log file may not exist, that's fine
    }
  }

  // Extract error patterns
  evidence.errorPatterns = extractErrorPatterns(evidence.entries);

  return evidence;
}

/** Known auth test endpoints for providers. */
const PROVIDER_AUTH_ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/models",
};

/** Build auth headers for a provider. */
function buildAuthHeaders(providerName: string, apiKey: string): Record<string, string> {
  if (providerName.startsWith("anthropic")) {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
  }
  // Default: Bearer token (OpenAI and most others)
  return {
    "authorization": `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

/** Classify auth test HTTP status. */
function classifyAuthStatus(status: number): "ok" | "failed" | "rate_limited" | "server_error" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 400) return "ok"; // Bad request means auth passed but payload invalid — that's fine
  if (status === 401 || status === 403) return "failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "ok"; // 3xx, other 4xx — auth likely passed
}

/** Test connectivity to known AI provider endpoints. */
export async function collectConnectivityEvidence(config: Record<string, unknown>): Promise<ConnectivityEvidence> {
  const evidence: ConnectivityEvidence = {
    type: "connectivity",
    providers: [],
  };

  // Build list of providers to test from config + known defaults
  const providersToTest = getProvidersFromConfig(config);

  // Resolve API keys: try config providers first, then auth-profiles
  let authProfileKey: string | undefined;
  try {
    authProfileKey = await extractApiKeyFromAuthProfiles();
  } catch {
    // ignore
  }

  // Test each provider in parallel: reachability + auth
  const results = await Promise.allSettled(
    providersToTest.map(async (provider) => {
      const start = Date.now();
      let reachable = false;
      let statusCode: number | undefined;
      let error: string | undefined;
      let authStatus: "ok" | "failed" | "rate_limited" | "server_error" | "untested" = "untested";
      let authError: string | undefined;
      let authStatusCode: number | undefined;

      // Step 1: Basic reachability (HEAD)
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(provider.healthEndpoint, {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        reachable = res.status < 500;
        statusCode = res.status;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      // Step 2: Actual auth test (if reachable and we have a key)
      // Only use authProfileKey as fallback if it matches this provider
      let apiKey = provider.apiKey;
      if (!apiKey && authProfileKey) {
        const keyProvider = detectProvider(authProfileKey);
        if (keyProvider === provider.name || keyProvider?.startsWith(provider.name)) {
          apiKey = authProfileKey;
        }
      }
      if (reachable && apiKey && provider.authTestEndpoint) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          // Send minimal request to auth endpoint — we expect 400 (bad body) if auth passes
          const res = await fetch(provider.authTestEndpoint, {
            method: "POST",
            headers: buildAuthHeaders(provider.name, apiKey),
            body: JSON.stringify({}),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          authStatusCode = res.status;
          authStatus = classifyAuthStatus(res.status);
          if (authStatus === "failed" || authStatus === "server_error") {
            try {
              authError = await res.text();
            } catch {
              authError = `HTTP ${res.status}`;
            }
          }
        } catch (err) {
          authStatus = "server_error";
          authError = err instanceof Error ? err.message : String(err);
        }
      }

      return {
        name: provider.name,
        endpoint: provider.healthEndpoint,
        reachable,
        latencyMs: Date.now() - start,
        statusCode,
        error,
        authStatus,
        authError,
        authStatusCode,
      };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      evidence.providers.push(result.value);
    }
  }

  // Test OpenClaw gateway itself
  try {
    const start = Date.now();
    const gatewayUrl = extractGatewayUrl(config) || "http://localhost:4321";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    await fetch(`${gatewayUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    evidence.gatewayReachable = true;
    evidence.gatewayLatencyMs = Date.now() - start;
  } catch {
    evidence.gatewayReachable = false;
  }

  return evidence;
}

/** Collect environment information. */
export async function collectEnvironmentEvidence(): Promise<EnvironmentEvidence> {
  const evidence: EnvironmentEvidence = {
    type: "environment",
    os: `${platform()} ${release()}`,
    nodeVersion: process.version,
    memoryUsageMb: Math.round(freemem() / 1024 / 1024),
    uptimeSeconds: Math.round(uptime()),
  };

  // Try to get OpenClaw version
  try {
    const { stdout } = await execFileAsync("openclaw", ["--version"], { timeout: 5_000 });
    evidence.openclawVersion = stdout.trim();
  } catch {
    // openclaw CLI may not be in PATH
  }

  // Try to get loaded plugins from config
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const plugins = (parsed.plugins as Record<string, unknown>)?.entries as Record<string, unknown> | undefined;
    if (plugins) {
      evidence.plugins = Object.entries(plugins).map(([id, val]) => ({
        id,
        enabled: (val as Record<string, unknown>)?.enabled !== false,
      }));
    }
  } catch {
    // config may not be readable
  }

  return evidence;
}

/** Collect runtime/model information from config. */
export function collectRuntimeEvidence(config: Record<string, unknown>): RuntimeEvidence {
  const evidence: RuntimeEvidence = { type: "runtime" };

  // Extract model info from various config locations
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaultAgent = (agents?.list as unknown[])?.find?.((a) =>
    (a as Record<string, unknown>).name === "default" || (a as Record<string, unknown>).id === "default",
  ) as Record<string, unknown> | undefined;

  if (defaultAgent) {
    evidence.modelName = defaultAgent.model as string | undefined;
    evidence.modelProvider = defaultAgent.provider as string | undefined;
  }

  // Fallback: top-level model config
  if (!evidence.modelName) {
    evidence.modelName = config.model as string | undefined;
  }
  if (!evidence.modelProvider) {
    evidence.modelProvider = config.provider as string | undefined;
  }

  // Context window from config or infer from model name
  evidence.contextWindowSize = inferContextWindow(evidence.modelName);

  return evidence;
}

/** Collect ALL evidence types. Returns array of evidence objects. */
export async function collectAllEvidence(config: Record<string, unknown>): Promise<Evidence[]> {
  const results = await Promise.allSettled([
    collectFullConfig(),
    collectLogEvidence(),
    collectConnectivityEvidence(config),
    collectEnvironmentEvidence(),
    Promise.resolve(collectRuntimeEvidence(config)),
  ]);

  const evidence: Evidence[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      evidence.push(result.value);
    }
  }
  return evidence;
}

// ─── Internal Helpers ───────────────────────────────────────────

export function extractApiKey(config: Record<string, unknown>): string | undefined {
  const directKeys = ["apiKey", "api_key", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
  for (const key of directKeys) {
    if (typeof config[key] === "string") return config[key] as string;
  }

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

export function extractEndpoint(config: Record<string, unknown>): string | undefined {
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

export function extractGatewayUrl(config: Record<string, unknown>): string | undefined {
  const gateway = config.gateway as Record<string, unknown> | undefined;
  if (gateway) {
    const host = (gateway.host as string) || "localhost";
    const port = (gateway.port as number) || 4321;
    return `http://${host}:${port}`;
  }
  return undefined;
}

interface ProviderTestTarget {
  name: string;
  healthEndpoint: string;
  apiKey?: string;
  authTestEndpoint?: string;
}

function getProvidersFromConfig(config: Record<string, unknown>): ProviderTestTarget[] {
  const targets: ProviderTestTarget[] = [];
  const seen = new Set<string>();

  // Extract from config providers
  const providers = config.providers ?? config.modelProviders;
  if (providers && typeof providers === "object") {
    for (const [name, val] of Object.entries(providers as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const nested = val as Record<string, unknown>;
        const baseUrl = (nested.baseUrl ?? nested.base_url) as string | undefined;
        const apiKey = (nested.apiKey ?? nested.api_key ?? nested.token) as string | undefined;
        if (baseUrl && !seen.has(name)) {
          seen.add(name);
          targets.push({
            name,
            healthEndpoint: baseUrl,
            apiKey,
            authTestEndpoint: PROVIDER_AUTH_ENDPOINTS[name] || `${baseUrl}/v1/messages`,
          });
        }
      }
    }
  }

  // Always test known defaults if not already covered
  const defaults: ProviderTestTarget[] = [
    { name: "anthropic", healthEndpoint: "https://api.anthropic.com", authTestEndpoint: "https://api.anthropic.com/v1/messages" },
    { name: "openai", healthEndpoint: "https://api.openai.com", authTestEndpoint: "https://api.openai.com/v1/models" },
  ];

  for (const d of defaults) {
    if (!seen.has(d.name)) {
      targets.push(d);
    }
  }

  return targets;
}

function extractErrorPatterns(lines: string[]): string[] {
  const patterns = new Set<string>();
  const errorRegexes = [
    /error[:\s]+(.{10,80})/i,
    /failed[:\s]+(.{10,80})/i,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /ENOTFOUND/,
    /rate.?limit/i,
    /429\s/,
    /401\s/,
    /403\s/,
    /500\s/,
    /502\s/,
    /503\s/,
  ];

  for (const line of lines) {
    for (const regex of errorRegexes) {
      if (regex.test(line)) {
        // Normalize: take just the pattern match, not the full line
        const match = line.match(regex);
        patterns.add(match?.[1] || match?.[0] || regex.source);
      }
    }
  }

  return [...patterns].slice(0, 50);
}

function inferContextWindow(modelName?: string): number | undefined {
  if (!modelName) return undefined;
  const name = modelName.toLowerCase();
  if (name.includes("opus") || name.includes("sonnet") || name.includes("claude-3")) return 200_000;
  if (name.includes("claude-2")) return 100_000;
  if (name.includes("gpt-4o")) return 128_000;
  if (name.includes("gpt-4-turbo")) return 128_000;
  if (name.includes("gpt-4")) return 8_192;
  if (name.includes("gpt-3.5")) return 16_385;
  return undefined;
}
