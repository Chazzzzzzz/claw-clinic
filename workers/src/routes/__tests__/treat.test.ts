import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import treatRouter, { createSession, getSession } from "../treat.js";

function buildApp(): Hono {
  const app = new Hono();
  app.route("/treat", treatRouter);
  return app;
}

const TWO_STEPS = [
  { id: "step-1", action: "reboot", description: "Reboot the service", requiresUserInput: false },
  { id: "step-2", action: "verify", description: "Verify the service is up", requiresUserInput: true, inputPrompt: "Is the service healthy?" },
];

describe("POST /treat", () => {
  let app: Hono;

  beforeEach(() => {
    // Reset module-level sessions map by creating fresh sessions per test
    // We rely on createSession to populate the shared map
    app = buildApp();
  });

  it("should return 'next' then 'resolved' when completing steps sequentially", async () => {
    const sessionId = "sess-resolve-" + Date.now();
    createSession(sessionId, "ICD-CLAW-001", TWO_STEPS);

    // Complete step 1 → expect "next"
    const res1 = await app.request("/treat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, stepId: "step-1", stepResult: { success: true } }),
    });
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.status).toBe("next");
    expect(json1.nextStep.id).toBe("step-2");
    expect(json1.sessionId).toBe(sessionId);

    // Complete step 2 → expect "resolved"
    const res2 = await app.request("/treat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, stepId: "step-2", stepResult: { success: true } }),
    });
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.status).toBe("resolved");
    expect(json2.sessionId).toBe(sessionId);

    // Verify session state via getSession
    const session = getSession(sessionId);
    expect(session?.status).toBe("resolved");
    expect(session?.results).toHaveLength(2);
  });

  it("should return 'failed' when a step fails", async () => {
    const sessionId = "sess-fail-" + Date.now();
    createSession(sessionId, "ICD-CLAW-002", TWO_STEPS);

    const res = await app.request("/treat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        stepId: "step-1",
        stepResult: { success: false, error: "service unreachable" },
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("failed");
    expect(json.message).toContain("service unreachable");

    const session = getSession(sessionId);
    expect(session?.status).toBe("failed");
  });

  it("should return 404 when session is not found", async () => {
    const res = await app.request("/treat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "nonexistent", stepId: "step-1", stepResult: { success: true } }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("nonexistent");
  });

  it("should return current status when session is already resolved", async () => {
    const sessionId = "sess-already-" + Date.now();
    createSession(sessionId, "ICD-CLAW-003", [
      { id: "only-step", action: "fix", description: "Fix it", requiresUserInput: false },
    ]);

    // Complete the only step → resolved
    await app.request("/treat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, stepId: "only-step", stepResult: { success: true } }),
    });

    // Try again → should say already resolved
    const res = await app.request("/treat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, stepId: "only-step", stepResult: { success: true } }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("resolved");
    expect(json.message).toContain("already resolved");
  });

  it("should return 400 when sessionId or stepId is missing", async () => {
    const res = await app.request("/treat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "abc" }),
    });
    expect(res.status).toBe(400);
  });
});
