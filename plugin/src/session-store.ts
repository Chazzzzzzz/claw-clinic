import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface StoredSession {
  sessionId: string;
  pendingStepId: string;
  pendingPrompt: string;
  diagnosisCode: string;
  diagnosisName: string;
  createdAt: string;
  detectedProvider?: string;
  isNovelCode?: boolean;
  pendingFixes?: Array<{ label: string; command?: string; description: string }>;
  pendingCommand?: string;
  pendingToolId?: string;       // Tool call ID awaiting user approval
  conversation?: Array<{        // Multi-turn conversation history for /consult
    role: "user" | "assistant";
    content: string | unknown[];
  }>;
}

const SESSION_DIR = join(homedir(), ".openclaw", "claw-clinic");
const SESSION_FILE = join(SESSION_DIR, "session.json");

const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await readFile(SESSION_FILE, "utf-8");
    const session = JSON.parse(raw) as StoredSession;

    // Expire sessions older than 1 hour
    if (session.createdAt) {
      const age = Date.now() - new Date(session.createdAt).getTime();
      if (age > SESSION_MAX_AGE_MS) {
        await clearSession();
        return null;
      }
    }

    return session;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2));
}

export async function clearSession(): Promise<void> {
  try {
    await unlink(SESSION_FILE);
  } catch {
    // already gone
  }
}
