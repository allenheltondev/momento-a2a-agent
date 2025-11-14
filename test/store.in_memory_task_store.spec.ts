import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryTaskStore } from "../src/store/in_memory_task_store";
import type { Task } from "../src/types";

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

describe("InMemoryTaskStore", () => {
  let store: InMemoryTaskStore;

  beforeEach(() => {
    store = new InMemoryTaskStore();
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

  it("persists file artifacts correctly", async () => {
    const payload = Buffer.from("hello world").toString("base64");
    const task = makeTask({
      artifacts: [{
        artifactId: "f1",
        name: "file",
        parts: [{ kind: "file", file: { bytes: payload } }],
      }],
    });

    await store.save(task);
    const loaded = await store.load(task.id);

    const loadedPart = loaded?.artifacts[0].parts[0];
    expect(loadedPart).toMatchObject({
      kind: "file",
      file: { bytes: payload },
    });
  });

  it("persists data artifacts correctly", async () => {
    const data = { foo: 42 };
    const task = makeTask({
      artifacts: [{
        artifactId: "d1",
        name: "datapart",
        parts: [{ kind: "data", data }],
      }],
    });

    await store.save(task);
    const loaded = await store.load(task.id);

    const loadedPart = loaded?.artifacts[0].parts[0];
    expect(loadedPart).toMatchObject({
      kind: "data",
      data,
    });
  });

  it("handles TTL expiration correctly", async () => {
    vi.useFakeTimers();

    const task = makeTask();
    await store.save(task, 2);

    let loaded = await store.load(task.id);
    expect(loaded).toEqual(task);

    vi.advanceTimersByTime(2500);

    loaded = await store.load(task.id);
    expect(loaded).toBeUndefined();

    vi.useRealTimers();
  });

  it("clears existing timer when re-saving with new TTL", async () => {
    vi.useFakeTimers();

    const task = makeTask();
    await store.save(task, 1);

    vi.advanceTimersByTime(500);

    await store.save(task, 2);

    vi.advanceTimersByTime(1000);
    let loaded = await store.load(task.id);
    expect(loaded).toEqual(task);

    vi.advanceTimersByTime(1500);
    loaded = await store.load(task.id);
    expect(loaded).toBeUndefined();

    vi.useRealTimers();
  });

  it("handles concurrent access safely", async () => {
    const task1 = makeTask({ id: "task-1" });
    const task2 = makeTask({ id: "task-2" });
    const task3 = makeTask({ id: "task-3" });

    await Promise.all([
      store.save(task1),
      store.save(task2),
      store.save(task3),
    ]);

    const [loaded1, loaded2, loaded3] = await Promise.all([
      store.load("task-1"),
      store.load("task-2"),
      store.load("task-3"),
    ]);

    expect(loaded1).toEqual(task1);
    expect(loaded2).toEqual(task2);
    expect(loaded3).toEqual(task3);
  });

  it("returns undefined for expired task on load", async () => {
    vi.useFakeTimers();

    const task = makeTask();
    await store.save(task, 1);

    vi.advanceTimersByTime(1500);

    const loaded = await store.load(task.id);
    expect(loaded).toBeUndefined();

    vi.useRealTimers();
  });
});

