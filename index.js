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

// Use a plain object for transport storage (simpler, idiomatic)
const transports = {};

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
      budget: z.string().describe("Budget amount"),
    },
    async ({ project_name, service_type, budget }) => {
      try {
        const response = await axios.post(
          "https://staging.principlerec.com/api/mcp/create-estimate",
          { project_name, service_type, budget }
        );
        return {
          content: [{ type: "text", text: `Success! Created ID: ${response.data.id}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
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
    // FIX: Correct constructor with sessionIdGenerator
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createServer();
    await server.connect(transport);

    // sessionId is available after connect()
    transports[transport.sessionId] = transport;
    transport.onclose = () => delete transports[transport.sessionId];

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

// FIX: Added DELETE handler for session termination
app.delete("/mcp", handleSessionRequest);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));