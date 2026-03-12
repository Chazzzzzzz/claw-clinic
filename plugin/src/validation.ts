import {
  extractApiKey,
  extractEndpoint,
  extractGatewayUrl,
  extractApiKeyFromAuthProfiles,
  validateKeyFormat,
  maskApiKey,
  detectProvider,
} from "./evidence.js";

export interface LocalValidationResult {
  openclawReachable: boolean;
  quickIssues: string[];
  skipped: boolean;
}

/**
 * Quick local checks before hitting the backend.
 * Tries to verify the reported issue exists locally.
 * If OpenClaw is down, skips gracefully.
 */
export async function validateLocally(config: Record<string, unknown>): Promise<LocalValidationResult> {
  const issues: string[] = [];
  let openclawReachable = false;

  // 1. Check if OpenClaw gateway is reachable
  const gatewayUrl = extractGatewayUrl(config) || "http://localhost:4321";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch(`${gatewayUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    openclawReachable = res.ok;
    if (!res.ok) {
      issues.push(`OpenClaw gateway returned ${res.status} at ${gatewayUrl}/health`);
    }
  } catch (err) {
    issues.push(`OpenClaw gateway unreachable at ${gatewayUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Check API key — from config and auth-profiles.json
  let apiKey = extractApiKey(config);
  let keySource = "config";

  if (apiKey === undefined) {
    apiKey = await extractApiKeyFromAuthProfiles();
    keySource = "auth-profiles.json";
  }

  if (apiKey === undefined) {
    issues.push("No API key found in configuration or auth-profiles.json");
  } else if (apiKey === "") {
    issues.push(`API key in ${keySource} is empty`);
  } else {
    const validation = validateKeyFormat(apiKey);
    const masked = maskApiKey(apiKey);
    const provider = detectProvider(apiKey) || "unknown";

    if (!validation.valid && validation.issue) {
      issues.push(`API key issue (${provider}, ${masked}, from ${keySource}): ${validation.issue}`);
    } else if (validation.valid) {
      // Key format is valid — include summary for context
      const typeInfo = validation.keyType ? ` [${validation.keyType}]` : "";
      // No issue — but log for evidence collection
      issues.length; // intentional no-op; valid key is not an issue
      void typeInfo; // used in evidence, not reported as issue
    }
  }

  // 3. Check endpoint configuration
  const endpoint = extractEndpoint(config);
  if (endpoint) {
    try {
      new URL(endpoint);
    } catch {
      issues.push(`Invalid endpoint URL: ${endpoint}`);
    }

    // Quick reachability test
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(endpoint, { method: "HEAD", signal: controller.signal });
      clearTimeout(timeout);
      if (res.status >= 500) {
        issues.push(`Endpoint ${endpoint} returned server error: ${res.status}`);
      }
    } catch (err) {
      issues.push(`Endpoint ${endpoint} unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    openclawReachable,
    quickIssues: issues,
    skipped: false,
  };
}
