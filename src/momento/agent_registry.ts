import { AgentCard } from "../types";
import { MomentoClient } from "./client";

const AGENT_PREFIX = 'agent:';
type AgentSummary = {
  name: string,
  description: string;
};

export const register = async (apiKey: string, cacheName: string, agentCard: AgentCard): Promise<void> => {
  const client = new MomentoClient({ apiKey, cacheName });
  const registeredAgents = await client.get<AgentSummary[]>(`${AGENT_PREFIX}list`, { format: 'json' }) ?? [];
  const agentIndex = registeredAgents.findIndex(agent => agent.name === agentCard.name);
  if (agentIndex !== -1) {
    registeredAgents[agentIndex] = { name: agentCard.name, description: agentCard.description };
  } else {
    registeredAgents.push({ name: agentCard.name, description: agentCard.description });
  }
  await client.multiSet([
    { key: `${AGENT_PREFIX}list`, value: registeredAgents, options: { ttlSeconds: 86400 } },
    { key: `${AGENT_PREFIX}${agentCard.name}`, value: agentCard, options: { ttlSeconds: 86400 } }
  ]);
};
