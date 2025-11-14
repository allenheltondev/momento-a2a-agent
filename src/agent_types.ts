import { A2AServerOptions } from './server';
import { AgentCard } from './types';

export interface CreateMomentoAgentOptions extends A2AServerOptions {
  defaultTtlSeconds?: number;
  registerAgent?: boolean;
}

export type WorkerBedrockParams = {
  type: 'worker';
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  tools: Array<{
    name: string;
    description: string;
    schema: any;
    handler: (input: any) => Promise<any> | any;
  }>;
  agentCard?: Partial<AgentCard>;
  bedrock?: {
    modelId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    profile?: string;
  };
  config?: {
    agentLoadingConcurrency?: number;
    systemPrompt?: string;
    maxTokens?: number;
    tokenWarningThreshold?: number;
    debug?: boolean;
    preserveThinkingTags?: boolean;
  };
  options?: CreateMomentoAgentOptions;
};

export type WorkerOpenAIParams = {
  type: 'worker';
  cacheName: string;
  apiKey: string;
  skills: AgentCard['skills'];
  tools: Array<{
    name: string;
    description: string;
    schema: any;
    handler: (input: any) => Promise<any> | any;
  }>;
  agentCard?: Partial<AgentCard>;
  openai: {
    apiKey: string;
    model?: string;
  };
  config?: {
    agentLoadingConcurrency?: number;
    maxTokens?: number;
    debug?: boolean;
    tokenWarningThreshold?: number;
    preserveThinkingTags?: boolean;
  };
  options?: CreateMomentoAgentOptions;
};

export type SupervisorBedrockParams = {
  type: 'supervisor';
  cacheName: string;
  apiKey: string;
  tools?: Array<{
    name: string;
    description: string;
    schema: any;
    handler: (input: any) => Promise<any> | any;
  }>;
  agentCard?: Partial<AgentCard>;
  bedrock?: {
    modelId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    profile?: string;
  };
  config?: {
    agentLoadingConcurrency?: number;
    systemPrompt?: string;
    maxTokens?: number;
    tokenWarningThreshold?: number;
    debug?: boolean;
    preserveThinkingTags?: boolean;
  };
  options?: CreateMomentoAgentOptions;
};

export type SupervisorOpenAIParams = {
  type: 'supervisor';
  cacheName: string;
  apiKey: string;
  tools?: Array<{
    name: string;
    description: string;
    schema: any;
    handler: (input: any) => Promise<any> | any;
  }>;
  agentCard?: Partial<AgentCard>;
  openai: {
    apiKey: string;
    model?: string;
  };
  config?: {
    agentLoadingConcurrency?: number;
    maxTokens?: number;
    debug?: boolean;
    tokenWarningThreshold?: number;
    preserveThinkingTags?: boolean;
  };
  options?: CreateMomentoAgentOptions;
};
