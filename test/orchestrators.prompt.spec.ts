import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSystemPrompt } from '../src/orchestrators/prompt';
import type { AgentCard } from '../src/types';

describe('getSystemPrompt', () => {
  const mockDate = '2025-07-02T12:00:00.000Z';

  const mockAgentCards: AgentCard[] = [
    {
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
    },
    {
      version: '1.0',
      name: 'AirbnbAgent',
      description: 'Finds lodging options.',
      url: 'https://agent.example.com/airbnb',
      skills: [
        {
          id: 'find',
          name: 'FindStay',
          description: 'Find a place to stay.',
          examples: ['Where can I stay in Rome for under $100'],
          tags: ['lodging']
        }
      ],
      capabilities: {
        streaming: false
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text']
    }
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(mockDate));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes agent cards in the prompt', () => {
    const result = getSystemPrompt({ agentCards: mockAgentCards });
    expect(result).toContain('Agent: WeatherAgent');
    expect(result).toContain('Agent: AirbnbAgent');
    expect(result).toContain('Finds lodging options.');
  });

  it('includes the ISO date', () => {
    const result = getSystemPrompt({ agentCards: mockAgentCards });
    expect(result).toContain(`Current time: ${mockDate}`);
  });

  it('includes contextId if provided', () => {
    const result = getSystemPrompt({
      agentCards: mockAgentCards,
      contextId: 'abc-123'
    });
    expect(result).toContain('Context ID: "abc-123" (include this in all invokeAgent calls)');
  });

  it('does not include contextId section if not provided', () => {
    const result = getSystemPrompt({ agentCards: mockAgentCards });
    expect(result).not.toContain('Context ID:');
  });

  it('includes key system instructions and delegation examples', () => {
    const result = getSystemPrompt({ agentCards: mockAgentCards });
    expect(result).toMatch(/You are an autonomous orchestration agent/i);
    expect(result).toMatch(/DELEGATION EXAMPLES/i);
    expect(result).toMatch(/→ Step 1:.*WeatherAgent/i);
  });

  it('includes examples from agent card', () => {
    const result = getSystemPrompt({ agentCards: mockAgentCards });
    expect(result).toContain('Examples:');
    expect(result).toContain('What is the weather in Rome tomorrow?');
    expect(result).toContain('Where can I stay in Rome for under $100')
  });

  it('includes additional system instructions when provided', () => {
    const extra = 'Always verify data sources before answering.';
    const result = getSystemPrompt({ agentCards: mockAgentCards, additionalSystemPrompt: extra });
    expect(result).toContain('ADDITIONAL INSTRUCTIONS');
    expect(result).toContain(extra);
  });
});
