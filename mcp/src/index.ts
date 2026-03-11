import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "./server.js";

// Load .env from project root
for (const envPath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  try {
    const contents = readFileSync(envPath, "utf-8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
    break;
  } catch { /* file not found, try next */ }
}

const mode = process.argv.includes("--http") ? "http" : "stdio";
const port = parseInt(process.env.PORT ?? "3001", 10);

async function main(): Promise<void> {
  if (mode === "http") {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

// ─── Stdio Transport (local / subprocess) ───────────────────────────────

async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

// ─── HTTP/SSE Transport (remote hosting) ─────────────────────────────────

async function startHttpServer(): Promise<void> {
  // Track active SSE transports for cleanup
  const activeSessions = new Map<string, { server: ReturnType<typeof createServer>; transport: SSEServerTransport }>();

  const httpServer = createHttpServer(async (req, res) => {
    // CORS headers for remote access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // Health endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        server: "claw-clinic",
        version: "0.1.0",
        sessions: activeSessions.size,
      }));
      return;
    }

    // SSE endpoint — client connects here to establish MCP session
    if (url.pathname === "/sse" && req.method === "GET") {
      const mcpServer = createServer();
      const transport = new SSEServerTransport("/messages", res);

      const sessionId = transport.sessionId;
      activeSessions.set(sessionId, { server: mcpServer, transport });

      // Clean up on disconnect
      res.on("close", () => {
        activeSessions.delete(sessionId);
        mcpServer.close().catch(() => {});
      });

      await mcpServer.connect(transport);
      return;
    }

    // Message endpoint — client sends MCP messages here
    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const session = sessionId ? activeSessions.get(sessionId) : undefined;

      if (!session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found. Connect to /sse first." }));
        return;
      }

      await session.transport.handlePostMessage(req, res);
      return;
    }

    // Root — basic info
    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        name: "Claw Clinic MCP Server",
        version: "0.1.0",
        description: "AI Agent Healthcare — diagnose and treat agent failures",
        endpoints: {
          sse: "/sse",
          messages: "/messages",
          health: "/health",
        },
        tools: [
          "hz_health_check",
          "hz_diagnose",
          "hz_treat",
          "hz_consult",

          "hz_validate_symptoms",
        ],
      }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(port, () => {
    console.log(`Claw Clinic MCP server running on http://0.0.0.0:${port}`);
    console.log(`  SSE endpoint:     http://0.0.0.0:${port}/sse`);
    console.log(`  Message endpoint: http://0.0.0.0:${port}/messages`);
    console.log(`  Health check:     http://0.0.0.0:${port}/health`);
    console.log(`  Opus diagnosis:   ${process.env.ANTHROPIC_API_KEY ? "enabled" : "disabled (no ANTHROPIC_API_KEY)"}`);
  });

  process.on("SIGINT", () => {
    for (const session of activeSessions.values()) {
      session.server.close().catch(() => {});
    }
    httpServer.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    for (const session of activeSessions.values()) {
      session.server.close().catch(() => {});
    }
    httpServer.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
