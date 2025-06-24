import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { OpenAIOrchestrator, OpenAiOrchestratorParams } from '../src/orchestrators/openai';
import { MomentoClient } from '../src/momento/client';
import { AgentCard, AgentSummary } from '../src/types';
import { AGENT_LIST } from '../src/momento/agent_registry';

vi.mock('../src/momento/client');
vi.mock('@openai/agents', async () => {
  const actual = await vi.importActual('@openai/agents');
  return {
    ...actual,
    MCPServerStdio: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      close: vi.fn(),
    })),
    Agent: vi.fn().mockImplementation(() => ({})),
    run: vi.fn().mockResolvedValue({ finalOutput: 'mock-output' }),
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

  it('should format agent card to prompt correctly', () => {
    const card = getAgentCard();
    const output = orchestrator['agentCardToPromptFormat'](card);
    expect(output).toContain('Agent: Mock Agent');
    expect(output).toContain('Examples:');
    expect(output).toContain('Example 1');
    expect(output).toContain('Example 2');
  });

  afterEach(() => {
    vi.clearAllMocks();
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
