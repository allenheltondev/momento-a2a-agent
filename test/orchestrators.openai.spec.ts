import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { OpenAIOrchestrator, OpenAiOrchestratorParams, StreamChunk } from '../src/orchestrators/openai';
import { MomentoClient } from '../src/momento/client';
import { AgentCard, AgentSummary } from '../src/types';
import { AGENT_LIST } from '../src/momento/agent_registry';

vi.mock('../src/momento/client');
vi.mock('@openai/agents', async () => {
  const actual = await vi.importActual('@openai/agents');
  return {
    ...actual,
    Agent: vi.fn().mockImplementation(() => ({})),
    run: vi.fn().mockImplementation((_agent, _msg, opts) => {
      if (opts.stream) {
        return {
          toTextStream: () => ({
            [Symbol.asyncIterator]: async function* () {
              yield 'stream-1';
              yield 'stream-2';
            }
          })
        };
      } else {
        return Promise.resolve({ finalOutput: 'mock-output' });
      }
    })
  };
});

describe('OpenAIOrchestrator', () => {
  const defaultParams: OpenAiOrchestratorParams = {
    momento: { apiKey: 'momento-key', cacheName: 'cache' },
    openai: { apiKey: 'openai-key', model: 'gpt-test' },
  };

  let orchestrator: OpenAIOrchestrator;
  let getMock: Mock;
  let setMock: Mock;

  beforeEach(() => {
    getMock = vi.fn();
    setMock = vi.fn();
    (MomentoClient as unknown as Mock).mockImplementation(() => ({
      get: getMock,
      set: setMock,
    }));
    orchestrator = new OpenAIOrchestrator(defaultParams);
  });

  it('should set model and register agent URLs', () => {
    orchestrator.registerAgents(['https://agent.url']);
    expect(orchestrator['model']).toBe('gpt-test');
    expect(orchestrator['agentUrls']).toEqual(['https://agent.url']);
  });

  it('should throw if no agents are loaded', async () => {
    getMock.mockResolvedValue([]);
    orchestrator.registerAgents([]);
    await expect(orchestrator.sendMessage({ message: 'hi' })).rejects.toThrow('No agents were provided.');
  });

  it('should load and cache agent card if not in Momento', async () => {
    orchestrator.registerAgents(['https://test.agent']);
    getMock.mockResolvedValueOnce(null);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        name: 'Test Agent',
        description: 'desc',
        url: 'https://test.agent',
        skills: [],
      }),
    }) as any;

    await orchestrator.sendMessage({ message: 'test message' });

    expect(fetch).toHaveBeenCalledWith('https://test.agent/.well-known/agent.json');
    expect(setMock).toHaveBeenCalled();
  });

  it('should return final output from orchestrator run', async () => {
    const card = getAgentCard();

    getMock.mockImplementation(async (key: string) => {
      if (key === AGENT_LIST) {
        const summary: AgentSummary[] = [{ url: 'https://agent1.com', name: '', description: '' }];
        return summary;
      } else {
        return card;
      }
    });

    orchestrator.registerAgents([]);
    const result = await orchestrator.sendMessage({ message: 'what is this?' });
    expect(result).toBe('mock-output');
  });

  it('should support streaming output via sendMessageStream()', async () => {
    getMock.mockImplementation(async (key: string) => {
      if (key === AGENT_LIST) {
        return [{ url: 'http://agent', name: '', description: '' }];
      } else if (key === 'http://agent') {
        return getAgentCard();
      }
      return null;
    });
    orchestrator.registerAgents(['http://agent']);

    const chunks: StreamChunk[] = [];
    for await (const chunk of orchestrator.sendMessageStream({ message: 'stream me' })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'chunk', text: 'stream-1' },
      { type: 'chunk', text: 'stream-2' }]);
  });

  it('should support streaming output via sendMessageStreamWithCallback()', async () => {
    const card = getAgentCard();
    getMock.mockImplementation(async (key: string) => {
      if (key === AGENT_LIST) {
        return [{ url: 'http://agent', name: '', description: '' }];
      } else if (key === 'http://agent') {
        return getAgentCard();
      }
      return null;
    });
    orchestrator.registerAgents(['http://agent']);

    const results: StreamChunk[] = [];
    await orchestrator.sendMessageStreamWithCallback({ message: 'stream me' }, (chunk) => {
      results.push(chunk);
    });

    expect(results).toEqual([
      { type: 'chunk', text: 'stream-1' },
      { type: 'chunk', text: 'stream-2' }]);
  });

  it('should fallback to loading agents immediately if registerAgents is not called', async () => {
    const card = getAgentCard();
    getMock.mockImplementation(async (key: string) => {
      if (key === AGENT_LIST) {
        return [{ url: card.url, name: card.name, description: card.description }];
      } else if (key === card.url) {
        return card;
      }
      return null;
    });

    const result = await orchestrator.sendMessage({ message: 'fallback test' });
    expect(result).toBe('mock-output');
  });

  it('should throw if agent card fetch fails', async () => {
    orchestrator.registerAgents(['https://bad.agent']);
    getMock.mockResolvedValueOnce(null);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue('Not found'),
    }) as any;

    await expect(orchestrator.sendMessage({ message: 'test' })).rejects.toThrow(
      'Failed to load agent card from https://bad.agent'
    );
  });
});

function getAgentCard(): AgentCard {
  return {
    name: 'Mock Agent',
    description: 'Handles things',
    url: 'http://agent',
    skills: [
      {
        id: 'ms',
        name: 'MockSkill',
        description: 'Does something',
        examples: ['Example 1', 'Example 2'],
        tags: ['test']
      },
    ],
    capabilities: { streaming: true },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    version: '1.0'
  };
}
