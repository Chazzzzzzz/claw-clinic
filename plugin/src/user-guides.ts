import { KEY_PATTERNS } from "./evidence.js";

/**
 * Provider-specific step-by-step guides for each diagnosis code.
 * Used in chat-clinic.ts to give users actionable instructions.
 */

const GUIDES: Record<string, string> = {
  // ─── CFG.3.1 Auth Failure ──────────────────────────────────────

  "CFG.3.1:anthropic": `Your Anthropic API key is being rejected. Here's how to fix it:

1. Go to https://console.anthropic.com/settings/keys
   (Log in to your Anthropic account if needed.)
2. If your key shows "Disabled" or "Revoked", click "Create Key" to make a new one.
3. Copy the full key — it starts with "sk-ant-" and is about 100 characters long.
4. Paste it here:
   /clinic sk-ant-api01-your-key-here
   I'll save it and verify it works.

Or if you prefer, run this in a terminal:
  openclaw config set anthropic.apiKey YOUR_KEY_HERE
  Then reply: /clinic done`,

  "CFG.3.1:openai": `Your OpenAI API key is being rejected. Here's how to fix it:

1. Go to https://platform.openai.com/api-keys
   (Log in to your OpenAI account if needed.)
2. If your key is missing or expired, click "+ Create new secret key" and copy the full key.
3. Paste it here:
   /clinic sk-your-key-here
   I'll save it and verify it works.

Or if you prefer, run this in a terminal:
  openclaw config set openai.apiKey YOUR_KEY_HERE
  Then reply: /clinic done`,

  "CFG.3.1": `Your API key is being rejected by the provider. Here's how to fix it:

1. Log in to your AI provider's dashboard and check your API keys.
2. If the key is expired or revoked, create a new one.
3. Copy the full key and paste it here:
   /clinic YOUR_NEW_KEY_HERE
   I'll save it and verify it works.

Or if you prefer, run this in a terminal:
  openclaw config set <provider>.apiKey YOUR_KEY_HERE
  Then reply: /clinic done`,

  // ─── CFG.1.2 API Key Missing ──────────────────────────────────

  "CFG.1.2": `No API key found. You need to add one:

1. If you use Anthropic: go to https://console.anthropic.com/settings/keys
   If you use OpenAI: go to https://platform.openai.com/api-keys
2. Create a new key and copy it.
3. Paste it here:
   /clinic YOUR_KEY_HERE
   I'll save it and verify it works.

Or if you prefer, run this in a terminal:
  openclaw config set anthropic.apiKey YOUR_KEY_HERE
  (Replace "anthropic" with "openai" if using OpenAI.)
  Then reply: /clinic done`,

  // ─── CFG.1.1 API Key Format Error ─────────────────────────────

  "CFG.1.1:anthropic": `Your Anthropic API key has a format problem. Anthropic keys should:
- Start with "sk-ant-api" or "sk-ant-oat" (for OAuth tokens)
- Be between 90 and 130 characters long
- Contain only letters, numbers, underscores, and hyphens

To fix:
1. Go to https://console.anthropic.com/settings/keys
2. Create a new key and copy the FULL key (do not truncate).
3. Paste it here:
   /clinic sk-ant-api01-your-full-key-here
   I'll save it and verify the format.

Or run this in a terminal:
  openclaw config set anthropic.apiKey YOUR_NEW_KEY_HERE
  Then reply: /clinic done`,

  "CFG.1.1:openai": `Your OpenAI API key has a format problem. OpenAI keys should:
- Start with "sk-"
- Be between 40 and 200 characters long
- Contain only letters, numbers, underscores, and hyphens

To fix:
1. Go to https://platform.openai.com/api-keys
2. Create a new secret key and copy the FULL key (do not truncate).
3. Paste it here:
   /clinic sk-your-full-key-here
   I'll save it and verify the format.

Or run this in a terminal:
  openclaw config set openai.apiKey YOUR_NEW_KEY_HERE
  Then reply: /clinic done`,

  "CFG.1.1": `Your API key has a format problem. Make sure you copied the entire key without extra spaces or missing characters.

To fix:
1. Go to your AI provider's dashboard and create a new key.
2. Copy the FULL key immediately (it usually can't be viewed again).
3. Paste it here:
   /clinic YOUR_NEW_KEY_HERE
   I'll save it and verify the format.

Or run this in a terminal:
  openclaw config set <provider>.apiKey YOUR_NEW_KEY_HERE
  Then reply: /clinic done`,

  // ─── CFG.2.1 Endpoint Misconfiguration ────────────────────────

  "CFG.2.1": `The API endpoint is unreachable. Try these steps:

1. Check your internet connection — can you reach other websites?
2. If you're on a VPN, try disconnecting it temporarily.
3. Check if a firewall or proxy is blocking outbound HTTPS requests.
4. If you set a custom endpoint, verify it's correct:
   openclaw config get providers
   The default endpoints are:
   - Anthropic: https://api.anthropic.com
   - OpenAI: https://api.openai.com
5. To reset to defaults, remove custom endpoint settings:
   openclaw config unset providers.<name>.baseUrl
6. Reply with: /clinic done`,
};

/**
 * Get a user-facing guide for a diagnosis code and optional provider.
 * Falls back to generic guide for the code, then a generic fallback.
 */
export function getUserGuide(diagnosisCode: string, provider?: string): string {
  if (provider) {
    const specific = GUIDES[`${diagnosisCode}:${provider}`];
    if (specific) return specific;
  }
  const generic = GUIDES[diagnosisCode];
  if (generic) return generic;

  return `Please follow the instructions above and reply with /clinic done when complete.`;
}

/**
 * When a key fails length validation, produce a specific message
 * showing actual length, expected range, and copy-paste advice.
 */
export function getKeyLengthGuide(
  actualLength: number,
  provider?: string,
): string {
  // Find matching key patterns for this provider
  const relevantPatterns = Object.entries(KEY_PATTERNS).filter(([type]) => {
    if (!provider) return true;
    return type.startsWith(provider) || type === provider;
  });

  if (relevantPatterns.length === 0) {
    return (
      `Your API key is ${actualLength} characters long, which doesn't match any known provider format. ` +
      `Make sure you copied the entire key without truncation or extra characters.`
    );
  }

  const ranges = relevantPatterns.map(([type, spec]) => `${type}: ${spec.minLen}–${spec.maxLen} chars`);

  return (
    `Your API key is ${actualLength} characters long. Expected lengths:\n` +
    ranges.map((r) => `  - ${r}`).join("\n") +
    `\n\nMake sure you copied the entire key. API keys can only be viewed once when created — ` +
    `if yours was truncated, you'll need to generate a new one.`
  );
}
