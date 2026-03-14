import { describe, it, expect } from "vitest";
import { app } from "../../server.js";

async function postVerify(body: unknown) {
  const res = await app.request("/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /verify", () => {
  it("returns a verification plan for E.1.1 (Infinite Loop)", async () => {
    const { status, json } = await postVerify({
      diseaseCode: "E.1.1",
    });

    expect(status).toBe(200);
    expect(json.diseaseCode).toBe("E.1.1");
    expect(json.steps).toBeDefined();
    expect(Array.isArray(json.steps)).toBe(true);
    expect(json.steps.length).toBeGreaterThan(0);

    // Each step should have required fields
    for (const step of json.steps) {
      expect(step.type).toBeDefined();
      expect(step.description).toBeDefined();
    }
  });

  it("returns a verification plan for C.1.1 (Cost Explosion)", async () => {
    const { status, json } = await postVerify({
      diseaseCode: "C.1.1",
    });

    expect(status).toBe(200);
    expect(json.diseaseCode).toBe("C.1.1");
    expect(json.steps.length).toBeGreaterThan(0);
  });

  it("returns a verification plan for O.1.1 (Output Quality)", async () => {
    const { status, json } = await postVerify({
      diseaseCode: "O.1.1",
    });

    expect(status).toBe(200);
    expect(json.diseaseCode).toBe("O.1.1");
    expect(json.steps.length).toBeGreaterThan(0);
  });

  it("returns empty steps for unknown disease codes", async () => {
    const { status, json } = await postVerify({
      diseaseCode: "UNKNOWN.99.99",
    });

    expect(status).toBe(200);
    expect(json.diseaseCode).toBe("UNKNOWN.99.99");
    expect(json.steps).toEqual([]);
  });

  it("returns 400 when diseaseCode is missing", async () => {
    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid request body", async () => {
    const res = await app.request("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
  });

  it("verification plan steps have valid step types", async () => {
    const { json } = await postVerify({ diseaseCode: "E.1.1" });

    const validTypes = [
      "check_file",
      "check_connectivity",
      "check_config",
      "check_process",
      "check_logs",
      "custom",
    ];

    for (const step of json.steps) {
      expect(validTypes).toContain(step.type);
    }
  });

  it("returns O.4.1-specific verification steps for Tool Permission Denial", async () => {
    const { status, json } = await postVerify({
      diseaseCode: "O.4.1",
    });

    expect(status).toBe(200);
    expect(json.diseaseCode).toBe("O.4.1");
    expect(json.diseaseName).toBe("Tool Permission Denial");
    expect(json.steps.length).toBe(3);

    // Should have permission config check, file check, and tool execution check
    const types = json.steps.map((s: { type: string }) => s.type);
    expect(types).toContain("check_config");
    expect(types).toContain("check_file");
    expect(types).toContain("custom");

    // Verify the steps have meaningful descriptions
    const descriptions = json.steps.map((s: { description: string }) => s.description).join(" ");
    expect(descriptions).toMatch(/permission/i);
  });

  it("returns different verification plans for different disease codes", async () => {
    const [loop, cost] = await Promise.all([
      postVerify({ diseaseCode: "E.1.1" }),
      postVerify({ diseaseCode: "C.1.1" }),
    ]);

    // Different diseases should have different verification plans
    // (at minimum, different descriptions or step types)
    expect(loop.json.diseaseCode).not.toBe(cost.json.diseaseCode);
    if (loop.json.steps.length > 0 && cost.json.steps.length > 0) {
      const loopDescriptions = loop.json.steps.map((s: { description: string }) => s.description);
      const costDescriptions = cost.json.steps.map((s: { description: string }) => s.description);
      expect(loopDescriptions).not.toEqual(costDescriptions);
    }
  });
});
