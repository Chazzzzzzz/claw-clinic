import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClawClinicClient } from "../client.js";

describe("ClawClinicClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("strips trailing slashes from baseUrl", () => {
      const client = new ClawClinicClient("http://localhost:3000///");
      // Verify by making a health check and inspecting the URL passed to fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "ok", version: "0.1.0" }),
      });
      client.healthCheck();
      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3000/health");
    });
  });

  describe("healthCheck()", () => {
    it("returns status and version on success", async () => {
      const client = new ClawClinicClient("http://localhost:3000");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "ok", version: "0.1.0" }),
      });

      const result = await client.healthCheck();

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3000/health");
      expect(result).toEqual({ status: "ok", version: "0.1.0" });
    });

    it("throws on non-ok response", async () => {
      const client = new ClawClinicClient("http://localhost:3000");
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.healthCheck()).rejects.toThrow(
        "Backend health check failed: 500 Internal Server Error",
      );
    });
  });

  describe("diagnose()", () => {
    it("sends evidence and symptoms, returns parsed response", async () => {
      const client = new ClawClinicClient("http://localhost:3000");
      const evidence = [{ type: "config" as const }];
      const symptoms = "API key not working";
      const mockResponse = {
        sessionId: "sess-1",
        diagnosis: {
          icd_ai_code: "AUTH-001",
          name: "Invalid API Key",
          confidence: 0.9,
          severity: "high",
          reasoning: "Key format mismatch",
        },
        differential: [],
        treatmentPlan: [],
        summary: "Invalid key detected",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.diagnose(evidence, symptoms);

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3000/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidence, symptoms }),
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe("treat()", () => {
    it("sends step result and returns parsed response", async () => {
      const client = new ClawClinicClient("http://localhost:3000");
      const mockResponse = {
        status: "next" as const,
        nextStep: {
          id: "step-2",
          action: "test_connection" as const,
          description: "Test the connection",
          requiresUserInput: false,
        },
        message: "Proceeding to next step",
        sessionId: "sess-1",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.treat("sess-1", "step-1", {
        success: true,
        data: { key: "value" },
      });

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3000/treat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "sess-1",
          stepId: "step-1",
          stepResult: { success: true, data: { key: "value" } },
        }),
      });
      expect(result).toEqual(mockResponse);
    });
  });
});
