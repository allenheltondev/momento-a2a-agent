import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { AmazonBedrockOrchestrator } from '../src/orchestrators/amazon_bedrock';
import { MomentoClient } from '../src/momento/client';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { AGENT_LIST } from '../src/momento/agent_registry';
import { AgentCard } from '../src/types';
import * as z from 'zod/v4';

vi.mock('../src/momento/client');
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: vi.fn(),
    ConverseCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    ConverseStreamCommand: vi.fn().mockImplementation((params) => ({ input: params }))
  } as any;
});

const dummyCard: AgentCard = {
  version: '1.0',
  name: 'WeatherAgent',
  description: 'Provides weather forecasts.',
  url: 'https://agent.example.com/weather',
  skills: [
    {
      id: 'weather',
      name: 'GetForecast',
      description: 'Get the weather forecast for a city.',
      examples: ['What is the weather in Rome tomorrow?'],
      tags: ['weather']
    }
  ],
  capabilities: {
    streaming: true
  },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text']
};

describe('AmazonBedrockOrchestrator', () => {
  let orchestrator: AmazonBedrockOrchestrator;
  let mockClientGet: any;
  let mockBedrockSend: any;
  let getMock: Mock;
  let setMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientGet = vi.fn();
    mockBedrockSend = vi.fn();
    getMock = vi.fn();
    setMock = vi.fn();
    (MomentoClient as unknown as Mock).mockImplementation(() => ({
      get: getMock,
      set: setMock,
    }));
    (BedrockRuntimeClient as any).mockImplementation(() => ({
      send: mockBedrockSend
    }));

    orchestrator = new AmazonBedrockOrchestrator({
      momento: { apiKey: 'test-key', cacheName: 'test-cache' }
    });
  });

  it('should initialize orchestrator with default values', () => {
    expect(orchestrator).toBeDefined();
    expect(orchestrator['concurrencyLimit']).toBeGreaterThan(0);
    expect(orchestrator['maxTokens']).toBeGreaterThan(0);
    expect(orchestrator['tokenWarningThreshold']).toBeGreaterThan(0);
  });

  it('should register agent URLs and trigger async load', async () => {
    getMock.mockImplementation(async (key: string) => {
      if (key === AGENT_LIST) {
        return [{ url: dummyCard.url, name: dummyCard.name, description: dummyCard.description }];
      } else if (key === dummyCard.url) {
        return dummyCard;
      }
      return null;
    });
    orchestrator.registerAgents([dummyCard.url]);
    await orchestrator['getAgentCards']();
    expect(getMock).toHaveBeenCalled();
    expect(orchestrator['isReady']()).toBe(true);
  });

  it('should return isReady as true when agent cards are loaded', async () => {
    orchestrator['agentUrls'] = [];
    orchestrator['_agentCards'] = [dummyCard];
    expect(orchestrator.isReady()).toBe(true);
  });

  it('should throw if no agents are provided', async () => {
    orchestrator['_agentCards'] = [];
    await expect(orchestrator.sendMessage({ message: 'Hello' })).rejects.toThrow('No agents were provided.');
  });

  it('should process a message and return a text response', async () => {
    orchestrator['_agentCards'] = [dummyCard];
    mockBedrockSend.mockResolvedValue({
      output: {
        message: {
          content: [{ text: 'Response from orchestrator' }]
        }
      }
    });
    const response = await orchestrator.sendMessage({ message: 'Hi' });
    expect(response).toBe('Response from orchestrator');
  });

  it('should estimate token count correctly', () => {
    const count = orchestrator['estimateTokenCount']([
      { role: 'user', content: [{ text: 'Hello world!' }] },
      { role: 'assistant', content: [{ text: 'Hi there!' }] }
    ]);
    expect(count).toBeGreaterThan(0);
  });

  it('should detect if enough tokens remain', () => {
    const messages = [{ role: 'user', content: [{ text: 'A'.repeat(20) }] }];
    const result = orchestrator['hasTokensRemaining'](messages);
    expect(typeof result).toBe('boolean');
  });

  it('should fallback to assistant message if no final response', async () => {
    orchestrator['_agentCards'] = [dummyCard];
    mockBedrockSend.mockResolvedValue({
      output: {
        message: {
          content: []
        }
      }
    });
    const response = await orchestrator.sendMessage({ message: 'Fallback' });
    expect(response).toContain('unexpected');
  });


  it('should yield streamed chunks and final text', async () => {
    orchestrator['_agentCards'] = [dummyCard];
    mockBedrockSend.mockResolvedValue({
      stream: {
        [Symbol.asyncIterator]: async function* () {
          // Start of message
          yield { messageStart: {} };

          // Start of content block (text)
          yield { contentBlockStart: { start: {} } };

          // Text deltas
          yield { contentBlockDelta: { delta: { text: 'Hello ' } } };
          yield { contentBlockDelta: { delta: { text: 'world!' } } };

          // End of content block
          yield { contentBlockStop: {} };

          // End of message
          yield { messageStop: {} };
        }
      }
    });

    const chunks: string[] = [];
    let final: string | null = null;

    for await (const chunk of orchestrator.sendMessageStream({ message: 'Hi' })) {
      if (chunk.type === 'chunk') {
        chunks.push(chunk.text);
      } else if (chunk.type === 'final') {
        final = chunk.text;
      }
    }

    expect(chunks.join('')).toBe('Hello world!');
    expect(final).toBe('Hello world!');
  });

  it('should process multiple tool calls in a single response', async () => {
    orchestrator['_agentCards'] = [dummyCard];

    // Mock the first response with multiple tool calls
    mockBedrockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [
            {
              toolUse: {
                toolUseId: 'tool1',
                name: 'invokeAgent',
                input: { agentUrl: 'https://agent1.com', message: 'test1' }
              }
            },
            {
              toolUse: {
                toolUseId: 'tool2',
                name: 'invokeAgent',
                input: { agentUrl: 'https://agent2.com', message: 'test2' }
              }
            }
          ]
        }
      }
    });

    // Mock the second response with final text after tool execution
    mockBedrockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: 'Final response after multiple tools' }]
        }
      }
    });

    // Mock fetch to simulate successful agent card fetching and tool responses
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dummyCard)
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dummyCard)
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('Tool 1 result')
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('Tool 2 result')
      });

    const response = await orchestrator.sendMessage({ message: 'Test multiple tools' });

    expect(response).toBe('Final response after multiple tools');
    expect(mockBedrockSend).toHaveBeenCalledTimes(2);

    // The key test: verify that both tool calls were processed
    // This proves the fix works - before the fix, only one tool would be called
    expect(global.fetch).toHaveBeenCalledWith('https://agent1.com/.well-known/agent.json', expect.any(Object));
    expect(global.fetch).toHaveBeenCalledWith('https://agent2.com/.well-known/agent.json', expect.any(Object));

    // Verify we got the expected final response
    expect(response).toBe('Final response after multiple tools');
  });


  it('should include additionalSystemPrompt in system prompt', async () => {
    orchestrator = new AmazonBedrockOrchestrator({
      momento: { apiKey: 'test-key', cacheName: 'test-cache' },
      config: { systemPrompt: 'Use tools aggressively and summarize at the end.' }
    });
    orchestrator['\u005fagentCards'] = [dummyCard];

    mockBedrockSend.mockResolvedValue({
      output: { message: { content: [{ text: 'ok' }] } }
    });

    await orchestrator.sendMessage({ message: 'Hi' });
    expect(mockBedrockSend).toHaveBeenCalled();
    const cmd = mockBedrockSend.mock.calls[0][0];
    const systemText = cmd.input?.system?.[0]?.text || '';
    expect(systemText).toContain('ADDITIONAL INSTRUCTIONS');
    expect(systemText).toContain('Use tools aggressively and summarize at the end.');
  });

});

describe('AmazonBedrockOrchestrator - custom tools', () => {
  let orchestrator: AmazonBedrockOrchestrator;
  let mockBedrockSend: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (MomentoClient as unknown as Mock).mockImplementation(() => ({ get: vi.fn(), set: vi.fn() }));
    mockBedrockSend = vi.fn();
    (BedrockRuntimeClient as any).mockImplementation(() => ({ send: mockBedrockSend }));
  });

  it('should include user-provided tools in toolConfig', async () => {
    const customTool = {
      name: 'getTime',
      description: 'Get current time',
      schema: z.object({ tz: z.string().optional() }),
      handler: vi.fn().mockResolvedValue('00:00')
    };

    orchestrator = new AmazonBedrockOrchestrator({
      momento: { apiKey: 'key', cacheName: 'cache' },
      tools: [customTool]
    });
    // Prepare one agent card so isReady passes
    orchestrator['\u005fagentCards'] = [dummyCard];

    // First call returns final text so we can inspect command input
    mockBedrockSend.mockResolvedValueOnce({
      output: { message: { content: [{ text: 'ok' }] } }
    });

    await orchestrator.sendMessage({ message: 'hi' });

    expect(mockBedrockSend).toHaveBeenCalled();
    const cmd = mockBedrockSend.mock.calls[0][0];
    const tools = cmd.input?.toolConfig?.tools?.map((t: any) => t.toolSpec?.name);
    expect(tools).toContain('invokeAgent');
    expect(tools).toContain('getTime');
  });

  it('should execute a user-provided tool when called by the model', async () => {
    const echoTool = {
      name: 'echoThing',
      description: 'Echo the provided text',
      schema: z.object({ text: z.string() }),
      handler: vi.fn().mockImplementation(async ({ text }: { text: string }) => `ECHO:${text}`)
    };

    orchestrator = new AmazonBedrockOrchestrator({
      momento: { apiKey: 'key', cacheName: 'cache' },
      tools: [echoTool]
    });
    orchestrator['\u005fagentCards'] = [dummyCard];

    // 1st model response: tool call
    mockBedrockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [
            { toolUse: { toolUseId: 't1', name: 'echoThing', input: { text: 'hello' } } }
          ]
        }
      }
    });
    // 2nd model response: final text after tool result
    mockBedrockSend.mockResolvedValueOnce({
      output: {
        message: { content: [{ text: 'done' }] }
      }
    });

    const result = await orchestrator.sendMessage({ message: 'use the tool' });
    expect(result).toBe('done');
    expect(echoTool.handler).toHaveBeenCalledWith({ text: 'hello' });
    expect(mockBedrockSend).toHaveBeenCalledTimes(2);
  });
});
