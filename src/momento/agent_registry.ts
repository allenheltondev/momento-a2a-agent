import { AgentCard, AgentSummary } from "../types.js";
import { MomentoClient } from "./client.js";

const AGENT_PREFIX = 'agent:';
export const AGENT_LIST = `${AGENT_PREFIX}list`;

export const register = async (apiKey: string, cacheName: string, agentCard: AgentCard): Promise<void> => {
  const client = new MomentoClient({ apiKey, cacheName });
  const registeredAgents = await client.get<AgentSummary[]>(AGENT_LIST, { format: 'json' }) ?? [];
  const agentSummary = {
    name: agentCard.name,
    description: agentCard.description,
    url: agentCard.url
  };
  const agentIndex = registeredAgents.findIndex(agent => agent.url === agentCard.url);
  if (agentIndex !== -1) {
    registeredAgents[agentIndex] = agentSummary;
  } else {
    registeredAgents.push(agentSummary);
  }
  await client.multiSet([
    { key: `${AGENT_PREFIX}list`, value: registeredAgents, options: { ttlSeconds: 86400 } },
    { key: `${AGENT_PREFIX}${agentCard.url}`, value: agentCard, options: { ttlSeconds: 86400 } }
  ]);
};
