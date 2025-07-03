import { describe, it, expect, beforeEach, vi } from "vitest";
import { MomentoTaskStore } from "../src/store/task_store";
import type { Task } from "../src/types";

vi.mock("../src/momento/client", () => {
  class FakeMomentoClient {
    store = new Map<string, any>();

    async get(key: string, opts?: any) {
      const value = this.store.get(key);
      if (!value) return undefined;
      if (opts?.raw) return value;
      if (opts?.format === "json") return value;
      if (opts?.format === "string") return typeof value === "string" ? value : JSON.stringify(value);

      return value;
    }

    async set(key: string, value: any): Promise<void> {
      this.store.set(key, value);
    }
  }

  return { MomentoClient: FakeMomentoClient };
});


const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  kind: "task",
  contextId: "ctx-1",
  status: {
    state: "submitted",
    message: { kind: "message", messageId: "msg-1", role: "user", parts: [], contextId: "ctx-1" },
    timestamp: new Date().toISOString(),
  },
  history: [],
  artifacts: [],
  metadata: {},
  ...overrides,
});

describe("MomentoTaskStore", () => {
  let store: MomentoTaskStore;
  beforeEach(() => {
    store = new MomentoTaskStore("cache", "fake-api-key");
  });

  it("saves and loads a basic task", async () => {
    const task = makeTask();
    await store.save(task);
    const loaded = await store.load(task.id);
    expect(loaded).toEqual(task);
  });

  it("overwrites a task with the same ID", async () => {
    const task1 = makeTask({ status: { state: "submitted", message: { kind: "message", messageId: "m1", role: "user", parts: [], contextId: "ctx-1" }, timestamp: "t1" } });
    const task2 = makeTask({ status: { state: "working", message: { kind: "message", messageId: "m2", role: "user", parts: [], contextId: "ctx-1" }, timestamp: "t2" } });
    await store.save(task1);
    await store.save(task2);
    const loaded = await store.load(task1.id);
    expect(loaded).toEqual(task2);
  });

  it("returns undefined for a missing task", async () => {
    expect(await store.load("missing-id")).toBeUndefined();
  });

  it("preserves artifacts and history", async () => {
    const artifact = {
      artifactId: "a1",
      parts: [{ kind: "text", text: "hi" }],
      name: "foo",
    };
    const history = [{ kind: "message", messageId: "m1", role: "user", parts: [], contextId: "ctx-1" }];
    const task = makeTask({ artifacts: [artifact], history });
    await store.save(task);
    const loaded = await store.load(task.id);
    expect(loaded?.artifacts?.[0]).toMatchObject(artifact);
    expect(loaded?.history).toEqual(history);
  });

  it('persists file artifacts correctly', async () => {
    const payload = Buffer.from('hello world').toString('base64');
    const task = makeTask({
      artifacts: [{
        artifactId: 'f1',
        name: 'file',
        parts: [{ kind: 'file', file: { bytes: payload } }],
      }],
    });

    await store.save(task);
    const loaded = await store.load(task.id);

    const loadedPart = loaded?.artifacts[0].parts[0];
    expect(loadedPart).toMatchObject({
      kind: 'file',
      file: { bytes: payload },
    });
  });

  it('persists data artifacts correctly', async () => {
    const data = { foo: 42 };
    const task = makeTask({
      artifacts: [{
        artifactId: 'd1',
        name: 'datapart',
        parts: [{ kind: 'data', data }],
      }],
    });

    await store.save(task);
    const loaded = await store.load(task.id);

    const loadedPart = loaded?.artifacts[0].parts[0];
    expect(loadedPart).toMatchObject({
      kind: 'data',
      data,
    });
  });

  it("handles errors gracefully (save/load)", async () => {
    // This will trigger a catch block but should not throw
    (store as any).client.set = vi.fn().mockRejectedValue(new Error("fail"));
    const task = makeTask();
    await expect(store.save(task)).resolves.toBeUndefined();
    (store as any).client.get = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(store.load(task.id)).resolves.toBeUndefined();
  });

  // Add more as you expand the Task model, such as TTL, deletion, etc.
});
