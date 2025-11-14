// The aws sdk is not included in this package. When using this in Lambda, it will use the provided SDK in the runtime. Otherwise this must be installed separately.
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Message, ContentBlock, ToolUseBlock, ToolResultBlock } from '@aws-sdk/client-bedrock-runtime';
import { MomentoClient } from '../momento/client.js';
import { AGENT_LIST } from '../momento/agent_registry.js';
import { AgentCard, AgentSummary } from '../types.js';
import { invokeAgent } from '../client/tools.js';
import { getSystemPrompt } from './prompt.js';
import { DEFAULTS } from './config.js';
import * as z from 'zod/v4';
import { OrchestratorLogger } from './logger.js';
import { sanitizeResponse } from './utils.js';

export type AmazonBedrockOrchestratorParams = {
  momento: {
    apiKey: string;
    cacheName: string;
  };
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
    tools?: Array<{
      name: string;
      description: string;
      schema: any;
      handler: (input: any) => Promise<any> | any;
    }>;
  };
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

const invokeAgentTool = {
  spec: {
    name: invokeAgent.name,
    description: invokeAgent.description,
    inputSchema: { json: z.toJSONSchema(invokeAgent.schema) as any },
  },
  handler: invokeAgent.handler
};

type BedrockTool = typeof invokeAgentTool;

/**
 * Orchestrates conversations between the user and distributed A2A agents using Amazon Bedrock.
 */
export class AmazonBedrockOrchestrator {
  private client: MomentoClient;
  private model: string;
  private agentUrls: string[] = [];
  private concurrencyLimit: number;
  private maxTokens: number;
  private tokenWarningThreshold: number;
  private _agentCards: AgentCard[] | null = null;
  private _loadingPromise: Promise<AgentCard[]> | null = null;
  private bedrock: BedrockRuntimeClient;
  private logger: OrchestratorLogger;
  private preserveThinkingTags: boolean;
  private additionalSystemPrompt?: string;
  private tools: BedrockTool[];

  constructor(params: AmazonBedrockOrchestratorParams) {
    this.client = new MomentoClient({
      apiKey: params.momento.apiKey,
      cacheName: params.momento.cacheName
    });

    this.bedrock = new BedrockRuntimeClient({
      ...(params.bedrock?.accessKeyId && params.bedrock?.secretAccessKey) && {
        credentials: {
          accessKeyId: params.bedrock.accessKeyId,
          secretAccessKey: params.bedrock.secretAccessKey,
        }
      },
      ...params.bedrock?.region && { region: params.bedrock.region },
      ...params.bedrock?.profile && { profile: params.bedrock.profile }
    });

    this.model = params.bedrock?.modelId || 'amazon.nova-lite-v1:0';
    this.concurrencyLimit = params.config?.agentLoadingConcurrency || DEFAULTS.CONCURRENCY_LIMIT;
    this.maxTokens = params.config?.maxTokens || DEFAULTS.MAX_TOKENS;
    this.tokenWarningThreshold = params.config?.tokenWarningThreshold || (this.maxTokens ? Math.floor(this.maxTokens * 0.8) : 8000);
    this.preserveThinkingTags = params.config?.preserveThinkingTags || false;
    this.additionalSystemPrompt = params.config?.systemPrompt;
    this.logger = new OrchestratorLogger(params.config?.debug || false, 'Bedrock');

    this.tools = [
      invokeAgentTool,
      ...(params.config?.tools?.map((t) => ({
        spec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.schema }
        },
        handler: t.handler
      })) || [])
    ];
    this.logger.info('Orchestrator initialized', {
      model: this.model,
      maxTokens: this.maxTokens,
      tokenWarningThreshold: this.tokenWarningThreshold,
      concurrencyLimit: this.concurrencyLimit
    });
  }

  /**
   * Registers additional agent URLs that can be used for orchestration.
   * @param agentUrls - List of agent endpoint URLs.
   */
  registerAgents(agentUrls: string[]) {
    this.agentUrls = agentUrls;
    this._agentCards = null;

    // Begin loading agents asynchronously
    this._loadingPromise = this.loadAgents()
      .then((cards) => {
        this._agentCards = cards;
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
    // Ready if:
    // - Explicit agents were provided and have been loaded, or
    // - No explicit agents were registered (allow operation without agents)
    if (this.agentUrls.length > 0) {
      return !!this._agentCards;
    }
    return true;
  }

  /**
   * Sends a message to the orchestrator and returns the final response text.
   * @param params - Message and optional context ID.
   */
  async sendMessage(params: SendMessageParams): Promise<string> {
    return this.logger.time('sendMessage', async () => {
      const agentCards = await this.getAgentCards();
      if (agentCards.length === 0) {
        throw new Error('No agents were provided.');
      }

      const messages: Message[] = [{ role: 'user', content: [{ text: params.message }] }];
      let finalResponse = '';
      let iteration = 0;

      while (this.hasTokensRemaining(messages)) {
        iteration++;
        const currentTokens = this.estimateTokenCount(messages);
        this.logger.info(`Iteration ${iteration}: Current token count: ${currentTokens}/${this.maxTokens}`);

        try {
          const command = this.buildConverseCommand(agentCards, messages, params.contextId, this.maxTokens);
          const response = await this.bedrock.send(command);

          if (!response.output?.message?.content) {
            this.logger.warn(`No message output on iteration ${iteration + 1}. Response:`, JSON.stringify(response, null, 2));
            break;
          }

          const messageContent = response.output.message.content;
          messages.push({ role: 'assistant', content: messageContent });

          // Check if we have tool use or just text
          const toolUseItems = messageContent.filter((item): item is ContentBlock & { toolUse: ToolUseBlock; } =>
            'toolUse' in item && !!item.toolUse
          );
          const textItems = messageContent.filter((item): item is ContentBlock & { text: string; } =>
            'text' in item && !!item.text
          );

          if (toolUseItems.length > 0) {
            this.logger.info(`Iteration ${iteration + 1}: Processing ${toolUseItems.length} tool call(s)`);

            // Execute all tools and collect results
            const toolResults: ToolResultBlock[] = [];

            for (const toolUseItem of toolUseItems) {
              const { toolUse } = toolUseItem;
              const { name: toolName, input: toolInput, toolUseId } = toolUse;

              this.logger.info(`Iteration ${iteration + 1}: Tool called: ${toolName}`, { toolInput, toolUseId });

              if (params.publishUpdate) {
                await params.publishUpdate(`Invoking tool: ${toolName}`);
              }

              // Execute the tool
              let toolResult: any;
              let toolError: string | undefined;
              try {
                const tool = this.tools.find(t => t.spec.name === toolName);
                if (!tool) {
                  throw new Error(`Unknown tool: ${toolName}`);
                }
                toolResult = await tool.handler(toolInput);
                this.logger.info(`Tool ${toolName} result:`, toolResult);
              } catch (error: any) {
                toolError = error.message;
                this.logger.error(`Tool ${toolName} failed:`, error);
                toolResult = { error: error.message };
              }

              if (params.publishUpdate) {
                const statusMessage = toolError
                  ? `Tool ${toolName} failed: ${toolError}`
                  : `Tool ${toolName} completed successfully`;
                await params.publishUpdate(statusMessage);
              }

              // Add the tool result to our collection
              toolResults.push({
                toolUseId,
                content: [{ text: JSON.stringify(toolResult) }]
              });
            }

            // Add all tool results back to the conversation in a single message
            messages.push({
              role: 'user',
              content: toolResults.map(result => ({ toolResult: result }))
            });

            // Continue the loop to get the model's response to the tool results
          } else if (textItems.length > 0) {
            // We got text response(s) - concatenate them and we're done
            finalResponse = textItems.map(item => item.text).join('');
            this.logger.info(`Iteration ${iteration + 1}: Final response received`);
            break;
          } else {
            // Unexpected case - no tool use and no text
            this.logger.warn(`Iteration ${iteration + 1}: Unexpected content structure:`, messageContent);
            finalResponse = 'Received unexpected response type from model';
            break;
          }
        } catch (error) {
          this.logger.error(`Error on iteration ${iteration}:`, error);
          throw new Error(`Failed to process message on iteration ${iteration}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Check if we stopped due to token limit
      if (!finalResponse && !this.hasTokensRemaining(messages)) {
        this.logger.warn(`Stopped due to token limit. Current tokens: ${this.estimateTokenCount(messages)}/${this.maxTokens}`);
      }

      if (!finalResponse && messages.length > 1) {
        // If we didn't get a final response but have messages, try to extract from last assistant message
        const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistantMessage?.content) {
          const textContent = lastAssistantMessage.content
            .filter((item): item is ContentBlock & { text: string; } => 'text' in item && !!item.text)
            .map(item => item.text)
            .join('');
          if (textContent) {
            finalResponse = textContent;
          }
        }
      }

      return sanitizeResponse(finalResponse, { preserveThinkingTags: this.preserveThinkingTags }) || 'No response generated';
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

    const messages: Message[] = [{ role: 'user', content: [{ text: params.message }] }];
    let iteration = 0;

    while (this.hasTokensRemaining(messages)) {
      iteration++;
      const currentTokens = this.estimateTokenCount(messages);
      this.logger.info(`Stream iteration ${iteration}: Current token count: ${currentTokens}/${this.maxTokens}`);

      try {
        const command = this.buildConverseStreamCommand(agentCards, messages, params.contextId, this.maxTokens);
        const response = await this.bedrock.send(command);

        if (!response.stream) {
          throw new Error('No stream received from Bedrock');
        }

        let currentToolUse: ToolUseBlock | null = null;
        let streamedText = '';
        let messageContent: ContentBlock[] = [];

        for await (const chunk of response.stream) {
          if (chunk.messageStart) {
            // New message starting
            continue;
          } else if (chunk.contentBlockStart) {
            // Content block starting
            if (chunk.contentBlockStart.start?.toolUse) {
              currentToolUse = {
                toolUseId: chunk.contentBlockStart.start.toolUse.toolUseId,
                name: chunk.contentBlockStart.start.toolUse.name,
                input: {}
              };
            }
          } else if (chunk.contentBlockDelta) {
            if (chunk.contentBlockDelta.delta?.text) {
              // Text delta - yield it
              const textChunk = chunk.contentBlockDelta.delta.text;
              streamedText += textChunk;
              yield { type: 'chunk', text: textChunk };
            } else if (chunk.contentBlockDelta.delta?.toolUse && currentToolUse) {
              const deltaInput = chunk.contentBlockDelta.delta.toolUse.input;
              this.logger.info(`Stream iteration ${iteration}: Tool input delta:`, deltaInput);
              if (deltaInput) {
                try {
                  const input = JSON.parse(deltaInput);
                  currentToolUse.input = input;
                } catch (err) {
                  currentToolUse.input = {};
                }
              }
            }
          } else if (chunk.contentBlockStop) {
            if (currentToolUse) {
              // Add the completed tool use to message content
              messageContent.push({ toolUse: currentToolUse });
              currentToolUse = null;
            } else if (streamedText) {
              // Add the completed text to message content
              messageContent.push({ text: streamedText });
            }
          } else if (chunk.messageStop) {
            // Message is complete
            break;
          }
        }

        // Add the assistant's message to the conversation
        if (messageContent.length > 0) {
          messages.push({ role: 'assistant', content: messageContent });
        }

        // Check what type of content we received
        const toolUseItems = messageContent.filter((item): item is ContentBlock & { toolUse: ToolUseBlock; } =>
          'toolUse' in item && !!item.toolUse
        );
        const textItems = messageContent.filter((item): item is ContentBlock & { text: string; } =>
          'text' in item && !!item.text
        );

        if (toolUseItems.length > 0) {
          this.logger.info(`Stream iteration ${iteration}: Processing ${toolUseItems.length} tool call(s)`);

          // Execute all tools and collect results
          const toolResults: ToolResultBlock[] = [];

          for (const toolUseItem of toolUseItems) {
            const { toolUse } = toolUseItem;
            const { name: toolName, input: toolInput, toolUseId } = toolUse;

            this.logger.info(`Stream iteration ${iteration}: Tool called: ${toolName}`, { toolInput, toolUseId });

            if (params.publishUpdate) {
              await params.publishUpdate(`Invoking tool: ${toolName}`);
            }

            let toolResult: any;
            let toolError: string | undefined;
            try {
              const tool = this.tools.find(t => t.spec.name === toolName);
              if (!tool) {
                throw new Error(`Unknown tool: ${toolName}`);
              }
              toolResult = await tool.handler(toolInput);
              this.logger.info(`Tool ${toolName} result:`, toolResult);
            } catch (error: any) {
              toolError = error.message;
              this.logger.error(`Tool ${toolName} failed:`, error);
              toolResult = { error: error.message };
            }

            if (params.publishUpdate) {
              const statusMessage = toolError
                ? `Tool ${toolName} failed: ${toolError}`
                : `Tool ${toolName} completed successfully`;
              await params.publishUpdate(statusMessage);
            }

            // Add the tool result to our collection
            toolResults.push({
              toolUseId,
              content: [{ text: JSON.stringify(toolResult) }]
            });
          }

          // Add all tool results back to the conversation in a single message
          messages.push({
            role: 'user',
            content: toolResults.map(result => ({ toolResult: result }))
          });

          // Continue the loop to get the model's response to the tool results
          continue;
        } else if (textItems.length > 0) {
          // We got text response(s) - this is our final response
          const finalResponse = textItems.map(item => item.text).join('');
          this.logger.info(`Stream iteration ${iteration}: Final response completed`);
          yield { type: 'final', text: sanitizeResponse(finalResponse, { preserveThinkingTags: this.preserveThinkingTags }) };
          return;
        } else {
          // Unexpected case - no tool use and no text
          this.logger.warn(`Stream iteration ${iteration}: Unexpected content structure:`, messageContent);
          yield { type: 'final', text: 'Received unexpected response type from model' };
          return;
        }

      } catch (error) {
        this.logger.error(`Error on stream iteration ${iteration}:`, error);
        throw new Error(`Failed to process message stream on iteration ${iteration}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // If we reach here, we've hit token limit
    this.logger.warn(`Stream stopped due to token limit. Current tokens: ${this.estimateTokenCount(messages)}/${this.maxTokens}`);
    yield { type: 'final', text: 'Token limit reached without final response' };
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
   * Estimates token count for a message array (rough approximation)
   * This is a simple heuristic - for production you might want to use a proper tokenizer
   */
  private estimateTokenCount(messages: Message[]): number {
    let totalText = '';
    for (const message of messages) {
      if (message.content) {
        for (const content of message.content) {
          if ('text' in content && content.text) {
            totalText += content.text;
          } else if ('toolUse' in content && content.toolUse) {
            totalText += JSON.stringify(content.toolUse);
          } else if ('toolResult' in content && content.toolResult) {
            totalText += JSON.stringify(content.toolResult);
          }
        }
      }
    }
    return this.logger.estimateTokens(totalText);
  }

  /**
   * Checks if we have enough tokens remaining for another iteration
   */
  private hasTokensRemaining(messages: Message[]): boolean {
    const currentTokens = this.estimateTokenCount(messages);
    return currentTokens < this.tokenWarningThreshold;
  }

  private async getAgentCards(): Promise<AgentCard[]> {
    if (this._agentCards) return this._agentCards;
    if (this._loadingPromise) return this._loadingPromise;

    // Fallback in case registerAgents wasn't called
    const cards = await this.loadAgents();
    this._agentCards = cards;
    return cards;
  }

  private async loadAgents(): Promise<AgentCard[]> {
    const registeredAgents = await this.client.get<AgentSummary[]>(AGENT_LIST, { format: 'json' }) ?? [];
    const allAgents = [...new Set([...this.agentUrls ?? [], ...registeredAgents.filter((ra) => ra.url).map((ra) => ra.url)])];
    const results: AgentCard[] = [];

    for (let i = 0; i < allAgents.length; i += this.concurrencyLimit) {
      const chunk = allAgents.slice(i, i + this.concurrencyLimit);
      const chunkResults = await Promise.all(chunk.map((url) => this.loadAgentCard(url)));
      results.push(...chunkResults);
    }

    return results;
  }

  private async loadAgentCard(url: string): Promise<AgentCard> {
    let card = await this.client.get<AgentCard>(url, { format: 'json' });
    if (!card) {
      const response = await fetch(`${url}/.well-known/agent.json`);
      if (!response.ok) {
        const body = await response.text();
        this.logger.error(response.status, body);
        throw new Error(`Failed to load agent card from ${url}`);
      }

      card = await response.json() as AgentCard;
      await this.client.set(url, card);
    }
    return card;
  }

  private buildConverseCommand(agentCards: AgentCard[], messages: Message[], contextId?: string, maxTokens?: number): ConverseCommand {
    const system = getSystemPrompt({ agentCards, contextId, additionalSystemPrompt: this.additionalSystemPrompt });
    this.logger.logTokenEstimate('System prompt', system);
    const params = {
      modelId: this.model,
      system: [{ text: system }],
      messages,
      toolConfig: {
        tools: this.tools.map((t) => ({ toolSpec: t.spec }))
      },
      ...(maxTokens && { inferenceConfig: { maxTokens } })
    };
    return new ConverseCommand(params);
  }

  private buildConverseStreamCommand(agentCards: AgentCard[], messages: Message[], contextId?: string, maxTokens?: number): ConverseStreamCommand {
    const system = getSystemPrompt({ agentCards, contextId, additionalSystemPrompt: this.additionalSystemPrompt });
    this.logger.logTokenEstimate('System prompt', system);
    const params = {
      modelId: this.model,
      system: [{ text: system }],
      messages,
      toolConfig: {
        tools: this.tools.map((t) => ({ toolSpec: t.spec }))
      },
      ...(maxTokens && { inferenceConfig: { maxTokens } })
    };
    return new ConverseStreamCommand(params);
  }
}
