import { v4 as uuidv4 } from "uuid";
import {
  AgentCard,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  MessageSendParams,
  TaskQueryParams,
  TaskIdParams,
  PushNotificationConfig,
  TaskPushNotificationConfig,
} from "../types";
import { MomentoTaskStore, TaskStore } from "../store/task_store";
import { MomentoClient } from "../momento/client";
import { MomentoEventBus } from "../event/event_bus";
import { MomentoAgentExecutor } from "../agent/executor";
import { A2AError } from "../server/error";
import { ResultManager } from "../server/result_manager";
import { ExecutionEventQueue } from "../event/queue";

const PREFIX = {
  PushConfig: "push-config:",
  Cancelled: "cancelled-task:",
};

export interface MomentoAgentRequestHandlerOptions {
  momentoApiKey: string;
  cacheName: string;
  defaultTtlSeconds?: number;
  agentCard: AgentCard;
  executor: MomentoAgentExecutor;
}

export class MomentoAgentRequestHandler {
  private readonly agentCard: AgentCard;
  private readonly taskStore: TaskStore;
  private readonly client: MomentoClient;
  private readonly eventBus: MomentoEventBus;
  private readonly executor: MomentoAgentExecutor;

  constructor(opts: MomentoAgentRequestHandlerOptions) {
    this.agentCard = opts.agentCard;
    this.taskStore = new MomentoTaskStore(opts.cacheName, opts.momentoApiKey);
    this.client = new MomentoClient({
      apiKey: opts.momentoApiKey,
      cacheName: opts.cacheName,
      defaultTtlSeconds: opts.defaultTtlSeconds ?? 300,
    });
    this.eventBus = new MomentoEventBus(opts.cacheName, opts.momentoApiKey);
    this.executor = opts.executor;
  }

  async verifyConnection(): Promise<boolean> {
    return await this.client.isValidConnection();
  }

  async getAgentCard(): Promise<AgentCard> {
    return this.agentCard;
  }

  /** Send a message, returning the final Task result (or Message, per protocol) */
  async sendMessage(params: MessageSendParams): Promise<Task> {
    const msg = params.message;
    if (!msg.messageId) throw A2AError.invalidParams("message.messageId is required.");

    const resultManager = new ResultManager(this.taskStore);
    resultManager.setContext(msg);

    let task: Task | undefined = undefined;
    if (msg.taskId) {
      task = await this.taskStore.load(msg.taskId);
      if (!task) throw A2AError.taskNotFound(msg.taskId);
    }

    const contextId = msg.contextId || task?.contextId || uuidv4();
    this.eventBus.registerContext(contextId);
    const eventQueue = new ExecutionEventQueue(this.eventBus, contextId);

    // Kick off agent execution
    this.executor.execute(msg, this.eventBus, { task }).catch((err) => {
      const failedEvent: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: task?.id || uuidv4(),
        contextId,
        status: {
          state: "failed",
          message: {
            ...msg,
            parts: [
              {
                kind: "text",
                text: `Agent execution failed: ${err.message ?? err}`,
              },
            ],
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      this.eventBus.publish(failedEvent);
    });



    return await Promise.race([
      (async () => {
        let finalTask: Task | undefined = undefined;
        try {
          for await (const event of eventQueue.events()) {
            try {
              await resultManager.processEvent(event);
            } catch (err: any) {
              console.error("Error processing event", {
                contextId,
                taskId: task?.id,
                messageId: msg.messageId,
                eventKind: (event as any)?.kind,
                error: err,
                stack: err instanceof Error ? err.stack : undefined,
              });

              const failedEvent: TaskStatusUpdateEvent = {
                kind: "status-update",
                taskId: task?.id || uuidv4(),
                contextId,
                status: {
                  state: "failed",
                  message: {
                    ...msg,
                    parts: [
                      {
                        kind: "text",
                        text: `Event processing failed: ${err?.message ?? String(err)}`,
                      },
                    ],
                  },
                  timestamp: new Date().toISOString(),
                },
                final: true,
              };
              await this.eventBus.publish(failedEvent);
              throw err;
            }

            if (
              (event.kind === "task" && isFinal(event.status.state)) ||
              (event.kind === "status-update" && event.final && isFinal(event.status.state))
            ) {
              finalTask = await this.taskStore.load(event.kind === "task" ? event.id : event.taskId);
              break;
            }
          }
        } catch (error: any) {
          console.error("sendMessage: unhandled error while processing events", {
            contextId,
            taskId: task?.id,
            messageId: msg.messageId,
            error,
            stack: error instanceof Error ? error.stack : undefined,
          });
          throw error;
        } finally {
          // Stop the queue; it will handle unregistering its context listener.
          eventQueue.stop();
        }

        if (!finalTask) {
          const possible = resultManager.getFinalResult?.();
          if (possible && (possible as any).kind === "task") {
            return possible as Task;
          }
          throw A2AError.internalError(
            `No final task result (contextId=${contextId}, taskId=${task?.id ?? "n/a"}, messageId=${msg.messageId}).`
          );
        }
        return finalTask;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          eventQueue.stop();
          reject(A2AError.internalError("Timeout waiting for agent execution."));
        }, 30_000)
      )
    ]);
  }

  /** Streaming message interface (yields events as they happen) */
  async *sendMessageStream(
    params: MessageSendParams,
  ): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined> {
    const msg = params.message;
    if (!msg.messageId) throw A2AError.invalidParams("message.messageId is required.");

    let task: Task | undefined = undefined;
    if (msg.taskId) {
      task = await this.taskStore.load(msg.taskId);
      if (!task) throw A2AError.taskNotFound(msg.taskId);
    }

    const resultManager = new ResultManager(this.taskStore);
    resultManager.setContext(msg);

    const contextId = msg.contextId || task?.contextId || uuidv4();
    this.eventBus.registerContext(contextId);
    const eventQueue = new ExecutionEventQueue(this.eventBus, contextId);

    this.executor.execute(msg, this.eventBus, { task }).catch((err) => {
      const failedEvent: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: task?.id || uuidv4(),
        contextId,
        status: {
          state: "failed",
          message: {
            ...msg,
            parts: [
              {
                kind: "text",
                text: `Agent execution failed: ${err.message ?? err}`,
              },
            ],
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      this.eventBus.publish(failedEvent);
    });

    try {
      for await (const event of eventQueue.events()) {
        await resultManager.processEvent(event);
        if (
          event.kind === "task" ||
          event.kind === "status-update" ||
          event.kind === "artifact-update"
        ) {
          yield event;
        }
      }
    } finally {
      eventQueue.stop();
      this.eventBus.unregisterContext(contextId);
    }
  }

  /** Get a task by ID */
  async getTask(params: TaskQueryParams): Promise<Task> {
    const task = await this.taskStore.load(params.id);
    if (!task) throw A2AError.taskNotFound(params.id);
    // Optionally slice history if needed
    if (
      typeof params.historyLength === "number" &&
      params.historyLength >= 0 &&
      Array.isArray((task as any).history)
    ) {
      (task as any).history = (task as any).history.slice(-params.historyLength);
    }
    return task;
  }

  /** Cancel a task by ID */
  async cancelTask(params: TaskIdParams): Promise<Task> {
    const task = await this.taskStore.load(params.id);
    if (!task) throw A2AError.taskNotFound(params.id);

    if (isFinal(task.status.state)) {
      throw A2AError.taskNotCancelable(params.id);
    }

    // Mark task as canceled (or use pub/sub if you want live updates)
    task.status = {
      state: "canceled",
      message: {
        kind: "message",
        role: "agent",
        messageId: uuidv4(),
        parts: [{ kind: "text", text: "Task cancellation requested by user." }],
        taskId: task.id,
        contextId: task.contextId,
      },
      timestamp: new Date().toISOString(),
    };
    await this.taskStore.save(task);

    // Emit to pub/sub for live update listeners
    await this.eventBus.publish({
      kind: "status-update",
      taskId: task.id,
      contextId: task.contextId,
      status: task.status,
      final: true,
    });
    return task;
  }

  /** Set push notification config (if agent supports it) */
  async setTaskPushNotificationConfig(params: TaskPushNotificationConfig): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities.pushNotifications) throw A2AError.pushNotificationNotSupported();
    const task = await this.taskStore.load(params.taskId);
    if (!task) throw A2AError.taskNotFound(params.taskId);
    await this.client.set(PREFIX.PushConfig + params.taskId, params.pushNotificationConfig);
    return params;
  }

  /** Get push notification config (if agent supports it) */
  async getTaskPushNotificationConfig(params: TaskIdParams): Promise<TaskPushNotificationConfig> {
    if (!this.agentCard.capabilities.pushNotifications) throw A2AError.pushNotificationNotSupported();
    const task = await this.taskStore.load(params.id);
    if (!task) throw A2AError.taskNotFound(params.id);
    const config = await this.client.get<PushNotificationConfig>(PREFIX.PushConfig + params.id, { format: "json" });
    if (!config) throw A2AError.internalError(`Push notification config not found for task ${params.id}.`);
    return { taskId: params.id, pushNotificationConfig: config };
  }

  /** Resubscribe to an existing task's event stream */
  async *resubscribe(params: TaskIdParams): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined> {
    const task = await this.taskStore.load(params.id);
    if (!task) throw A2AError.taskNotFound(params.id);

    yield task;

    // If task is already final, return immediately
    if (isFinal(task.status.state)) return;

    const contextId = task.contextId;
    // Use ExecutionEventQueue for proper event handling
    const eventQueue = new ExecutionEventQueue(this.eventBus, contextId);

    try {
      for await (const event of eventQueue.events()) {
        // Only yield relevant events for this task
        if (
          (event.kind === "status-update" || event.kind === "artifact-update" || event.kind === "task") &&
          ((event as any).taskId === params.id || (event as any).id === params.id)
        ) {
          yield event;
        }
      }
    } finally {
      eventQueue.stop();
      this.eventBus.unregisterContext(contextId);
    }
  }
}

function isFinal(state: string) {
  return ["completed", "failed", "canceled", "rejected"].includes(state);
}
