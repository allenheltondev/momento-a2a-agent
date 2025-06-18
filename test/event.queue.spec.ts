import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionEventQueue } from "../src/event/queue";
import type { AgentExecutionEvent, IExecutionEventBus } from "../src/event/event_bus";
import type { TaskStatusUpdateEvent } from "../src/types";

function makeBus(): IExecutionEventBus & { emitEvent: (event: AgentExecutionEvent) => void } {
  const listeners = new Map<string, Set<(e: AgentExecutionEvent) => void>>();
  return {
    onContext(contextId, listener) {
      if (!listeners.has(contextId)) listeners.set(contextId, new Set());
      listeners.get(contextId)!.add(listener);
      return this;
    },
    unregisterContext(contextId) {
      listeners.delete(contextId);
    },
    emitEvent(event: AgentExecutionEvent) {
      const set = listeners.get(event.contextId as string);
      if (set) for (const l of set) l(event);
    },
    // not used in ExecutionEventQueue
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    publish: vi.fn(),
  } as any;
}

const contextId = "test-context";

describe("ExecutionEventQueue", () => {
  let bus: ReturnType<typeof makeBus>;
  let queue: ExecutionEventQueue;

  beforeEach(() => {
    bus = makeBus();
    queue = new ExecutionEventQueue(bus, contextId);
  });

  it("yields events for its context", async () => {
    const event1: AgentExecutionEvent = { kind: "message", contextId, messageId: "m1", parts: [] };
    const results: AgentExecutionEvent[] = [];

    setTimeout(() => bus.emitEvent(event1), 10);

    for await (const e of queue.events()) {
      results.push(e);
    }

    expect(results).toEqual([event1]);
  });

  it("stops after yielding 'message' event", async () => {
    const event1: AgentExecutionEvent = { kind: "message", contextId, messageId: "m1", parts: [] };
    const event2: AgentExecutionEvent = { kind: "message", contextId, messageId: "m2", parts: [] };

    setTimeout(() => {
      bus.emitEvent(event1);
      bus.emitEvent(event2);
    }, 10);

    const results: AgentExecutionEvent[] = [];
    for await (const e of queue.events()) {
      results.push(e);
    }
    expect(results).toEqual([event1]); // Only first message triggers stop
  });

  it("stops after yielding final status-update", async () => {
    const event: TaskStatusUpdateEvent = {
      kind: "status-update",
      contextId,
      taskId: "t1",
      status: { state: "completed", message: { messageId: "x", kind: "message", parts: [] }, timestamp: new Date().toISOString() },
      final: true,
    };

    setTimeout(() => bus.emitEvent(event), 10);

    const results: AgentExecutionEvent[] = [];
    for await (const e of queue.events()) {
      results.push(e);
    }
    expect(results).toEqual([event]);
  });

  it("does not yield events for other contexts", async () => {
    const event: AgentExecutionEvent = { kind: "message", contextId: "other", messageId: "m1", parts: [] };
    let yielded = false;

    setTimeout(() => bus.emitEvent(event), 10);

    // Timeout after 25ms to avoid infinite loop if nothing yields
    const p = (async () => {
      for await (const _ of queue.events()) {
        yielded = true;
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 25));
    queue.stop();
    await p;
    expect(yielded).toBe(false);
  });

  it("stop() ends the generator", async () => {
    setTimeout(() => queue.stop(), 10);
    let count = 0;
    for await (const _ of queue.events()) {
      count++;
    }
    expect(count).toBe(0);
  });

  it("unregisters context on stop and on exit", async () => {
    const spy = vi.spyOn(bus, "unregisterContext");
    setTimeout(() => queue.stop(), 10);
    await (async () => { for await (const _ of queue.events()) {} })();
    expect(spy).toHaveBeenCalledWith(contextId);
  });
});
