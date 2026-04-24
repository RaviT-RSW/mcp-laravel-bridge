import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import axios from "axios";

const app = express();

// A factory function to create a fresh server instance for every connection
function createServer() {
  const server = new McpServer({ name: "Laravel-Bridge", version: "1.0.0" });

  // Define your tools here (or define them outside and pass the server instance)
  server.tool(
    "create_estimate",
    "Create a new estimate",
    { project_name: z.string(), service_type: z.string(), budget: z.string() },
    async ({ project_name, service_type, budget }) => {
      const response = await axios.post("https://your-live-site.com/api/mcp/create-estimate", {
        project_name, service_type, budget
      });
      return { content: [{ type: "text", text: `Created ID: ${response.data.id}` }] };
    }
  );

  return server;
}

app.get("/sse", async (req, res) => {
  // Create a fresh server instance for this specific connection
  const server = createServer();
  const transport = new SSEServerTransport("/messages", res);

  // Now this won't conflict with other connections
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  // Note: For SSE, the messages are usually handled via the transport
  // tied to the specific request/response object in the /sse route.
  // The SSE transport handles the POST messages for that specific session.
});

app.listen(process.env.PORT || 3000, () => {
  console.log("MCP Server running");
});