import { EventEmitter } from "events";
import { AgentExecutionEvent, IExecutionEventBus } from "./event_bus.js";

export class InMemoryEventBus extends EventEmitter implements IExecutionEventBus {
  private contextListeners: Map<string, Set<(e: AgentExecutionEvent) => void>>;

  constructor() {
    super();
    this.contextListeners = new Map();
  }

  async publish(event: AgentExecutionEvent): Promise<void> {
    if (!("contextId" in event) || !event.contextId) {
      throw new Error("publish(): event.contextId is required");
    }
    this.emit("event", event);
  }

  registerContext(contextId: string): void {
    if (!this.contextListeners.has(contextId)) {
      this.contextListeners.set(contextId, new Set());
    }
  }

  onContext(contextId: string, listener: (e: AgentExecutionEvent) => void): this {
    const filteredListener = (e: AgentExecutionEvent) => {
      if (e.contextId === contextId) {
        listener(e);
      }
    };

    let listeners = this.contextListeners.get(contextId);
    if (!listeners) {
      listeners = new Set();
      this.contextListeners.set(contextId, listeners);
    }
    listeners.add(filteredListener);

    return this.on("event", filteredListener);
  }

  unregisterContext(contextId: string): void {
    const listeners = this.contextListeners.get(contextId);
    if (listeners) {
      for (const listener of listeners) {
        this.off("event", listener);
      }
      this.contextListeners.delete(contextId);
    }
  }

  override removeAllListeners(eventName?: "event"): this {
    if (!eventName || eventName === "event") {
      for (const contextId of this.contextListeners.keys()) {
        this.unregisterContext(contextId);
      }
    }
    return super.removeAllListeners(eventName);
  }

  async close(): Promise<void> {
    for (const contextId of this.contextListeners.keys()) {
      this.unregisterContext(contextId);
    }
    this.removeAllListeners();
  }
}
