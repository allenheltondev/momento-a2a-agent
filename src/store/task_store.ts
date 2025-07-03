import { Task } from "../types";
import { MomentoClient } from "../momento/client.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Task storage interface (spec-aligned)
 */
export interface TaskStore {
  /**
   * Save or overwrite a task.
   * @param task The task to store.
   * @param ttlSeconds Optional: how long to keep the task in the cache (seconds).
   */
  save(task: Task): Promise<void>;

  /**
   * Load a task by id. Returns undefined if not found.
   */
  load(taskId: string): Promise<Task | undefined>;
}

export class MomentoTaskStore implements TaskStore {
  private client: MomentoClient;

  constructor(cacheName: string, apiKey: string) {
    this.client = new MomentoClient({ apiKey, cacheName, throwOnError: true });
  }

  async load(taskId: string): Promise<Task | undefined> {
    try {
      const task = await this.client.get<Task>(taskId, { format: 'json' });
      if (!task || !Array.isArray(task.artifacts)) return task;

      for (const artifact of task.artifacts) {
        if (!Array.isArray(artifact.parts)) continue;
        for (const part of artifact.parts) {
          if (part.kind === "file" && part.metadata?.cacheKey) {
            // Retrieve the binary
            const cacheKey = part.metadata.cacheKey as string;
            const bytes = await this.client.get(cacheKey, { raw: true}) as Uint8Array;
            if (bytes) {
              // Convert to base64 for .file.bytes property (per spec)
              const b64 = btoa(String.fromCharCode(...bytes));
              part.file = { bytes: b64 };
            }
            delete part.metadata.cacheKey;
          }
          if (part.kind === "data" && part.metadata?.cacheKey) {
            // Retrieve stringified JSON
            const cacheKey = part.metadata.cacheKey as string;
            const dataStr = await this.client.get(cacheKey, { format: "string" });
            if (dataStr) {
              part.data = JSON.parse(dataStr as string);
            }
            delete part.metadata.cacheKey;
          }
        }
      }
      return task;
    } catch (err) {
      console.error(`Failed to load task ${taskId}:`, err);
    }
  }

  async save(task: Task, ttlSeconds?: number): Promise<void> {
    try {
      if (Array.isArray(task.artifacts)) {
        for (const artifact of task.artifacts) {
          if (!Array.isArray(artifact.parts)) continue;
          for (const part of artifact.parts) {
            // --- FILE PART - store as binary data in cache ---
            if (part.kind === "file" && part.file && "bytes" in part.file && part.file.bytes) {
              const cacheKey = `artifact:${task.id}:${artifact.artifactId}:${uuidv4()}`;
              const bytes = base64ToUint8Array(part.file.bytes);

              await this.client.set(cacheKey, bytes, ttlSeconds ? { ttlSeconds } : undefined);
              // Store pointer, remove file property
              if (!part.metadata) part.metadata = {};
              part.metadata.cacheKey = cacheKey;
              delete (part as Partial<typeof part>).file;
            }

            // --- DATA PART - store as stringified json in cache ---
            if (part.kind === "data" && part.data) {
              const cacheKey = `artifact:${task.id}:${artifact.artifactId}:${uuidv4()}`;
              await this.client.set(cacheKey, part.data, ttlSeconds ? { ttlSeconds } : undefined);
              if (!part.metadata) part.metadata = {};
              part.metadata.cacheKey = cacheKey;
              delete (part as Partial<typeof part>).data;
            }
          }
        }
      }
      await this.client.set(task.id, task, ttlSeconds ? { ttlSeconds } : undefined);
    } catch (err) {
      console.error(`Failed to save task ${task.id}:`, err);
    }
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}
