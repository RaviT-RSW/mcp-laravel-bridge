import express from "express";
import cors from "cors"; // Fix #1: Essential for cloud connectivity
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";

const app = express();

// Fix #1: Enable CORS so Claude's infrastructure can reach you
app.use(cors()); 
app.use(express.json());

const transports = new Map();

// Fix #2: Root route so you can verify the server is "Awake" in your browser
app.get("/", (req, res) => res.send("MCP Server is Awake and Running!"));

function createServer() {
  const server = new McpServer(
    { name: "Laravel-Bridge", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  
  server.tool(
    "create_estimate",
    "Create a new estimate in the Laravel system",
    { 
      project_name: z.string().describe("Name/Address of the project"), 
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
        // Return the error to Claude instead of crashing the server
        return { content: [{ type: "text", text: `Error from Staging: ${error.message}` }], isError: true };
      }
    }
  );
  return server;
}

app.post("/mcp", async (req, res) => {
  // Fix #3: Disable Render/Proxy buffering for real-time streaming
  res.setHeader('X-Accel-Buffering', 'no'); 
  
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.body.method === "initialize") {
    const transport = new StreamableHTTPServerTransport("/mcp", res);
    const server = createServer();
    
    await server.connect(transport);
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