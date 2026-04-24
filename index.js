import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";

const app = express();
app.use(cors()); 
app.use(express.json());

const transports = new Map();

// Verify server status in browser
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
      budget: z.string().describe("Budget amount") 
    },
    async ({ project_name, service_type, budget }) => {
      try {
        const response = await axios.post("https://staging.principlerec.com/api/mcp/create-estimate", {
          project_name, service_type, budget
        });
        return { content: [{ type: "text", text: `Success! Created ID: ${response.data.id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
  return server;
}

app.post("/mcp", async (req, res) => {
  res.setHeader('X-Accel-Buffering', 'no'); 
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.body.method === "initialize") {
    // CLAUDE'S FIX: Use the options object { path: "/mcp" }
    const transport = new StreamableHTTPServerTransport({ path: "/mcp" });
    const server = createServer();
    
    await server.connect(transport);
    
    // Crucial: The transport generates a sessionId AFTER connect
    transports.set(transport.sessionId, transport);
    transport.onclose = () => transports.delete(transport.sessionId);
    
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).send("Invalid session");
});

app.get("/mcp", async (req, res) => {
  res.setHeader('X-Accel-Buffering', 'no');
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId).handleRequest(req, res);
  } else {
    res.status(400).send("Session not found");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));