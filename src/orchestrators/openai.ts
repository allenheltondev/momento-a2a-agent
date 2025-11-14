import { Agent, run, setDefaultOpenAIKey, tool } from '@openai/agents';
import { MomentoClient } from '../momento/client.js';
import { AGENT_LIST } from '../momento/agent_registry.js';
import { AgentCard, AgentSummary } from '../types.js';
import { invokeAgent } from '../client/tools.js';
import { getSystemPrompt } from './prompt.js';
import { DEFAULTS } from './config.js';
import { OrchestratorLogger } from './logger.js';
import { sanitizeResponse } from './utils.js';

export type OpenAiOrchestratorParams = {
  momento: {
    apiKey: string;
    cacheName: string;
  };
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
    tools?: Array<{
      name: string;
      description: string;
      schema: any;
      handler: (input: any) => Promise<any> | any;
    }>;
  };
  agentLoadingConcurrency?: number; // Keep for backward compatibility
};

export type SendMessageParams = {
  message: string;
  contextId?: string;
  publishUpdate?: (text: string) => Promise<void>;
};

/**
 * A chunk of text from the streaming orchestrator.
 * - 'chunk': Partial output received during streaming
 * - 'final': Full final message after stream ends
 */
export type StreamChunk =
  | { type: 'chunk'; text: string; }
  | { type: 'final'; text: string; };

function createInvokeAgentTool(publishUpdate?: (text: string) => Promise<void>) {
  return tool({
    name: invokeAgent.name,
    description: invokeAgent.description,
    strict: true,
    parameters: invokeAgent.schema,
    execute: async (input: any) => {
      const toolName = invokeAgent.name;

      if (publishUpdate) {
        await publishUpdate(`Invoking tool: ${toolName}`);
      }

      let result: any;
      let toolError: string | undefined;
      try {
        result = await invokeAgent.handler(input);
      } catch (error: any) {
        toolError = error.message;
        throw error;
      } finally {
        if (publishUpdate) {
          const statusMessage = toolError
            ? `Tool ${toolName} failed: ${toolError}`
            : `Tool ${toolName} completed successfully`;
          await publishUpdate(statusMessage);
        }
      }

      return result;
    }
  });
}

function createCustomTool(
  customTool: {
    name: string;
    description: string;
    schema: any;
    handler: (input: any) => Promise<any> | any;
  },
  publishUpdate?: (text: string) => Promise<void>
) {
  return tool({
    name: customTool.name,
    description: customTool.description,
    strict: true,
    parameters: customTool.schema,
    execute: async (input: any) => {
      const toolName = customTool.name;

      if (publishUpdate) {
        await publishUpdate(`Invoking tool: ${toolName}`);
      }

      let result: any;
      let toolError: string | undefined;
      try {
        result = await customTool.handler(input);
      } catch (error: any) {
        toolError = error.message;
        throw error;
      } finally {
        if (publishUpdate) {
          const statusMessage = toolError
            ? `Tool ${toolName} failed: ${toolError}`
            : `Tool ${toolName} completed successfully`;
          await publishUpdate(statusMessage);
        }
      }

      return result;
    }
  });
}

/**
 * Orchestrates conversations between the user and distributed A2A agents using OpenAI.
 */
export class OpenAIOrchestrator {
  private client: MomentoClient;
  private model: string;
  private agentUrls: string[] = [];
  private concurrencyLimit: number;
  private maxTokens: number | undefined;
  private tokenWarningThreshold: number;
  private logger: OrchestratorLogger;
  private _agentCards: AgentCard[] | null = null;
  private _loadingPromise: Promise<AgentCard[]> | null = null;
  private preserveThinkingTags: boolean;
  private customTools: Array<{
    name: string;
    description: string;
    schema: any;
    handler: (input: any) => Promise<any> | any;
  }>;

  constructor(params: OpenAiOrchestratorParams) {
    this.client = new MomentoClient({
      apiKey: params.momento.apiKey,
      cacheName: params.momento.cacheName
    });

    setDefaultOpenAIKey(params.openai.apiKey);
    this.model = params.openai.model || 'o4-mini';
    this.concurrencyLimit = params.config?.agentLoadingConcurrency || params.agentLoadingConcurrency || DEFAULTS.CONCURRENCY_LIMIT;
    this.maxTokens = params.config?.maxTokens;
    this.tokenWarningThreshold = params.config?.tokenWarningThreshold || (this.maxTokens ? Math.floor(this.maxTokens * 0.8) : 8000);
    this.preserveThinkingTags = params.config?.preserveThinkingTags || false;
    this.customTools = params.config?.tools || [];

    this.logger = new OrchestratorLogger(params.config?.debug || false, 'OpenAI');

    this.logger.info('Orchestrator initialized', {
      model: this.model,
      maxTokens: this.maxTokens,
      tokenWarningThreshold: this.tokenWarningThreshold,
      concurrencyLimit: this.concurrencyLimit,
      customToolsCount: this.customTools.length
    });
  }

  /**
   * Registers additional agent URLs that can be used for orchestration.
   * @param agentUrls - List of agent endpoint URLs.
   */
  registerAgents(agentUrls: string[]) {
    this.agentUrls = agentUrls;
    this._agentCards = null;

    this.logger.info(`Registering ${agentUrls.length} agent URLs`);

    // Begin loading agents asynchronously
    this._loadingPromise = this.logger.time('Agent loading', () => this.loadAgents())
      .then((cards) => {
        this._agentCards = cards;
        this.logger.info(`Successfully loaded ${cards.length} agent cards`);
        return cards;
      })
      .catch((err) => {
        this.logger.error('Failed to load agents:', err);
        this._agentCards = null;
        this._loadingPromise = null;
        throw err;
      });
  }

  /**
   * Returns true if agent cards have already been loaded.
   */
  isReady(): boolean {
    return !!this._agentCards;
  }

  /**
   * Sends a message to the orchestrator and returns the final response text.
   * @param params - Message and optional context ID.
   */
  async sendMessage(params: SendMessageParams): Promise<string | undefined> {
    return this.logger.time('sendMessage', async () => {
      const agentCards = await this.getAgentCards();
      if (agentCards.length === 0) {
        throw new Error('No agents were provided.');
      }

      this.logger.info(`Sending message with ${agentCards.length} available agents`);
      this.logger.logTokenEstimate('Input message', params.message);

      const agent = this.buildAgent(agentCards, params.contextId, params.publishUpdate);

      const response = await run(agent, params.message, { stream: false });

      if (response.finalOutput) {
        this.logger.logTokenEstimate('Final response', response.finalOutput);
      }

      return sanitizeResponse(response.finalOutput ?? '', { preserveThinkingTags: this.preserveThinkingTags });
    });
  }

  /**
   * Sends a message and returns an async generator that yields response chunks.
   * Recommended for streaming user experiences.
   *
   * @param params - Message and optional context ID.
   * @returns Async generator yielding text chunks from the orchestrator.
   */
  async *sendMessageStream(params: SendMessageParams): AsyncGenerator<StreamChunk> {
    const agentCards = await this.getAgentCards();
    if (agentCards.length === 0) {
      throw new Error('No agents were provided.');
    }

    this.logger.info(`Starting stream with ${agentCards.length} available agents`);
    this.logger.logTokenEstimate('Input message', params.message);

    const agent = this.buildAgent(agentCards, params.contextId, params.publishUpdate);

    try {
      const stream = await run(agent, params.message, { stream: true });
      const textStream = stream.toTextStream();

      let totalChunks = 0;
      let totalLength = 0;

      for await (const chunk of textStream) {
        totalChunks++;
        totalLength += chunk.length;
        this.logger.log(`Stream chunk ${totalChunks}, length: ${chunk.length}, total: ${totalLength}`);
        yield { type: 'chunk', text: chunk };
      }

      if (typeof stream.finalOutput === 'string') {
        this.logger.info(`Stream completed: ${totalChunks} chunks, ${totalLength} total chars`);
        this.logger.logTokenEstimate('Final stream output', stream.finalOutput);
        yield { type: 'final', text: sanitizeResponse(stream.finalOutput, { preserveThinkingTags: this.preserveThinkingTags}) };
      } else {
        this.logger.warn('Stream completed without final output');
      }
    } catch (error) {
      this.logger.error('Error in sendMessageStream:', error);
      throw error;
    }
  }

  /**
   * Sends a message and invokes the callback with each streamed response chunk.
   * Useful for minimal setups or environments without async iterators.
   *
   * @param params - Message and optional context ID.
   * @param onText - Callback to receive streamed output chunks.
   */
  async sendMessageStreamWithCallback(
    params: SendMessageParams,
    onText: (text: StreamChunk) => void
  ): Promise<void> {
    try {
      for await (const chunk of this.sendMessageStream(params)) {
        onText(chunk);
      }
    } catch (error) {
      this.logger.error('Error in sendMessageStreamWithCallback:', error);
      // Send error as final chunk
      onText({ type: 'final', text: `Error: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /**
   * Safely retrieves agent cards, waiting for loading to finish if needed.
   */
  private async getAgentCards(): Promise<AgentCard[]> {
    if (this._agentCards) return this._agentCards;
    if (this._loadingPromise) return this._loadingPromise;

    // Fallback in case registerAgents wasn't called
    this.logger.info('Loading agents as fallback (registerAgents not called)');
    const cards = await this.loadAgents();
    this._agentCards = cards;
    return cards;
  }

  private async loadAgents(): Promise<AgentCard[]> {
    const agentLogger = this.logger.child('AgentLoader');

    const registeredAgents = await this.client.get<AgentSummary[]>(AGENT_LIST, { format: 'json' }) ?? [];
    agentLogger.info(`Found ${registeredAgents.length} registered agents`);

    const allAgents = [...new Set([...this.agentUrls ?? [], ...registeredAgents.filter((ra) => ra.url).map((ra) => ra.url)])];
    agentLogger.info(`Total unique agent URLs to load: ${allAgents.length}`);

    const results: AgentCard[] = [];

    for (let i = 0; i < allAgents.length; i += this.concurrencyLimit) {
      const chunk = allAgents.slice(i, i + this.concurrencyLimit);
      const chunkNum = Math.floor(i / this.concurrencyLimit) + 1;

      const chunkResults = await agentLogger.time(
        `Loading chunk ${chunkNum} (${chunk.length} agents)`,
        () => Promise.all(chunk.map((url) => this.loadAgentCard(url)))
      );

      results.push(...chunkResults);
    }

    agentLogger.info(`Successfully loaded ${results.length} agent cards`);
    return results;
  }

  private async loadAgentCard(url: string): Promise<AgentCard> {
    const cardLogger = this.logger.child('AgentCard');

    let card = await this.client.get<AgentCard>(url, { format: 'json' });
    if (!card) {
      cardLogger.log(`Fetching from: ${url}/.well-known/agent.json`);

      const response = await fetch(`${url}/.well-known/agent.json`);
      if (!response.ok) {
        const body = await response.text();
        cardLogger.error(`Failed to fetch from ${url}:`, response.status, body);
        throw new Error(`Failed to load agent card from ${url}`);
      }

      card = await response.json() as AgentCard;
      await this.client.set(url, card);
      cardLogger.log(`Cached agent card for: ${url}`);
    } else {
      cardLogger.log(`Using cached agent card for: ${url}`);
    }

    return card;
  }

  private buildAgent(agentCards: AgentCard[], contextId?: string, publishUpdate?: (text: string) => Promise<void>): Agent {
    const instructions = getSystemPrompt({ agentCards, contextId });

    // Check if we're approaching token limits
    const estimatedTokens = this.logger.estimateTokens(instructions + (contextId || ''));
    if (estimatedTokens > this.tokenWarningThreshold) {
      this.logger.warn(`System prompt approaching token limit: ${estimatedTokens} tokens (threshold: ${this.tokenWarningThreshold})`);
    }

    // Build tools array: custom tools + invokeAgent tool
    const tools = [
      ...this.customTools.map(t => createCustomTool(t, publishUpdate)),
      createInvokeAgentTool(publishUpdate)
    ];

    this.logger.info('Building agent', {
      model: this.model,
      agentCount: agentCards.length,
      contextId: contextId ? `${contextId.substring(0, 8)}...` : 'none',
      maxTokens: this.maxTokens,
      instructionsTokens: estimatedTokens,
      toolsCount: tools.length
    });

    return new Agent({
      model: this.model,
      name: 'A2A Orchestrator',
      tools,
      instructions,
      ...this.maxTokens && { modelSettings: { maxTokens: this.maxTokens } }
    });
  }
}
