#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { A2AClient } from "./client.js";
import { v4 as uuidv4 } from 'uuid';
import { TextPart } from "../types.js";

const mcpServer = new McpServer({
  name: "A2A Tools",
  version: "0.1.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

mcpServer.tool(
  "invokeAgent",
  "Send a message to an A2A server as part of a task.",
  {
    agentUrl: z.string().url().describe('Base url of the agent to invoke'),
    message: z.string().describe('Specific instruction to pass to the agent'),
    taskId: z.string().optional().describe('Unique identifier for a specific unit of work'),
    contextId: z.string().optional().describe('Unique identifier for a set of related tasks')
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
        const textPart = event.status.message.parts.find((p) => p.kind === "text") as TextPart;
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
