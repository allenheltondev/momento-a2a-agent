import { z } from "zod";
import { A2AClient } from "./client.js";
import { v4 as uuidv4 } from 'uuid';
import { TextPart } from "../types.js";

export const invokeAgent: any = {
  name: 'invokeAgent',
  description: "Send a message to an A2A server as part of a task.",
  schema: z.object({
    agentUrl: z.string().describe('Base url of the agent to invoke'),
    message: z.string().describe('Specific instruction to pass to the agent'),
    taskId: z.string().optional().nullable().describe('Unique identifier for a specific unit of work'),
    contextId: z.string().optional().nullable().describe('Unique identifier for a set of related tasks')
  }),
  jsonSchema: {
    type: 'object',
    properties: {
      agentUrl: {
        type: 'string',
        description: 'Base url of the agent to invoke'
      },
      message: {
        type: 'string',
        description: 'Specific instruction to pass to the agent'
      },
      taskId: {
        type: 'string',
        description: 'Unique identifier for a specific unit of work'
      },
      contextId: {
        type: 'string',
        description: 'Unique identifier for a set of related tasks'
      }
    },
    required: ['agentUrl', 'message']
  },
  handler: async ({ agentUrl, message, contextId, taskId }: z.infer<typeof invokeAgent.schema>) => {
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

    return finalText;
  }
};
