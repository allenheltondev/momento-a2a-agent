import { v4 as uuidv4 } from "uuid";
import { Message, Task, TaskStatusUpdateEvent, Artifact } from "../types";
import { IExecutionEventBus } from "../event/event_bus";

export type MomentoAgentHandlerResult =
  | string
  | {
    parts?: Array<{ kind: "text"; text: string; } | { kind: "file"; file: any; } | { kind: "data"; data: any; }>;
    artifacts?: Artifact[];
    metadata?: Record<string, any>;
  }
  | Partial<Task>;

export type HandleTaskFn = (message: Message, context: { task: Task; }) => Promise<MomentoAgentHandlerResult>;

export interface MomentoAgentExecutorOptions {
  agentName?: string;
  agentId?: string;
}

export class MomentoAgentExecutor {
  private readonly handleTask: HandleTaskFn;
  private readonly agentName?: string;
  private readonly agentId?: string;

  constructor(handleTask: HandleTaskFn, opts?: MomentoAgentExecutorOptions) {
    this.handleTask = handleTask;
    this.agentName = opts?.agentName;
    this.agentId = opts?.agentId;
  }

  async execute(message: Message, eventBus: IExecutionEventBus, context: { task?: Task; }): Promise<void> {
    let task = initializeTask({
      base: context.task,
      message,
      agentName: this.agentName,
      agentId: this.agentId,
    });

    if (!context.task) {
      await eventBus.publish(task);
    }

    const workingUpdate: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: task.id,
      contextId: task.contextId,
      status: {
        state: "working",
        message,
        timestamp: new Date().toISOString(),
      },
      final: false,
      metadata: {
        agentName: this.agentName,
        agentId: this.agentId,
      },
    };
    await eventBus.publish(workingUpdate);

    try {
      const handlerResult = await this.handleTask(message, { task });

      let resultTask: Task = { ...task };
      let parts: any[] = [];
      let artifacts: Artifact[] = [];
      let metadata: Record<string, any> = {};

      if (typeof handlerResult === "string") {
        parts = [{ kind: "text", text: handlerResult }];
      } else if (isPartialTask(handlerResult)) {
        resultTask = { ...resultTask, ...handlerResult };
      } else if (isPartsResult(handlerResult)) {
        parts = handlerResult.parts ?? [];
        artifacts = handlerResult.artifacts ?? [];
        metadata = handlerResult.metadata ?? {};

        if (parts.length) {
          resultTask.status = {
            ...resultTask.status,
            message: {
              ...message,
              parts,
            },
            state: "completed",
            timestamp: new Date().toISOString(),
          };
        }
        if (artifacts.length) {
          resultTask.artifacts = [...(resultTask.artifacts ?? []), ...artifacts];
        }
        if (Object.keys(metadata).length > 0) {
          resultTask.metadata = { ...(resultTask.metadata ?? {}), ...metadata };
        }
      }

      // Always push the message to history if not already present
      if (Array.isArray(resultTask.history)) {
        if (!resultTask.history.some(msg => msg.messageId === message.messageId)) {
          resultTask.history.push(message);
        }
      } else {
        resultTask.history = [message];
      }

      const completedUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: resultTask.id,
        contextId: resultTask.contextId,
        status: {
          state: "completed",
          message: resultTask.status.message!,
          timestamp: resultTask.status.timestamp ?? new Date().toISOString(),
        },
        final: true,
        metadata: {
          agentName: this.agentName,
          agentId: this.agentId,
        },
      };
      await eventBus.publish(completedUpdate);
    } catch (err: any) {
      const failedMessage: Message = {
        ...message,
        parts: [
          {
            kind: "text",
            text: `Agent execution failed: ${err?.message ?? String(err)}`,
          },
        ],
      };
      if (task?.history) task.history.push(failedMessage);

      const failedUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: task.id,
        contextId: task.contextId,
        status: {
          state: "failed",
          message: failedMessage,
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: {
          agentName: this.agentName,
          agentId: this.agentId,
        },
      };
      await eventBus.publish(failedUpdate);
      console.error("Agent execution failed:", err);
    }
  }
}

function initializeTask({ base, message, agentName, agentId, }: { base?: Task; message: Message; agentName?: string; agentId?: string; }): Task {
  const now = new Date().toISOString();
  return {
    kind: "task",
    id: base?.id ?? message.taskId ?? uuidv4(),
    contextId: message.contextId ?? base?.contextId ?? uuidv4(),
    status: {
      state: "submitted",
      message,
      timestamp: now,
    },
    history: (base?.history ?? []).concat(message),
    artifacts: base?.artifacts ?? [],
    metadata: {
      ...(base?.metadata ?? {}),
      ...message.metadata,
      agentName,
      agentId,
    },
  };
}

function isPartsResult(val: any): val is { parts?: any[], artifacts?: any[], metadata?: any } {
  if (!val || typeof val !== "object") return false;
  if ("kind" in val && val.kind === "task") return false;
  return (
    "parts" in val ||
    "artifacts" in val ||
    "metadata" in val
  );
}

function isPartialTask(val: any): val is Partial<Task> {
  return !!val && typeof val === "object" && val.kind === "task";
}
