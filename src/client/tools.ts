import { z } from "zod/v4";
import { A2AClient } from "./client.js";
import { v4 as uuidv4 } from 'uuid';
import { TextPart } from "../types.js";

export const invokeAgent: any = {
  name: 'invokeAgent',
  description: "Send a message to an A2A server as part of a task.",
  schema: z.object({
    agentUrl: z.string().describe('Base url of the agent to invoke'),
    message: z.string().describe('Specific instruction to pass to the agent'),
    taskId: z.string().default('').describe('Unique identifier for a specific user request. Provide blank for first call and use the returned ID for subsequent.'),
    contextId: z.string().describe('Unique identifier for a set of related tasks')
  }),
  handler: async ({ agentUrl, message, contextId, taskId }: z.infer<typeof invokeAgent.schema>) => {
    const client = new A2AClient(agentUrl);
    const stream = await client.sendMessageStream({
      message: {
        messageId: uuidv4(),
        kind: 'message',
        parts: [{ kind: 'text', text: message }],
        role: 'user',
        ...(contextId && { contextId }),
        ...(taskId && taskId !== '' && { taskId })
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
