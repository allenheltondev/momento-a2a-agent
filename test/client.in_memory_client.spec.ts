import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InMemoryClient } from '../src/client/in_memory_client';

describe('InMemoryClient', () => {
  let client: InMemoryClient;

  beforeEach(() => {
    client = new InMemoryClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('get and set', () => {
    it('should store and retrieve string values', async () => {
      await client.set('key1', 'value1');
      const result = await client.get('key1');
      expect(result).toBe('value1');
    });

    it('should store and retrieve JSON values', async () => {
      const obj = { name: 'test', count: 42 };
      await client.set('key2', obj);
      const result = await client.get<typeof obj>('key2', { format: 'json' });
      expect(result).toEqual(obj);
    });

    it('should return undefined for non-existent keys', async () => {
      const result = await client.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing values', async () => {
      await client.set('key3', 'value1');
      await client.set('key3', 'value2');
      const result = await client.get('key3');
      expect(result).toBe('value2');
    });
  });

  describe('TTL expiration', () => {
    it('should expire values after TTL', async () => {
      await client.set('key4', 'value4', { ttlSeconds: 5 });

      let result = await client.get('key4');
      expect(result).toBe('value4');

      vi.advanceTimersByTime(5000);

      result = await client.get('key4');
      expect(result).toBeUndefined();
    });

    it('should not expire values without TTL', async () => {
      await client.set('key5', 'value5');

      vi.advanceTimersByTime(10000);

      const result = await client.get('key5');
      expect(result).toBe('value5');
    });

    it('should clear old timer when updating value with new TTL', async () => {
      await client.set('key6', 'value6', { ttlSeconds: 5 });
      await client.set('key6', 'value6-updated', { ttlSeconds: 10 });

      vi.advanceTimersByTime(5000);
      let result = await client.get('key6');
      expect(result).toBe('value6-updated');

      vi.advanceTimersByTime(5000);
      result = await client.get('key6');
      expect(result).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete values', async () => {
      await client.set('key7', 'value7');
      await client.delete('key7');
      const result = await client.get('key7');
      expect(result).toBeUndefined();
    });

    it('should clear timers when deleting', async () => {
      await client.set('key8', 'value8', { ttlSeconds: 10 });
      await client.delete('key8');

      vi.advanceTimersByTime(10000);

      const result = await client.get('key8');
      expect(result).toBeUndefined();
    });

    it('should not throw when deleting non-existent key', async () => {
      await expect(client.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('agent card caching use case', () => {
    it('should cache and retrieve agent cards', async () => {
      const agentCard = {
        name: 'Test Agent',
        description: 'A test agent',
        url: 'https://example.com',
        skills: []
      };

      await client.set('https://example.com', agentCard);
      const cached = await client.get<typeof agentCard>('https://example.com', { format: 'json' });

      expect(cached).toEqual(agentCard);
    });

    it('should handle array of agent summaries', async () => {
      const agentList = [
        { name: 'Agent 1', url: 'https://agent1.com' },
        { name: 'Agent 2', url: 'https://agent2.com' }
      ];

      await client.set('agent-list', agentList);
      const cached = await client.get<typeof agentList>('agent-list', { format: 'json' });

      expect(cached).toEqual(agentList);
      expect(cached).toHaveLength(2);
    });
  });
});
