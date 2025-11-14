import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryEventBus } from "../src/event/in_memory_event_bus";

const TEST_CONTEXT_ID = "ctx-123";
const TEST_CONTEXT_ID_2 = "ctx-456";

const dummyMessage = {
  kind: "message" as const,
  contextId: TEST_CONTEXT_ID,
  messageId: "msg1",
  role: "user" as const,
  parts: [{ kind: "text" as const, text: "Hello" }],
};

const dummyTask = {
  kind: "task" as const,
  contextId: TEST_CONTEXT_ID,
  id: "task1",
  status: { state: "completed" as const, message: dummyMessage },
  history: [],
};

describe("InMemoryEventBus", () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  afterEach(async () => {
    await bus.close();
  });

  it("publishes an event and emits it synchronously", async () => {
    const listener = vi.fn();
    bus.on("event", listener);

    await bus.publish(dummyMessage);

    expect(listener).toHaveBeenCalledWith(dummyMessage);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("throws if event missing contextId", async () => {
    // @ts-expect-error - testing invalid input
    await expect(bus.publish({ kind: "task" })).rejects.toThrow("publish(): event.contextId is required");
  });

  it("throws if event has empty contextId", async () => {
    await expect(bus.publish({ ...dummyMessage, contextId: "" })).rejects.toThrow("publish(): event.contextId is required");
  });

  it("filters events by contextId with onContext", async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.onContext(TEST_CONTEXT_ID, listener1);
    bus.onContext(TEST_CONTEXT_ID_2, listener2);

    await bus.publish(dummyMessage);
    await bus.publish({ ...dummyMessage, contextId: TEST_CONTEXT_ID_2 });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener1).toHaveBeenCalledWith(dummyMessage);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledWith({ ...dummyMessage, contextId: TEST_CONTEXT_ID_2 });
  });

  it("supports multiple listeners for the same context", async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.onContext(TEST_CONTEXT_ID, listener1);
    bus.onContext(TEST_CONTEXT_ID, listener2);

    await bus.publish(dummyMessage);

    expect(listener1).toHaveBeenCalledWith(dummyMessage);
    expect(listener2).toHaveBeenCalledWith(dummyMessage);
  });

  it("unregisters context and removes all listeners for that context", async () => {
    const listener = vi.fn();

    bus.onContext(TEST_CONTEXT_ID, listener);
    await bus.publish(dummyMessage);
    expect(listener).toHaveBeenCalledTimes(1);

    bus.unregisterContext(TEST_CONTEXT_ID);
    await bus.publish(dummyMessage);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw if unregisterContext called for unknown contextId", () => {
    expect(() => bus.unregisterContext("notfound")).not.toThrow();
  });

  it("removes all listeners with removeAllListeners", async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.onContext(TEST_CONTEXT_ID, listener1);
    bus.onContext(TEST_CONTEXT_ID_2, listener2);

    bus.removeAllListeners("event");

    await bus.publish(dummyMessage);
    await bus.publish({ ...dummyMessage, contextId: TEST_CONTEXT_ID_2 });

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
    expect(bus.listenerCount("event")).toBe(0);
  });

  it("cleans up all contexts and listeners with close", async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.onContext(TEST_CONTEXT_ID, listener1);
    bus.onContext(TEST_CONTEXT_ID_2, listener2);

    await bus.close();

    await bus.publish(dummyMessage);
    await bus.publish({ ...dummyMessage, contextId: TEST_CONTEXT_ID_2 });

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
    expect(bus.listenerCount("event")).toBe(0);
  });

  it("delivers events synchronously in order", async () => {
    const events: string[] = [];
    const listener = vi.fn((e) => {
      events.push(e.messageId);
    });

    bus.onContext(TEST_CONTEXT_ID, listener);

    await bus.publish({ ...dummyMessage, messageId: "msg1" });
    await bus.publish({ ...dummyMessage, messageId: "msg2" });
    await bus.publish({ ...dummyMessage, messageId: "msg3" });

    expect(events).toEqual(["msg1", "msg2", "msg3"]);
  });

  it("only delivers events to listeners registered for that context", async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.onContext(TEST_CONTEXT_ID, listener1);
    bus.onContext(TEST_CONTEXT_ID_2, listener2);

    await bus.publish({ ...dummyMessage, contextId: TEST_CONTEXT_ID });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).not.toHaveBeenCalled();
  });

  it("can use standard EventEmitter methods", async () => {
    const listener = vi.fn();

    bus.on("event", listener);
    await bus.publish(dummyMessage);
    expect(listener).toHaveBeenCalledWith(dummyMessage);

    bus.off("event", listener);
    await bus.publish(dummyMessage);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports once for single event delivery", async () => {
    const listener = vi.fn();

    bus.once("event", listener);
    await bus.publish(dummyMessage);
    await bus.publish(dummyMessage);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
