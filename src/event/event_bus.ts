import { EventEmitter } from "events";
import { Task, Message, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from "../types";
import { MomentoClient, TopicSubscriptionResponse } from "../momento/client";

export type AgentExecutionEvent =
  | Message
  | Task
  | TaskStatusUpdateEvent
  | TaskArtifactUpdateEvent;

export interface IExecutionEventBus {
  publish(event: AgentExecutionEvent): Promise<void>;
  on(eventName: "event", listener: (event: AgentExecutionEvent) => void): this;
  off(eventName: "event", listener: (event: AgentExecutionEvent) => void): this;
  once(eventName: "event", listener: (event: AgentExecutionEvent) => void): this;
  removeAllListeners(eventName?: "event"): this;
  registerContext(contextId: string): void;
  onContext(contextId: string, listener: (event: AgentExecutionEvent) => void): this;
  unregisterContext(contextId: string): void;
}

interface PollState {
  seqNum: number;
  seqPage: number;
  ctrl: AbortController;
}

export class MomentoEventBus extends EventEmitter implements IExecutionEventBus {
  private readonly client: MomentoClient;
  private readonly pollers = new Map<string, PollState>();
  private readonly contextListeners = new Map<string, (e: AgentExecutionEvent) => void>();

  constructor(cacheName: string, apiKey: string) {
    super();
    this.client = new MomentoClient({ cacheName, apiKey });
  }

  async publish(event: AgentExecutionEvent): Promise<void> {
    if (!("contextId" in event) || !event.contextId) {
      throw new Error("publish(): event.contextId is required");
    }
    await this.client.topicPublish(event.contextId, JSON.stringify(event));
  }

  registerContext(contextId: string): void {
    if (this.pollers.has(contextId)) return;

    const state: PollState = {
      seqNum: 0,
      seqPage: 0,
      ctrl: new AbortController(),
    };
    this.pollers.set(contextId, state);

    const poll = async () => {
      while (!state.ctrl.signal.aborted) {
        try {
          const response: TopicSubscriptionResponse | undefined =
            await this.client.topicSubscribe(contextId, state.seqNum, state.seqPage);

          if (response) {
            for (const item of response.items) {
              if ("item" in item) {
                const raw = item.item.value.text;
                const parsed = JSON.parse(raw) as AgentExecutionEvent;
                this.emit("event", parsed);

                state.seqNum = item.item.topic_sequence_number + 1;
              } else if ("discontinuity" in item) {
                state.seqNum = item.discontinuity.new_topic_sequence + 1;
                state.seqPage = item.discontinuity.new_sequence_page;

                console.warn(`[MomentoEventBus] Discontinuity detected for ${contextId}: missed events between sequence ${state.seqNum} and ${item.discontinuity.new_topic_sequence}`);
                this.emit("discontinuity", {
                  contextId,
                  fromSequence: state.seqNum,
                  toSequence: item.discontinuity.new_topic_sequence,
                });
              }
            }
          }
        } catch (err: any) {
          if (err.name !== "AbortError") {
            console.error(`[MomentoEventBus] Poll error for ${contextId}:`, err);
          }
        }

        await new Promise((r) => setTimeout(r, 100));
      }
    };

    poll();
  }

  unregisterContext(contextId: string): void {
    this.pollers.get(contextId)?.ctrl.abort();
    this.pollers.delete(contextId);
    // Remove the filtered event listener
    const filteredListener = this.contextListeners.get(contextId);
    if (filteredListener) {
      this.off("event", filteredListener);
      this.contextListeners.delete(contextId);
    }
  }

  onContext(contextId: string, listener: (e: AgentExecutionEvent) => void): this {
    this.registerContext(contextId);
    const filteredListener = (e: AgentExecutionEvent) => {
      if (e.contextId === contextId) listener(e);
    };
    this.contextListeners.set(contextId, filteredListener);
    return this.on("event", filteredListener);
  }

  override removeAllListeners(eventName?: "event"): this {
    if (!eventName || eventName === "event") {
      for (const ctx of this.pollers.keys()) {
        this.unregisterContext(ctx);
      }
    }
    return super.removeAllListeners(eventName);
  }

  async close(): Promise<void> {
    for (const ctx of this.pollers.keys()) {
      this.unregisterContext(ctx);
    }
    this.removeAllListeners();
  }
}

