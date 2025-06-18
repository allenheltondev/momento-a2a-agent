import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MomentoEventBus } from "../src/event/event_bus";

const TEST_CACHE = "test-cache";
const TEST_API_KEY = "api-key";
const TEST_CONTEXT_ID = "ctx-123";

function makeFakeClient(overrides = {}) {
  return {
    topicPublish: vi.fn().mockResolvedValue(undefined),
    topicSubscribe: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

vi.mock("../src/momento/client", () => {
  return {
    MomentoClient: vi.fn().mockImplementation(() => ({
      topicPublish: vi.fn().mockResolvedValue(undefined),
      topicSubscribe: vi.fn().mockResolvedValue({ items: [] }),
    })),
  };
});

// -- Dummy events
const dummyMessage = {
  kind: "message",
  contextId: TEST_CONTEXT_ID,
  messageId: "msg1",
  parts: [{ kind: "text", text: "Hello" }],
};
const dummyTask = {
  kind: "task",
  contextId: TEST_CONTEXT_ID,
  id: "task1",
  status: { state: "completed", message: dummyMessage },
  history: [],
};

describe("MomentoEventBus", () => {
  let bus: MomentoEventBus;
  let fakeClient: ReturnType<typeof makeFakeClient>;

  beforeEach(() => {
    fakeClient = makeFakeClient();
    // Patch the class to use our fake client
    bus = new MomentoEventBus(TEST_CACHE, TEST_API_KEY) as any;
    (bus as any).client = fakeClient;
  });

  afterEach(async () => {
    await bus.close();
    vi.restoreAllMocks();
  });

  it("publishes an event using client.topicPublish", async () => {
    await bus.publish(dummyMessage);
    expect(fakeClient.topicPublish).toHaveBeenCalledWith(TEST_CONTEXT_ID, JSON.stringify(dummyMessage));
  });

  it("throws if event missing contextId", async () => {
    // @ts-expect-error
    await expect(bus.publish({ kind: "task" })).rejects.toThrow("publish(): event.contextId is required");
  });

  it("registers context and starts polling, does not double register", async () => {
    bus.registerContext(TEST_CONTEXT_ID);
    bus.registerContext(TEST_CONTEXT_ID); // Should be idempotent

    expect((bus as any).pollers.has(TEST_CONTEXT_ID)).toBe(true);
  });

  it("calls topicSubscribe and emits events for items", async () => {
    // Simulate a response with an event and a discontinuity
    let called = false;
    fakeClient.topicSubscribe = vi.fn().mockImplementation(async () => ({
      items: [
        {
          item: {
            value: { text: JSON.stringify(dummyTask) },
            topic_sequence_number: 0,
          }
        },
        {
          discontinuity: {
            new_topic_sequence: 5,
            new_sequence_page: 2,
          }
        }
      ]
    }));

    bus.on("event", (event) => {
      expect(event.kind).toBe("task");
      called = true;
    });

    bus.on("discontinuity", (disco) => {
      expect(disco.contextId).toBe(TEST_CONTEXT_ID);
      expect(disco.fromSequence).toBe(5); // Should be after the item
      expect(disco.toSequence).toBe(5);
      called = true;
    });

    bus.registerContext(TEST_CONTEXT_ID);

    // Let the async poll finish (simulate a cycle)
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(called).toBe(true);
  });

  it("can add and remove context listeners via onContext/unregisterContext", async () => {
    const listener = vi.fn();

    bus.onContext(TEST_CONTEXT_ID, listener);

    // Emit event for this contextId only
    bus.emit("event", { ...dummyTask, contextId: TEST_CONTEXT_ID });
    expect(listener).toHaveBeenCalled();

    // Unregister and ensure no longer called
    bus.unregisterContext(TEST_CONTEXT_ID);
    bus.emit("event", { ...dummyTask, contextId: TEST_CONTEXT_ID });
    expect(listener).toHaveBeenCalledTimes(1); // Only first call
  });

  it("removes all listeners and stops polling with removeAllListeners", async () => {
    const listener = vi.fn();
    bus.onContext(TEST_CONTEXT_ID, listener);
    bus.removeAllListeners("event");
    expect((bus as any).pollers.size).toBe(0);
    // Listeners should be gone
    bus.emit("event", { ...dummyTask, contextId: TEST_CONTEXT_ID });
    expect(listener).not.toHaveBeenCalled();
  });

  it("calls close to clean up pollers and listeners", async () => {
    const listener = vi.fn();
    bus.onContext(TEST_CONTEXT_ID, listener);
    await bus.close();
    expect((bus as any).pollers.size).toBe(0);
    expect(bus.listenerCount("event")).toBe(0);
  });

  it("handles errors in topicSubscribe gracefully", async () => {
    fakeClient.topicSubscribe = vi.fn().mockRejectedValue(new Error("boom"));
    bus.registerContext(TEST_CONTEXT_ID);
    await new Promise((resolve) => setTimeout(resolve, 120));
    // Should not throw, but will log error (nothing to assert, but covers the path)
  });

  it("does not emit events after unregistered", async () => {
    let count = 0;
    bus.onContext(TEST_CONTEXT_ID, (e) => {console.log(e); count++;});
    bus.registerContext(TEST_CONTEXT_ID);
    bus.unregisterContext(TEST_CONTEXT_ID);
    bus.emit("event", { ...dummyTask, contextId: TEST_CONTEXT_ID });
    expect(count).toBe(0);
  });

   it("correctly picks up context events", async () => {
    let count = 0;
    bus.onContext(TEST_CONTEXT_ID, (e) => {console.log(e); count++;});
    bus.registerContext(TEST_CONTEXT_ID);
    bus.emit("event", { ...dummyTask, contextId: TEST_CONTEXT_ID });
    bus.unregisterContext(TEST_CONTEXT_ID);
    expect(count).toBe(1);
  });

  it("ignores other context events", async () => {
    let count = 0;
    bus.onContext(TEST_CONTEXT_ID, (e) => {console.log(e); count++;});
    bus.registerContext(TEST_CONTEXT_ID);
    bus.emit("event", { ...dummyTask, contextId: TEST_CONTEXT_ID + '4'});
    bus.emit("event", { ...dummyTask, contextId: TEST_CONTEXT_ID });
    bus.unregisterContext(TEST_CONTEXT_ID);
    expect(count).toBe(1);
  });

  // Edge: unregistering contextId with no poller should not throw
  it("does not throw if unregisterContext called for unknown contextId", () => {
    expect(() => bus.unregisterContext("notfound")).not.toThrow();
  });
});
