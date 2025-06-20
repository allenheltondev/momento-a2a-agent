import { A2AServer, A2AServerOptions } from './server';
import { MomentoAgentRequestHandler } from './agent/request_handler';
import { MomentoAgentExecutor } from './agent/executor';
import type { HandleTaskFn } from './agent/executor';
import { AgentCard } from './types';
import { register } from './momento/agent_registry';

export type { Task, Message, AgentSkill, AgentCard } from './types'
export interface CreateMomentoAgentOptions extends A2AServerOptions {
  defaultTtlSeconds?: number;
  registerAgent?: boolean;
}

export async function createMomentoAgent(params: {
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  handler: HandleTaskFn;
  agentCard?: Partial<AgentCard>;
  options?: CreateMomentoAgentOptions;
}) {
  const {
    cacheName,
    apiKey,
    skills,
    handler,
    agentCard = {},
    options = {},
  } = params;

  if(skills.length == 0){
    throw new Error('At least one skill must be provided');
  }

  if(!agentCard.url){
    console.warn('IMPORTANT - Remember to configure your agent url for discoverability')
  }

  const agentCardFull: AgentCard = {
    name: agentCard.name || 'Momento Agent',
    description: agentCard.description || 'A serverless agent powered by Momento',
    url: agentCard.url || '.',
    provider: agentCard.provider || { organization: 'unknown', url: ""},
    version: agentCard.version || '1.0.0',
    capabilities: {
      streaming: agentCard.capabilities?.streaming ?? true,
      pushNotifications: agentCard.capabilities?.pushNotifications ?? false,
      stateTransitionHistory: agentCard.capabilities?.stateTransitionHistory ?? true,
      ...agentCard.capabilities,
    },
    defaultInputModes: agentCard.defaultInputModes || ['text'],
    defaultOutputModes: agentCard.defaultOutputModes || ['text'],
    skills
  };

  const executor = new MomentoAgentExecutor(handler, { agentName: agentCardFull.name, agentId: agentCardFull.name.replace(/\s+/g, '_').toLowerCase()});
  const requestHandler = new MomentoAgentRequestHandler(
    {
      agentCard: agentCardFull,
      momentoApiKey: apiKey,
      cacheName,
      executor,
      defaultTtlSeconds: options.defaultTtlSeconds ?? 3600
    }
  );

  const isValidConnection = await requestHandler.verifyConnection();
  if(!isValidConnection){
    console.error('The provided cache name does not exist in your Momento account');
    throw new Error('Invalid cache name');
  }

  if(options.registerAgent){
    await register(apiKey, cacheName, agentCardFull)
  }
  const server = new A2AServer(requestHandler, options);

  return server.app();
}
