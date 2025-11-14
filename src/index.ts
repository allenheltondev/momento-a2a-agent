import { A2AServer, A2AServerOptions } from './server';
import { MomentoAgentRequestHandler } from './agent/request_handler';
import { MomentoAgentExecutor } from './agent/executor';
import type { HandleTaskFn } from './agent/executor';
import { AgentCard } from './types';
import { register } from './momento/agent_registry';
import { InMemoryTaskStore } from './store/in_memory_task_store';
import { InMemoryEventBus } from './event/in_memory_event_bus';
import { MomentoTaskStore } from './store/task_store';
import { MomentoEventBus } from './event/event_bus';

export { OpenAIOrchestrator } from './orchestrators/openai';
export { AmazonBedrockOrchestrator } from './orchestrators/amazon_bedrock';
export type { Task, Message, AgentSkill, AgentCard } from './types';
export type { PublishUpdateFn } from './agent/executor';

function isInMemoryMode(apiKey?: string): boolean {
  return !apiKey || apiKey.trim() === '';
}

export interface CreateMomentoAgentOptions extends A2AServerOptions {
  defaultTtlSeconds?: number;
  registerAgent?: boolean;
}

export interface CreateAgentOptions extends A2AServerOptions {
  defaultTtlSeconds?: number;
  registerAgent?: boolean;
}

export interface CreateAgentParams {
  cacheName?: string;
  apiKey?: string;
  skills: AgentCard['skills'];
  handler: HandleTaskFn;
  agentCard?: Partial<AgentCard>;
  options?: CreateAgentOptions;
}

export async function createAgent(params: CreateAgentParams) {
  const {
    cacheName: providedCacheName,
    apiKey,
    skills,
    handler,
    agentCard = {},
    options = {},
  } = params;

  if(skills.length == 0){
    throw new Error('At least one skill must be provided');
  }

  const inMemoryMode = isInMemoryMode(apiKey);
  const cacheName = providedCacheName || (inMemoryMode ? 'local' : undefined);

  if (!cacheName && !inMemoryMode) {
    throw new Error('cacheName is required when using Momento');
  }

  if (inMemoryMode) {
    console.warn('Running in local in-memory mode. State will not persist across restarts.');
  }

  if(!agentCard.url && !inMemoryMode){
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

  const taskStore = inMemoryMode
    ? new InMemoryTaskStore()
    : new MomentoTaskStore(cacheName!, apiKey!);

  const eventBus = inMemoryMode
    ? new InMemoryEventBus()
    : new MomentoEventBus(cacheName!, apiKey!);

  const requestHandler = new MomentoAgentRequestHandler(
    {
      agentCard: agentCardFull,
      momentoApiKey: apiKey,
      cacheName: cacheName,
      executor,
      defaultTtlSeconds: options.defaultTtlSeconds ?? 3600,
      taskStore,
      eventBus,
    }
  );

  if (!inMemoryMode) {
    const isValidConnection = await requestHandler.verifyConnection();
    if(!isValidConnection){
      console.error('The provided cache name does not exist in your Momento account');
      throw new Error('Invalid cache name');
    }

    if(options.registerAgent){
      await register(apiKey!, cacheName!, agentCardFull)
    }
  }

  const server = new A2AServer(requestHandler, options);

  return server.app();
}

/**
 * @deprecated Use createAgent instead. This function will be removed in v2.0.0
 */
export async function createMomentoAgent(params: {
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  handler: HandleTaskFn;
  agentCard?: Partial<AgentCard>;
  options?: CreateMomentoAgentOptions;
}) {
  console.warn('createMomentoAgent is deprecated. Use createAgent instead.');
  return createAgent(params);
}
