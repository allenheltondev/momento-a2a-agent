import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MomentoAgentRequestHandler } from '../src/agent/request_handler';
import { AgentCard, Task } from '../src/types';
import { MomentoAgentExecutor } from '../src/agent/executor';

vi.mock('../src/store/task_store', () => ({
  MomentoTaskStore: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    save: vi.fn(),
  })),
}));

vi.mock('../src/momento/client', () => ({
  MomentoClient: vi.fn().mockImplementation(() => ({
    isValidConnection: vi.fn().mockResolvedValue(true),
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

vi.mock('../src/event/event_bus', () => ({
  MomentoEventBus: vi.fn().mockImplementation(() => ({
    registerContext: vi.fn(),
    unregisterContext: vi.fn(),
    publish: vi.fn(),
  })),
}));

vi.mock('../src/event/queue', () => ({
  ExecutionEventQueue: vi.fn().mockImplementation(() => ({
    stop: vi.fn(),
    events: async function* () {}, // empty iterator
  })),
}));

vi.mock('../src/server/result_manager', () => ({
  ResultManager: vi.fn().mockImplementation(() => ({
    setContext: vi.fn(),
    processEvent: vi.fn(),
  })),
}));

const agentCard: AgentCard = {
  name: 'Test Agent',
  description: 'desc',
  url: 'https://agent.dev',
  capabilities: { pushNotifications: true },
  skills: [],
  version: '1.0.0',
  defaultInputModes: ['text'],
  defaultOutputModes: ['text']
};

const executor = {
  execute: vi.fn().mockResolvedValue(undefined)
} as unknown as MomentoAgentExecutor;

describe('MomentoAgentRequestHandler', () => {
  let handler: MomentoAgentRequestHandler;

  beforeEach(() => {
    const mockTaskStore = {
      load: vi.fn(),
      save: vi.fn(),
    };
    const mockEventBus = {
      registerContext: vi.fn(),
      unregisterContext: vi.fn(),
      publish: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      onContext: vi.fn(),
    };
    handler = new MomentoAgentRequestHandler({
      momentoApiKey: 'key',
      cacheName: 'cache',
      agentCard,
      executor,
      taskStore: mockTaskStore as any,
      eventBus: mockEventBus as any,
    });
  });

  it('should verify connection', async () => {
    const result = await handler.verifyConnection();
    expect(result).toBe(true);
  });

  it('should return agent card', async () => {
    const card = await handler.getAgentCard();
    expect(card).toEqual(agentCard);
  });

  it('throws if messageId is missing in sendMessage', async () => {
    await expect(
      handler.sendMessage({ message: { messageId: '' } as any })
    ).rejects.toThrow(/messageId is required/);
  });

  it('throws if task is not found', async () => {
    const store = (handler as any).taskStore;
    store.load.mockResolvedValue(undefined);
    await expect(handler.getTask({ id: 'missing-id' })).rejects.toThrow(/Task not found/);
  });

  it('throws if task is final when canceling', async () => {
    const store = (handler as any).taskStore;
    store.load.mockResolvedValue({
      id: 'task1',
      contextId: 'ctx',
      status: { state: 'completed' },
    });
    await expect(handler.cancelTask({ id: 'task1' })).rejects.toThrow(/not cancelable/);
  });

  it('throws if task is missing on push config set', async () => {
    const store = (handler as any).taskStore;
    store.load.mockResolvedValue(undefined);
    await expect(handler.setTaskPushNotificationConfig({
      taskId: 't1',
      pushNotificationConfig: { endpoint: 'https://p.com' },
    })).rejects.toThrow(/Task not found/);
  });

  it('throws if push notifications are not supported', async () => {
    const mockTaskStore = {
      load: vi.fn(),
      save: vi.fn(),
    };
    const mockEventBus = {
      registerContext: vi.fn(),
      unregisterContext: vi.fn(),
      publish: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      onContext: vi.fn(),
    };
    const noPushHandler = new MomentoAgentRequestHandler({
      momentoApiKey: 'key',
      cacheName: 'cache',
      agentCard: { ...agentCard, capabilities: {} },
      executor,
      taskStore: mockTaskStore as any,
      eventBus: mockEventBus as any,
    });

    await expect(noPushHandler.setTaskPushNotificationConfig({
      taskId: 't1',
      pushNotificationConfig: { endpoint: 'https://p.com' },
    })).rejects.toThrow(/not supported/);
  });

  it('throws if config not found in get push config', async () => {
    const store = (handler as any).taskStore;
    store.load.mockResolvedValue({ id: 't1', contextId: 'c1', status: { state: 'started' } });

    const client = (handler as any).client;
    client.get.mockResolvedValue(undefined);

    await expect(handler.getTaskPushNotificationConfig({ id: 't1' })).rejects.toThrow(/not found/);
  });
});
