import { describe, it, expect, vi, beforeEach } from "vitest";
import { MomentoAgentExecutor } from "../src/agent/executor";
import type { Task, Message, TaskStatusUpdateEvent, Artifact, IExecutionEventBus } from "../src/types";

// Minimal mock Task/Message
const mockMsg: Message = { kind: "message", messageId: "msg1", parts: [{ kind: "text", text: "hi" }], role: "user" };
const mockTask: Task = {
  kind: "task",
  id: "task1",
  contextId: "ctx1",
  status: { state: "submitted", message: mockMsg, timestamp: new Date().toISOString() },
  history: [mockMsg],
  artifacts: [],
  metadata: {}
};

// Utility to capture eventBus.publish calls
function createEventBusMock() {
  const events: any[] = [];
  return {
    publish: vi.fn(async (event) => events.push(event)),
    getEvents: () => events,
  } as unknown as IExecutionEventBus & { getEvents: () => any[] };
}

describe("MomentoAgentExecutor", () => {
  let eventBus: ReturnType<typeof createEventBusMock>;

  beforeEach(() => {
    eventBus = createEventBusMock();
  });

  it("publishes initial and working events if task not provided", async () => {
    const handleTask = vi.fn().mockResolvedValue("hello");
    const executor = new MomentoAgentExecutor(handleTask, { agentName: "X", agentId: "Y" });

    await executor.execute(mockMsg, eventBus, {});

    // Should have published initial task and working status
    const published = eventBus.getEvents();
    expect(published[0].kind).toBe("task");
    expect(published[1].kind).toBe("status-update");
    expect(published[1].status.state).toBe("working");
    expect(handleTask).toHaveBeenCalled();
  });

  it("publishes completed status when handleTask returns string", async () => {
    const handleTask = vi.fn().mockResolvedValue("done!");
    const executor = new MomentoAgentExecutor(handleTask, {});

    await executor.execute(mockMsg, eventBus, { task: mockTask });
    const events = eventBus.getEvents();
    expect(events.at(-1)?.status?.state).toBe("completed");
    expect(events.at(-1)?.status?.message.parts[0].text).toBe("done!");
  });

  it("publishes completed status when handleTask returns parts result", async () => {
    const handleTask = vi.fn().mockResolvedValue({
      parts: [{ kind: "text", text: "part result" }],
      artifacts: [{ artifactId: "a1", parts: [] }],
      metadata: { foo: "bar" }
    });
    const executor = new MomentoAgentExecutor(handleTask);

    await executor.execute(mockMsg, eventBus, { task: mockTask });
    const events = eventBus.getEvents();
    expect(events.at(-1)?.status?.state).toBe("completed");
    expect(events.at(-1)?.status?.message.parts[0].text).toBe("part result");
    expect(events.at(-1)?.metadata?.agentName).toBeUndefined(); // not set in this test
  });

  it("publishes completed status when handleTask returns full Task", async () => {
    const customTask: Task = {
      ...mockTask,
      status: {
        ...mockTask.status,
        state: "completed",
        message: { ...mockMsg, parts: [{ kind: "text", text: "full task!" }] }
      }
    };
    const handleTask = vi.fn().mockResolvedValue(customTask);
    const executor = new MomentoAgentExecutor(handleTask);

    await executor.execute(mockMsg, eventBus, { task: mockTask });
    const events = eventBus.getEvents();
    expect(events.at(-1)?.status?.state).toBe("completed");
    expect(events.at(-1)?.status?.message.parts[0].text).toBe("full task!");
  });

  it("throws if handleTask returns undefined", async () => {
    const handleTask = vi.fn().mockResolvedValue({ kind: "task" });
    const executor = new MomentoAgentExecutor(handleTask);

    await expect(executor.execute(mockMsg, eventBus)).rejects.toThrow();
  });

  it("publishes failed status on handleTask error", async () => {
    const handleTask = vi.fn().mockRejectedValue(new Error("fail!"));
    const executor = new MomentoAgentExecutor(handleTask);

    await executor.execute(mockMsg, eventBus, { task: mockTask });
    const events = eventBus.getEvents();
    expect(events.at(-1)?.status?.state).toBe("failed");
    expect(events.at(-1)?.status?.message.parts[0].text).toContain("fail!");
  });
});
