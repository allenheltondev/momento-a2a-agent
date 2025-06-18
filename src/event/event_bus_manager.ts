import { MomentoEventBus } from './event_bus.js';

export class ExecutionEventBusManager {
  private readonly messageIdToBus = new Map<string, MomentoEventBus>();
  private readonly taskIdToMessageId = new Map<string, string>();

  constructor(private readonly cacheName: string, private readonly apiKey: string) {}

  /**
   * Get or create an event bus for the given messageId and context.
   * Starts polling the context if not already started.
   */
  public createOrGetByMessageId(originalMessageId: string, contextId: string): MomentoEventBus {
    let bus = this.messageIdToBus.get(originalMessageId);

    if (!bus) {
      bus = new MomentoEventBus(this.cacheName, this.apiKey);
      this.messageIdToBus.set(originalMessageId, bus);
    }

    bus.registerContext(contextId);
    return bus;
  }

  /**
   * Associate a taskId with an original messageId.
   * Used to route future events for a task to the correct event bus.
   */
  public associateTask(taskId: string, originalMessageId: string): void {
    if (this.messageIdToBus.has(originalMessageId)) {
      this.taskIdToMessageId.set(taskId, originalMessageId);
    } else {
      console.warn(
        `ExecutionEventBusManager: no bus for messageId ${originalMessageId}; cannot bind task ${taskId}`
      );
    }
  }

  /**
   * Get an event bus by taskId.
   * Returns undefined if the mapping does not exist.
   */
  public getByTaskId(taskId: string): MomentoEventBus | undefined {
    const msgId = this.taskIdToMessageId.get(taskId);
    return msgId ? this.messageIdToBus.get(msgId) : undefined;
  }

  /**
   * Clean up an event bus (removes listeners and deletes mappings).
   */
  public cleanupByMessageId(originalMessageId: string): void {
    const bus = this.messageIdToBus.get(originalMessageId);
    if (bus) {
      try {
        bus.removeAllListeners('event');
      } catch (e) {
        // If userland listener throws, ignore
      }
    }
    this.messageIdToBus.delete(originalMessageId);

    // Clean up task mappings for this messageId
    for (const [taskId, msgId] of this.taskIdToMessageId) {
      if (msgId === originalMessageId) this.taskIdToMessageId.delete(taskId);
    }
  }

  /**
   * (Optional) Remove a task and its event bus by taskId.
   * Use if you want to clean up by taskId directly.
   */
  public cleanupByTaskId(taskId: string): void {
    const msgId = this.taskIdToMessageId.get(taskId);
    if (msgId) {
      this.cleanupByMessageId(msgId);
    }
  }
}

export default ExecutionEventBusManager;
