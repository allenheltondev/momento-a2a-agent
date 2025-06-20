
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { A2AClient } from "./client.js";
import { v4 as uuidv4 } from 'uuid';

const mcpServer = new McpServer({
  name: "A2A Tools",
  version: "0.1.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

mcpServer.tool(
  "sendMessage",
  "Communicate with an A2A server",
  {
    agentUrl: z.string().url(),
    message: z.string(),
    taskId: z.string().optional(),
    contextId: z.string().optional()
  },
  async ({ agentUrl, message, contextId, taskId }) => {
    const client = new A2AClient(agentUrl);
    const stream = await client.sendMessageStream({
      message: {
        messageId: uuidv4(),
        kind: 'message',
        parts: [{ kind: 'text', text: message }],
        role: 'user',
        ...contextId && { contextId },
        ...taskId && { taskId }
      }
    });

    let finalText = "";
    let finalSeen = false;

    for await (const event of stream) {
      if (
        event.kind === "status-update" &&
        event.final === true &&
        event.status?.message?.parts?.length
      ) {
        const textPart = event.status.message.parts.find((p) => p.kind === "text");
        if (textPart?.text) {
          finalText = textPart.text;
          finalSeen = true;
          break; // Exit the loop — we're done
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: finalSeen
            ? finalText
            : "No final response received from the agent.",
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
