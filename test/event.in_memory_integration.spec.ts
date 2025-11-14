import { describe, it, expect } from "vitest";
import { InMemoryEventBus } from "../src/event/in_memory_event_bus";
import { ExecutionEventQueue } from "../src/event/queue";
import type { AgentExecutionEvent } from "../src/event/event_bus";

const contextId = "test-context";

describe("InMemoryEventBus integration with ExecutionEventQueue", () => {
  it("works with ExecutionEventQueue to deliver events", async () => {
    const bus = new InMemoryEventBus();
    const queue = new ExecutionEventQueue(bus, contextId);

    const event1: AgentExecutionEvent = {
      kind: "message",
      contextId,
      messageId: "m1",
      role: "user",
      parts: [{ kind: "text", text: "Hello" }],
    };

    setTimeout(async () => {
      await bus.publish(event1);
    }, 10);

    const results: AgentExecutionEvent[] = [];
    for await (const e of queue.events()) {
      results.push(e);
    }

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(event1);

    await bus.close();
  });

  it("filters events by context correctly", async () => {
    const bus = new InMemoryEventBus();
    const queue = new ExecutionEventQueue(bus, contextId);

    const event1: AgentExecutionEvent = {
      kind: "message",
      contextId,
      messageId: "m1",
      role: "user",
      parts: [],
    };

    const event2: AgentExecutionEvent = {
      kind: "message",
      contextId: "other-context",
      messageId: "m2",
      role: "user",
      parts: [],
    };

    setTimeout(async () => {
      await bus.publish(event2);
      await bus.publish(event1);
    }, 10);

    const results: AgentExecutionEvent[] = [];
    for await (const e of queue.events()) {
      results.push(e);
    }

    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe("m1");

    await bus.close();
  });

  it("stops after final status-update event", async () => {
    const bus = new InMemoryEventBus();
    const queue = new ExecutionEventQueue(bus, contextId);

    const statusUpdate: AgentExecutionEvent = {
      kind: "status-update",
      contextId,
      taskId: "t1",
      status: {
        state: "completed",
        message: { messageId: "x", kind: "message", role: "agent", parts: [] },
        timestamp: new Date().toISOString(),
      },
      final: true,
    };

    setTimeout(async () => {
      await bus.publish(statusUpdate);
    }, 10);

    const results: AgentExecutionEvent[] = [];
    for await (const e of queue.events()) {
      results.push(e);
    }

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("status-update");

    await bus.close();
  });
});
