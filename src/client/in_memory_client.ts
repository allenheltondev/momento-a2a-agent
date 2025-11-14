interface StoredValue {
  value: any;
  expiresAt?: number;
}

interface InMemoryGetOptions {
  format?: 'string' | 'json';
}

interface InMemorySetOptions {
  ttlSeconds?: number;
}

export class InMemoryClient {
  private cache: Map<string, StoredValue>;
  private timers: Map<string, NodeJS.Timeout>;

  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  async get(key: string, options?: InMemoryGetOptions): Promise<string | Uint8Array | undefined>;
  async get<T = any>(key: string, options: InMemoryGetOptions & { format: 'json'; }): Promise<T | undefined>;
  async get<T = any>(key: string, options?: InMemoryGetOptions): Promise<string | T | Uint8Array | undefined> {
    const stored = this.cache.get(key);

    if (!stored) {
      return undefined;
    }

    if (stored.expiresAt && Date.now() >= stored.expiresAt) {
      this.cleanup(key);
      return undefined;
    }

    if (options?.format === 'json') {
      return stored.value as T;
    }

    return stored.value;
  }

  async set(key: string, value: any, options?: InMemorySetOptions): Promise<void> {
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    const stored: StoredValue = { value };

    if (options?.ttlSeconds) {
      stored.expiresAt = Date.now() + options.ttlSeconds * 1000;
      this.scheduleExpiration(key, options.ttlSeconds);
    }

    this.cache.set(key, stored);
  }

  async delete(key: string): Promise<void> {
    this.cleanup(key);
  }

  private scheduleExpiration(key: string, ttlSeconds: number): void {
    const timer = setTimeout(() => {
      this.cleanup(key);
    }, ttlSeconds * 1000);

    this.timers.set(key, timer);
  }

  private cleanup(key: string): void {
    this.cache.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }
}
