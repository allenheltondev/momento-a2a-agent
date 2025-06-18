export interface MomentoClientOptions {
  apiKey: string;
  cacheName: string;
  defaultTtlSeconds?: number;
  throwOnError?: boolean;
}

export interface GetOptions {
  format?: 'string' | 'json';
  valueEncoding?: 'base64' | 'none';
  raw?: boolean;
}

export interface SetOptions {
  ttlSeconds?: number;
  valueEncode?: 'base64' | 'none';
  contentType?: string;
}

export interface MomentoError {
  status: number;
  title: string;
  detail: string;
}

export interface TopicMessage {
  topic_sequence_number: number;
  value: {
    text: string;
  };
}

export interface TopicDiscontinuity {
  last_topic_sequence: number;
  new_topic_sequence: number;
  new_sequence_page: number;
}

export interface TopicSubscriptionResponse {
  items: Array<
    | { item: TopicMessage; }
    | { discontinuity: TopicDiscontinuity; }
  >;
}

export type MomentoResult<T> =
  | { success: true; data: T; }
  | { success: false; error: MomentoError; };

const INVALID_CACHE_MESSAGE = 'Cache not found';

export class MomentoClient {
  private readonly apiKey: string;
  private readonly cacheName: string;
  private readonly defaultTtlSeconds: number;
  private readonly baseUrl: string;
  private readonly throwOnError: boolean;

  constructor(options: MomentoClientOptions) {
    this.apiKey = options.apiKey;
    this.cacheName = options.cacheName;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 3600; // 1 hour default
    this.throwOnError = options.throwOnError ?? true;

    try {
      const base64 = options.apiKey.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
      const jsonString = new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0)));
      const decodedToken = JSON.parse(jsonString);
      this.baseUrl = `https://api.cache.${decodedToken.endpoint}`;
    } catch (err) {
      console.error('Error decoding API key:', err);
      throw new Error('Invalid API key');
    }
  }

  async isValidConnection(): Promise<boolean> {
    try {
      const response = await this.get<MomentoError>('-99999999', { format: 'json' });
      return response?.detail !== INVALID_CACHE_MESSAGE;
    } catch (error) {
      console.error('Error checking connection:', error);
      return false;
    }
  }
  /**
   * Get a value from the cache
   */
  async get(key: string, options?: GetOptions): Promise<string | Uint8Array | undefined>;
  async get<T = any>(key: string, options: GetOptions & { format: 'json'; }): Promise<T | undefined>;
  async get<T = any>(key: string, options?: GetOptions): Promise<string | T | Uint8Array | undefined> {
    const url = new URL(`/cache/${encodeURIComponent(this.cacheName)}`, this.baseUrl);
    url.searchParams.set('key', key);

    try {
      const response = await this.makeRequest(url.toString(), { method: 'GET' });

      if (response.status === 404) return;

      if (!response.ok) {
        const error = await this.handleErrorResponse(response);
        if (!this.throwOnError) return;
        throw error;
      }

      if (options?.raw) {
        return new Uint8Array(await response.arrayBuffer());
      }

      let value = await response.text();
      if (options?.valueEncoding == 'base64') {
        value = atob(value);
      }

      if (options?.format === 'json') {
        try {
          return JSON.parse(value);
        } catch (parseError) {
          const error = new Error(`Failed to parse JSON for key ${key}: ${parseError}`);
          if (!this.throwOnError) return;
          throw error;
        }
      }
      return value;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) return;
      if (!this.throwOnError) return;
      throw error;
    }
  }


  /**
   * Set a value in the cache
   */
  async set(key: string, value: string | any, options?: SetOptions): Promise<void> {
    const url = new URL(`/cache/${encodeURIComponent(this.cacheName)}`, this.baseUrl);
    url.searchParams.set('key', key);
    url.searchParams.set('ttl_seconds', String(options?.ttlSeconds ?? this.defaultTtlSeconds));

    let body: string | Uint8Array;
    let contentType = options?.contentType ?? 'application/octet-stream';

    if (typeof value === 'string') {
      body = value;
      if (!options?.contentType) contentType = 'text/plain';
    } else if (value instanceof Uint8Array) {
      body = value;
    } else {
      body = JSON.stringify(value);
      if (!options?.contentType) contentType = 'application/json';
    }

    if (options?.valueEncode === 'base64') {
      if (typeof body === 'string') {
        body = btoa(body);
      } else if (body instanceof Uint8Array) {
        body = btoa(String.fromCharCode(...body));
      }
    }

    const response = await this.makeRequest(url.toString(), {
      method: 'PUT',
      body,
      headers: {
        'Content-Type': contentType,
      },
    });

    if (!response.ok) {
      const error = await this.handleErrorResponse(response);
      if (this.throwOnError) {
        throw error;
      }
    }
  }


  /**
   * Delete a value from the cache
   */
  async delete(key: string): Promise<void> {
    const url = new URL(`/cache/${encodeURIComponent(this.cacheName)}`, this.baseUrl);
    url.searchParams.set('key', key);

    const response = await this.makeRequest(url.toString(), {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      const error = await this.handleErrorResponse(response);
      if (this.throwOnError) {
        throw error;
      }
    }
  }

  /**
   * Publish a message to a topic
   */
  async topicPublish(topicName: string, message: string): Promise<void> {
    const url = new URL(
      `/topics/${encodeURIComponent(this.cacheName)}/${encodeURIComponent(topicName)}`,
      this.baseUrl
    );

    const response = await this.makeRequest(url.toString(), {
      method: 'POST',
      body: message,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await this.handleErrorResponse(response);
      if (this.throwOnError) {
        throw error;
      }
    }
  }

  /**
   * Subscribe to a topic via long polling
   */
  async topicSubscribe(topicName: string, sequenceNumber?: number, sequencePage?: number): Promise<TopicSubscriptionResponse | undefined> {
    const url = new URL(
      `/topics/${encodeURIComponent(this.cacheName)}/${encodeURIComponent(topicName)}`,
      this.baseUrl
    );

    if (sequenceNumber !== undefined) {
      url.searchParams.set('sequence_number', String(sequenceNumber));
    }

    if (sequencePage !== undefined) {
      url.searchParams.set('sequence_page', String(sequencePage));
    }

    const response = await this.makeRequest(url.toString(), {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await this.handleErrorResponse(response);
      if (!this.throwOnError) {
        return;
      }
      throw error;
    }

    return await response.json();
  }

  /**
   * Batch operations helper
   */
  async multiSet(entries: Array<{ key: string; value: string | any; options?: SetOptions; }>): Promise<void> {
    const promises = entries.map(entry =>
      this.set(entry.key, entry.value, entry.options)
    );
    await Promise.all(promises);
  }

  /**
   * Batch get operations helper
   */
  async multiGet(keys: string[], options?: GetOptions): Promise<Record<string, string | any | null>> {
    const promises = keys.map(async key => ({
      key,
      value: await this.get(key, options)
    }));

    const results = await Promise.all(promises);
    return results.reduce((acc, { key, value }) => {
      acc[key] = value;
      return acc;
    }, {} as Record<string, string | any | null>);
  }

  /**
   * Get result wrapped in a success/error object (alternative to throwOnError)
   */
  async getSafe(key: string, options?: GetOptions): Promise<MomentoResult<string | any | null>> {
    try {
      const data = await this.get(key, options);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: (error as any).momentoError || {
          status: 500,
          title: 'Unknown Error',
          detail: error instanceof Error ? error.message : 'An unknown error occurred'
        }
      };
    }
  }

  /**
   * Set result wrapped in a success/error object (alternative to throwOnError)
   */
  async setSafe(key: string, value: string | any, options?: SetOptions): Promise<MomentoResult<void>> {
    try {
      await this.set(key, value, options);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: (error as any).momentoError || {
          status: 500,
          title: 'Unknown Error',
          detail: error instanceof Error ? error.message : 'An unknown error occurred'
        }
      };
    }
  }

  private async makeRequest(url: string, options: RequestInit): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set('Authorization', this.apiKey);
    if (!headers.has('Content-Type') && options.method !== 'GET') {
      headers.set('Content-Type', 'application/octet-stream');
    }

    return this.retry(() =>
      fetch(url, {
        ...options,
        headers,
      })
    );
  }

  private async handleErrorResponse(response: Response): Promise<MomentoError> {
    try {
      const errorData: MomentoError = await response.json();
      return errorData;
    } catch (parseError) {
      return {
        status: response.status,
        title: response.statusText || 'Unknown Error',
        detail: `HTTP ${response.status} error occurred`
      };
    }
  }

  private async retry<T>(fn: () => Promise<T>, retries = 3, delayMs = 100): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const status = (err as Response)?.status;

      const isTransient =
        err instanceof TypeError || // network failure
        (typeof status === 'number' && status >= 500 && status < 600);

      if (!isTransient || retries <= 0) throw err;

      await new Promise(res => setTimeout(res, delayMs));
      return this.retry(fn, retries - 1, delayMs * 2);
    }
  }

}
