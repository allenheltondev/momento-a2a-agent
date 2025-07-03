import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { AmazonBedrockOrchestrator } from '../src/orchestrators/amazon_bedrock';
import { MomentoClient } from '../src/momento/client';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { AGENT_LIST } from '../src/momento/agent_registry';
import { AgentCard } from '../src/types';

vi.mock('../src/momento/client');
vi.mock('@aws-sdk/client-bedrock-runtime');

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
    streaming: false
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
});
