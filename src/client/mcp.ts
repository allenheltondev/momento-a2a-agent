#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { invokeAgent } from "./tools.js";
import { z } from "zod";

const mcpServer = new McpServer({
  name: "A2A Tools",
  version: "0.1.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

type InvokeAgentInput = z.infer<typeof invokeAgent.schema>;

mcpServer.tool(
  invokeAgent.name,
  invokeAgent.description,
  invokeAgent.schema.shape,
  async ({ agentUrl, message, contextId, taskId }: InvokeAgentInput, _extra) => {
    const data = await invokeAgent.handler({ agentUrl, message, contextId, taskId });

    return {
      content: [
        {
          type: "text",
          text: data
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("A2A MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
});
