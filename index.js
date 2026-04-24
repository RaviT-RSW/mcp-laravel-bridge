import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

// Session storage
const transports = {};
const sessionTimers = {};

// FIX 2: 30-minute TTL for sessions that never send DELETE
const SESSION_TTL_MS = 30 * 60 * 1000;

// Health check
app.get("/", (req, res) => res.send("MCP Server is Awake and Running!"));

function createServer() {
  const server = new McpServer(
    { name: "Laravel-Bridge", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.tool(
    "create_estimate",
    "Create a new estimate",
    {
      project_name: z.string().describe("Project name or address"),
      service_type: z.string().describe("Residential or Commercial"),
      // FIX 5: Validate budget is a valid numeric string
      budget: z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/, "Budget must be a number like '1500' or '1500.00'")
        .describe("Budget amount"),
    },
    async ({ project_name, service_type, budget }) => {
      try {
        const response = await axios.post(
          "https://staging.principlerec.com/api/mcp/create-estimate",
          { project_name, service_type, budget },
          {
            // FIX 3: Authenticate with Laravel API via env token
            headers: {
              Authorization: `Bearer ${process.env.LARAVEL_API_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        return {
          content: [{ type: "text", text: `Success! Created ID: ${response.data.id}` }],
        };
      } catch (error) {
        // FIX 4: Surface the actual Laravel error body, not just the Axios message
        const detail =
          error.response?.data?.message ??
          error.response?.data ??
          error.message;
        return {
          content: [{ type: "text", text: `Error: ${JSON.stringify(detail)}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// Helper to register a session with TTL cleanup
function registerSession(sessionId, transport) {
  transports[sessionId] = transport;

  // FIX 2: Auto-evict stale sessions after TTL
  sessionTimers[sessionId] = setTimeout(() => {
    delete transports[sessionId];
    delete sessionTimers[sessionId];
  }, SESSION_TTL_MS);

  transport.onclose = () => {
    delete transports[sessionId];
    clearTimeout(sessionTimers[sessionId]);
    delete sessionTimers[sessionId];
  };
}

// POST — main handler for all client-to-server messages
app.post("/mcp", async (req, res) => {
  res.setHeader("X-Accel-Buffering", "no");

  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && transports[sessionId]) {
    // Reuse existing session
    await transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    // FIX 1: Capture the generated session ID deterministically before connect()
    const newSessionId = randomUUID();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });

    const server = createServer();
    await server.connect(transport);

    // Register AFTER connect(), using our known ID (not transport.sessionId)
    registerSession(newSessionId, transport);

    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Bad Request: No valid session ID provided" },
    id: null,
  });
});

// Reusable handler for GET and DELETE
const handleSessionRequest = async (req, res) => {
  res.setHeader("X-Accel-Buffering", "no");

  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  await transports[sessionId].handleRequest(req, res);
};

// GET — SSE stream for server-to-client notifications
app.get("/mcp", handleSessionRequest);

// DELETE — session termination
app.delete("/mcp", handleSessionRequest);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
