import {  TaskStatusUpdateEvent} from "../types.js";
import { AgentExecutionEvent, IExecutionEventBus } from "../event/event_bus";

export class ExecutionEventQueue {
  private readonly eventBus: IExecutionEventBus;
  private readonly contextId: string;
  private eventQueue: AgentExecutionEvent[] = [];
  private resolvePromise?: (value: void | PromiseLike<void>) => void;
  private stopped: boolean = false;

  constructor(eventBus: IExecutionEventBus, contextId: string) {
    this.eventBus = eventBus;
    this.contextId = contextId;

    this.boundHandleEvent = this.handleEvent.bind(this);
    this.eventBus.onContext(this.contextId, this.boundHandleEvent);
  }

  private boundHandleEvent: (event: AgentExecutionEvent) => void;

  private handleEvent(event: AgentExecutionEvent) {
    if(this.stopped) return;
    if ('contextId' in event && event.contextId === this.contextId) {
      this.eventQueue.push(event);
      if (this.resolvePromise) {
        this.resolvePromise();
        this.resolvePromise = undefined;
      }
    }
  }

  /**
   * Async generator that yields events for this contextId,
   * and auto-stops when a 'message' or final 'status-update' arrives.
   */
  public async *events(): AsyncGenerator<AgentExecutionEvent, void, undefined> {
    try {
      while (!this.stopped) {
        if (this.eventQueue.length > 0) {
          const event = this.eventQueue.shift()!;
          yield event;
          if (
            event.kind === "message" ||
            (event.kind === "status-update" &&
              (event as TaskStatusUpdateEvent).final)
          ) {
            this.stop();
            break;
          }
        } else {
          await new Promise<void>((resolve) => {
            this.resolvePromise = resolve;
          });
        }
      }
    } finally {
      // Always unregister listener for this context
      this.eventBus.unregisterContext(this.contextId);
    }
  }

  public stop(): void {
    this.stopped = true;
    if (this.resolvePromise) {
      this.resolvePromise();
      this.resolvePromise = undefined;
    }
    this.eventBus.unregisterContext(this.contextId);
  }
}
