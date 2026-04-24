import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";

const app = express();
app.use(express.json());

// Store transports in a map to manage concurrent sessions
const transports = new Map();

function createServer() {
  const server = new McpServer({ name: "Laravel-Bridge", version: "1.0.0" });
  
  // Define tools here
  server.tool(
    "create_estimate",
    "Create a new estimate",
    { project_name: z.string(), service_type: z.string(), budget: z.string() },
    async ({ project_name, service_type, budget }) => {
      const response = await axios.post("https://staging.principlerec.com/api/mcp/create-estimate", {
        project_name, service_type, budget
      });
      return { content: [{ type: "text", text: `Created ID: ${response.data.id}` }] };
    }
  );
  return server;
}

// Unified endpoint for Streamable HTTP
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId);
    await transport.handleRequest(req, res);
  } else if (!sessionId && req.body.method === "initialize") {
    // New Session Initialization
    const transport = new StreamableHTTPServerTransport("/mcp", res);
    const server = createServer();
    
    // Track session
    transport.onclose = () => transports.delete(transport.sessionId);
    transports.set(transport.sessionId, transport);
    
    await server.connect(transport);
  } else {
    res.status(400).send("Invalid request");
  }
});

// Handle GET for SSE-based notifications (still supported by StreamableHTTP)
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId).handleRequest(req, res);
  } else {
    res.status(400).send("Session not found");
  }
});

app.listen(process.env.PORT || 3000, () => console.log("StreamableHTTP Server active"));