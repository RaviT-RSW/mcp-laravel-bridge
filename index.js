import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import axios from "axios";

const server = new McpServer({ name: "Laravel-Bridge", version: "1.0.0" });

// --- YOUR TOOLS GO HERE (Keep them exactly as they are) ---
server.tool(
  "create_estimate",
  "Create a new estimate",
  { project_name: z.string(), service_type: z.string(), budget: z.string() },
  async ({ project_name, service_type, budget }) => {
    // NOTE: Change 'localhost' to your actual staging/live URL
    const response = await axios.post("https://staging.principlerec.com/api/mcp/create-estimate", {
      project_name, service_type, budget
    });
    return { content: [{ type: "text", text: `Created ID: ${response.data.id}` }] };
  }
);

// --- SSE SETUP (The new part) ---
const app = express();
let transport;

app.get("/sse", async (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});