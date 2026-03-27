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

  describe("consult()", () => {
    it("sends messages and returns parsed response", async () => {
      const client = new ClawClinicClient("http://localhost:3000");
      const messages = [{ role: "user" as const, content: "test" }];
      const mockResponse = {
        text: "Let me check...",
        toolCalls: [{ id: "t1", name: "run_command", input: { command: "ls", reason: "checking" } }],
        done: false,
        assistantContent: [{ type: "text", text: "Let me check..." }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.consult(messages);

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3000/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      expect(result).toEqual(mockResponse);
    });

    it("throws on non-ok response", async () => {
      const client = new ClawClinicClient("http://localhost:3000");
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal error"),
      });

      await expect(client.consult([{ role: "user", content: "test" }])).rejects.toThrow(
        "Consultation failed: 500",
      );
    });
  });
});
