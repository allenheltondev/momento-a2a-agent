import { Agent, run, setDefaultOpenAIKey, MCPServerStdio } from '@openai/agents';
import { MomentoClient } from '../momento/client.js';
import { AGENT_LIST } from '../momento/agent_registry.js';
import { AgentCard, AgentSummary } from '../types.js';

export type OpenAiOrchestratorParams = {
  momento: {
    apiKey: string,
    cacheName: string;
  },
  openai: {
    apiKey: string,
    model?: string;
  };
};

export type SendMessageParams = {
  message: string,
  contextId?: string;
};

export class OpenAIOrchestrator {
  private client: MomentoClient;
  private model: string;
  private agentUrls: string[] = [];

  constructor(params: OpenAiOrchestratorParams) {
    this.client = new MomentoClient({
      apiKey: params.momento.apiKey,
      cacheName: params.momento.cacheName
    });

    setDefaultOpenAIKey(params.openai.apiKey);
    this.model = params.openai.model || 'o4-mini';
  }

  registerAgents(agentUrls: string[]) {
    this.agentUrls = agentUrls;
  };

  async sendMessage(params: SendMessageParams): Promise<string | undefined> {
    const agentCards = await this.loadAgents();
    if (agentCards.length === 0) {
      throw new Error('No agents were provided.');
    }
    const mcpServer = new MCPServerStdio({
      name: 'A2A Client MCP server via npx',
      fullCommand: 'npx -y momento-a2a-agent'
    });
    await mcpServer.connect();
    try {
      const agent = new Agent({
        model: this.model,
        name: 'A2A Orchestrator',
        mcpServers: [mcpServer],
        instructions: `You are an autonomous orchestration agent with full authority to satisfy user requests by delegating to available specialized agents.

You are given:
- A block of A2A agent cards describing each agent's capabilities.
- A user prompt describing a task to be completed.
- A single tool available to you: 'invokeAgent'.

Your responsibilities:
1. **Understand the user's intent** and determine which agents (from the agent cards) are capable of completing the request.
2. **If multiple steps are required**, break the request into a high-level plan. Use 'invokeAgent' to execute each step in the correct order.
3. Always **include relevant task context** when interacting with an agent so it has enough information to act accurately.
4. Do not ask the user to confirm which agent to use — that is your job. Assume full routing authority.
5. Return the final result in natural language, clearly summarizing what was done and what was learned.
6. If a response from an agent is insufficient, refine the task and try again.
7. If no agents exist that can satisfy a task, return a response indicating the task cannot be carried out.

About the 'invokeAgent' tool:
- It sends a task to a specific agent.
- You must specify: 'agentUrl', 'message', 'contextId' and optionally 'taskId'.
- You will receive a final message from the agent.

Use 'invokeAgent' whenever you need to delegate a task.

---
EXAMPLES OF DELEGATION

**Simple request:**
User: "What's the weather in Rome tomorrow?"
→ Use 'invokeAgent' with 'agentUrl' = "https://agent.workers.dev/weather"' and task = "Get the weather forecast for Rome tomorrow."

**Multi-step:**
User: "Find me a place to stay in Seattle this weekend and tell me if it will be sunny."
→ Step 1: Ask WeatherAgent for the forecast in Seattle.
→ Step 2: Ask AirbnbAgent to find lodging in Seattle, and include the weather in your prompt.
→ Return both results clearly.

---
AGENT CARDS

${agentCards.map((card) => this.agentCardToPromptFormat(card)).join('\n\n')}

---
OTHER CONTEXT

It is currently ${new Date().toISOString()}.
${params.contextId ? `Provide context id "${params.contextId}" to the invokeAgent tool when making a call.` : ''}

---
You are precise, efficient, and fully capable of autonomous planning and agent coordination. When all your steps are completed, return a consolidated, meaningful answer as a response. If you can answer the user query yourself without calling tools, please do so.
`
      });

      const response = await run(agent, params.message, { stream: false });
      return response.finalOutput;
    } finally {
      if (mcpServer?.close) {
        await mcpServer.close()?.catch(() => console.error('Could not disconnect MCP server'));
      }
    }
  }

  private async loadAgents(): Promise<AgentCard[]> {
    const registeredAgents = await this.client.get<AgentSummary[]>(AGENT_LIST, { format: 'json' }) ?? [];
    console.log(registeredAgents)
    const allAgents = [...new Set([...this.agentUrls ?? [], ...registeredAgents.filter((ra) => ra.url).map((ra) => ra.url)])];
    const agentCards = await Promise.all(allAgents.map(async (url) => await this.loadAgentCard(url)));
    return agentCards;
  }

  private async loadAgentCard(url: string): Promise<AgentCard> {
    let card = await this.client.get<AgentCard>(url, { format: 'json' });
    if (!card) {
      const response = await fetch(`${url}/.well-known/agent.json`);
      if (!response.ok) {
        throw new Error(`Failed to load agent card from ${url}`);
      }

      card = await response.json() as AgentCard;
      await this.client.set(url, card);
    }
    return card;
  }

  private agentCardToPromptFormat(card: AgentCard): string {
    return `Agent: ${card.name}
    Description: ${card.description}
    Url: ${card.url}
    Skills:
    ${card.skills.map((skill) => `- ${skill.name}: ${skill.description}
       Examples:
         ${(skill.examples && skill.examples.length > 0) ? skill.examples?.join('\n') : 'None.'}`).join('\n')}
    `;
  }
}
