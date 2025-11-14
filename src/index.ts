import { A2AServer } from './server';
import { MomentoAgentRequestHandler } from './agent/request_handler';
import { MomentoAgentExecutor } from './agent/executor';
import type { HandleTaskFn } from './agent/executor';
import { AgentCard, AgentType } from './types';
import { register } from './momento/agent_registry';
import { AmazonBedrockOrchestrator } from './orchestrators/amazon_bedrock';
import { OpenAIOrchestrator } from './orchestrators/openai';
import type {
  CreateMomentoAgentOptions,
  WorkerBedrockParams,
  WorkerOpenAIParams,
  SupervisorBedrockParams,
  SupervisorOpenAIParams
} from './agent_types';

export { OpenAIOrchestrator } from './orchestrators/openai';
export { AmazonBedrockOrchestrator } from './orchestrators/amazon_bedrock';
export type { Task, Message, AgentSkill, AgentCard, AgentType } from './types';
export type { PublishUpdateFn } from './agent/executor';
export type {
  CreateMomentoAgentOptions,
  WorkerBedrockParams,
  WorkerOpenAIParams,
  SupervisorBedrockParams,
  SupervisorOpenAIParams
} from './agent_types';

function wrapSupervisorHandler(handler: HandleTaskFn): HandleTaskFn {
  return async (message, context) => {
    const enhancedPublishUpdate = async (text: string) => {
      await context.publishUpdate(text);
      console.log(`[Supervisor] ${text}`);
    };

    return await handler(message, {
      ...context,
      publishUpdate: enhancedPublishUpdate
    });
  };
}

export async function createMomentoAgent(params: {
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  handler: HandleTaskFn;
  agentCard?: Partial<AgentCard>;
  options?: CreateMomentoAgentOptions;
  type?: AgentType;
}) {
  const {
    cacheName,
    apiKey,
    skills,
    handler,
    agentCard = {},
    options = {},
    type = 'worker',
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

  const finalHandler = type === 'supervisor' ? wrapSupervisorHandler(handler) : handler;

  const executor = new MomentoAgentExecutor(finalHandler, {
    agentName: agentCardFull.name,
    agentId: agentCardFull.name.replace(/\s+/g, '_').toLowerCase(),
    agentType: type
  });
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

export async function createBedrockAgent(
  params: WorkerBedrockParams | SupervisorBedrockParams
) {
  const orchestrator = new AmazonBedrockOrchestrator({
    momento: {
      apiKey: params.apiKey,
      cacheName: params.cacheName
    },
    bedrock: params.bedrock,
    config: {
      ...params.config,
      tools: params.tools
    }
  });

  if (params.type === 'worker') {
    // Worker: orchestrator is ready immediately with custom tools
  } else {
    // Supervisor: auto-discover agents from registry
    orchestrator.registerAgents([]);

    await new Promise<void>(resolve => {
      const checkReady = () => {
        if (orchestrator.isReady()) {
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  const handler: HandleTaskFn = async (message, { publishUpdate }) => {
    const textPart = message.parts.find(p => p.kind === 'text' && 'text' in p);
    const text = textPart && 'text' in textPart ? textPart.text : '';

    const response = await orchestrator.sendMessage({
      message: text,
      contextId: message.contextId,
      publishUpdate
    });

    return response || 'No response';
  };

  return createMomentoAgent({
    cacheName: params.cacheName,
    apiKey: params.apiKey,
    skills: params.type === 'worker' ? params.skills : (params.agentCard?.skills || [{
      id: 'orchestrate',
      name: 'Orchestrate',
      description: 'Coordinates multiple agents to complete complex tasks',
      tags: ['orchestration']
    }]),
    handler,
    agentCard: params.agentCard,
    options: params.options,
    type: params.type
  });
}

export async function createOpenAIAgent(
  params: WorkerOpenAIParams | SupervisorOpenAIParams
) {
  const orchestrator = new OpenAIOrchestrator({
    momento: {
      apiKey: params.apiKey,
      cacheName: params.cacheName
    },
    openai: params.openai,
    config: {
      ...params.config,
      tools: params.tools
    }
  });

  if (params.type === 'worker') {
    // Worker: orchestrator is ready immediately with custom tools
  } else {
    // Supervisor: auto-discover agents from registry
    orchestrator.registerAgents([]);

    await new Promise<void>(resolve => {
      const checkReady = () => {
        if (orchestrator.isReady()) {
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  const handler: HandleTaskFn = async (message, { publishUpdate }) => {
    const textPart = message.parts.find(p => p.kind === 'text' && 'text' in p);
    const text = textPart && 'text' in textPart ? textPart.text : '';

    const response = await orchestrator.sendMessage({
      message: text,
      contextId: message.contextId,
      publishUpdate
    });

    return response || 'No response';
  };

  return createMomentoAgent({
    cacheName: params.cacheName,
    apiKey: params.apiKey,
    skills: params.type === 'worker' ? params.skills : (params.agentCard?.skills || [{
      id: 'orchestrate',
      name: 'Orchestrate',
      description: 'Coordinates multiple agents to complete complex tasks',
      tags: ['orchestration']
    }]),
    handler,
    agentCard: params.agentCard,
    options: params.options,
    type: params.type
  });
}
