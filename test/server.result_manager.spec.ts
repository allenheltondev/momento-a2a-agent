import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResultManager } from "../src/server/result_manager";
import type { Task, Message, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from "../src/types";

function makeTask(overrides = {}) {
  return {
    kind: "task",
    id: "t1",
    contextId: "ctx1",
    status: { state: "submitted", message: { messageId: "m1" }, timestamp: "now" },
    history: [{ messageId: "m1", kind: "message", role: "user", parts: [] }],
    artifacts: [],
    metadata: {},
    ...overrides,
  } as Task;
}

function makeMessage(overrides = {}) {
  return {
    kind: "message",
    messageId: "m1",
    role: "user",
    parts: [],
    ...overrides,
  } as Message;
}

describe("ResultManager", () => {
  let store: { save: any; load: any };
  let mgr: ResultManager;

  beforeEach(() => {
    store = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    };
    mgr = new ResultManager(store as any);
  });

  it("tracks final message result", async () => {
    const msg = makeMessage({ messageId: "final", parts: [{ kind: "text", text: "done" }] });
    await mgr.processEvent(msg);
    expect(mgr.getFinalResult()).toEqual(msg);
    expect(mgr.getCurrentTask()).toBeUndefined();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("processes task event and saves it", async () => {
    const task = makeTask({ id: "t2", contextId: "ctx2", history: [] });
    mgr.setContext(makeMessage({ messageId: "m9" }));
    await mgr.processEvent(task);
    // Should insert the latest user message at the front of history
    expect(mgr.getCurrentTask()?.history?.[0]?.messageId).toBe("m9");
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }));
  });

  it("does not duplicate user message in history", async () => {
    const m = makeMessage({ messageId: "m3" });
    const task = makeTask({ history: [m] });
    mgr.setContext(m);
    await mgr.processEvent(task);
    // Should not duplicate if already present
    expect(mgr.getCurrentTask()?.history?.filter(x => x.messageId === "m3").length).toBe(1);
  });

  it("processes status-update and merges message into history", async () => {
    const task = makeTask({ id: "t1", history: [] });
    mgr["currentTask"] = { ...task, history: [] };
    const msg = makeMessage({ messageId: "stat1" });
    const update: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: "t1",
      contextId: "ctx1",
      status: {
        state: "working",
        message: msg,
        timestamp: "later",
      },
      final: false,
    };
    await mgr.processEvent(update);
    expect(mgr.getCurrentTask()?.status.state).toBe("working");
    expect(mgr.getCurrentTask()?.history?.find(x => x.messageId === "stat1")).toBeDefined();
    expect(store.save).toHaveBeenCalled();
  });

  it("loads and updates task if missing on status-update", async () => {
    const loadedTask = makeTask({ id: "t1", history: [] });
    store.load.mockResolvedValue(loadedTask);
    const msg = makeMessage({ messageId: "stat2" });
    const update: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: "t1",
      contextId: "ctx1",
      status: {
        state: "done",
        message: msg,
        timestamp: "z",
      },
      final: false,
    };
    await mgr.processEvent(update);
    expect(store.load).toHaveBeenCalledWith("t1");
    expect(mgr.getCurrentTask()?.status.state).toBe("done");
    expect(mgr.getCurrentTask()?.history?.find(x => x.messageId === "stat2")).toBeDefined();
  });

  it("handles unknown task on status-update gracefully", async () => {
    store.load.mockResolvedValue(undefined);
    const update: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: "notfound",
      contextId: "ctx",
      status: { state: "failed", message: makeMessage({ messageId: "fail" }), timestamp: "x" },
      final: false,
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mgr.processEvent(update);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ResultManager: Received status update for unknown task"),
    );
    warn.mockRestore();
  });

  it("merges new artifact on artifact-update", async () => {
    const task = makeTask({ id: "t1", artifacts: [] });
    mgr["currentTask"] = { ...task, artifacts: [] };
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId: "t1",
      contextId: "ctx1",
      artifact: {
        artifactId: "a1",
        parts: [{ kind: "text", text: "a" }],
      },
      append: false,
    };
    await mgr.processEvent(artifactEvent);
    expect(mgr.getCurrentTask()?.artifacts[0]?.artifactId).toBe("a1");
    expect(store.save).toHaveBeenCalled();
  });

  it("updates existing artifact with append", async () => {
    const task = makeTask({
      id: "t1",
      artifacts: [
        {
          artifactId: "a1",
          parts: [{ kind: "text", text: "a" }],
          name: "file1",
          description: "d",
          metadata: { foo: 1 },
        },
      ],
    });
    mgr["currentTask"] = JSON.parse(JSON.stringify(task)); // deep copy
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId: "t1",
      contextId: "ctx1",
      artifact: {
        artifactId: "a1",
        parts: [{ kind: "text", text: "b" }],
        name: "file2",
        description: "desc2",
        metadata: { bar: 2 },
      },
      append: true,
    };
    await mgr.processEvent(artifactEvent);
    const updated = mgr.getCurrentTask()?.artifacts[0];
    expect(updated?.parts.length).toBe(2);
    expect(updated?.name).toBe("file2");
    expect(updated?.description).toBe("desc2");
    expect(updated?.metadata).toMatchObject({ foo: 1, bar: 2 });
    expect(store.save).toHaveBeenCalled();
  });

  it("replaces artifact if append is false", async () => {
    const task = makeTask({
      id: "t1",
      artifacts: [
        { artifactId: "a1", parts: [{ kind: "text", text: "a" }] },
      ],
    });
    mgr["currentTask"] = { ...task, artifacts: [...task.artifacts] };
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId: "t1",
      contextId: "ctx1",
      artifact: {
        artifactId: "a1",
        parts: [{ kind: "text", text: "new" }],
      },
      append: false,
    };
    await mgr.processEvent(artifactEvent);
    const updated = mgr.getCurrentTask()?.artifacts[0];
    expect(updated?.parts[0].text).toBe("new");
  });

  it("loads task for artifact-update if not loaded yet", async () => {
    store.load.mockResolvedValue(makeTask({ id: "t2", artifacts: [] }));
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId: "t2",
      contextId: "ctx1",
      artifact: { artifactId: "a9", parts: [{ kind: "text", text: "q" }] },
      append: false,
    };
    await mgr.processEvent(artifactEvent);
    expect(store.load).toHaveBeenCalledWith("t2");
    expect(mgr.getCurrentTask()?.artifacts[0].artifactId).toBe("a9");
  });

  it("warns if artifact-update refers to unknown task", async () => {
    store.load.mockResolvedValue(undefined);
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: "artifact-update",
      taskId: "fail",
      contextId: "ctx",
      artifact: { artifactId: "a1", parts: [] },
      append: false,
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mgr.processEvent(artifactEvent);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ResultManager: Received artifact update for unknown task"),
    );
    warn.mockRestore();
  });

  it("returns correct getFinalResult and getCurrentTask", () => {
    expect(mgr.getFinalResult()).toBeUndefined();
    expect(mgr.getCurrentTask()).toBeUndefined();
    mgr["currentTask"] = makeTask({ id: "abc" });
    expect(mgr.getFinalResult()).toMatchObject({ id: "abc" });
    mgr["finalMessageResult"] = makeMessage({ messageId: "xyz" });
    expect(mgr.getFinalResult()).toMatchObject({ messageId: "xyz" });
  });
});
