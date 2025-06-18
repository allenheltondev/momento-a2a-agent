import { Message, Task, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from "../types.js";
import { AgentExecutionEvent } from "../event/event_bus.js";
import { TaskStore } from "../store/task_store.js";

/**
 * Tracks state of the current task and synchronizes updates to Momento.
 * Handles task, status, artifact, and message events.
 */
export class ResultManager {
  private taskStore: TaskStore;
  private currentTask?: Task;
  private latestUserMessage?: Message;
  private finalMessageResult?: Message;

  constructor(taskStore: TaskStore) {
    this.taskStore = taskStore;
  }

  /** Set the latest user message to track for history. */
  public setContext(latestUserMessage: Message): void {
    this.latestUserMessage = latestUserMessage;
  }

  /**
   * Handle an agent execution event and update the task accordingly.
   * Persists changes to Momento via TaskStore.
   */
  public async processEvent(event: AgentExecutionEvent): Promise<void> {
    if (event.kind === "message") {
      // Final result: message
      this.finalMessageResult = event as Message;
      // ExecutionEventQueue will stop after a 'message' event.
    } else if (event.kind === "task") {
      // Update current task with new task event
      this.currentTask = { ...event as Task };

      // Ensure latest user message is present in history (prepend if not)
      if (this.latestUserMessage) {
        const alreadyExists = this.currentTask.history?.some(
          (msg) => msg.messageId === this.latestUserMessage!.messageId
        );
        if (!alreadyExists) {
          this.currentTask.history = [
            this.latestUserMessage,
            ...(this.currentTask.history || []),
          ];
        }
      }
      await this.saveCurrentTask();
    } else if (event.kind === "status-update") {
      const updateEvent = event as TaskStatusUpdateEvent;
      if (this.currentTask && this.currentTask.id === updateEvent.taskId) {
        this.currentTask.status = updateEvent.status;
        if (updateEvent.status.message) {
          // Add message to history if not already present
          if (
            !this.currentTask.history?.some(
              (msg) =>
                msg.messageId === updateEvent.status.message!.messageId
            )
          ) {
            this.currentTask.history = [
              ...(this.currentTask.history || []),
              updateEvent.status.message,
            ];
          }
        }
        await this.saveCurrentTask();
      } else if (!this.currentTask && updateEvent.taskId) {
        // Load task from store if not in memory
        const loaded = await this.taskStore.load(updateEvent.taskId);
        if (loaded) {
          this.currentTask = loaded;
          this.currentTask.status = updateEvent.status;
          if (updateEvent.status.message) {
            if (
              !this.currentTask.history?.some(
                (msg) =>
                  msg.messageId === updateEvent.status.message!.messageId
              )
            ) {
              this.currentTask.history = [
                ...(this.currentTask.history || []),
                updateEvent.status.message,
              ];
            }
          }
          await this.saveCurrentTask();
        } else {
          console.warn(
            `ResultManager: Received status update for unknown task ${updateEvent.taskId}`
          );
        }
      }
    } else if (event.kind === "artifact-update") {
      const artifactEvent = event as TaskArtifactUpdateEvent;
      if (this.currentTask && this.currentTask.id === artifactEvent.taskId) {
        if (!this.currentTask.artifacts) {
          this.currentTask.artifacts = [];
        }
        const existingIndex = this.currentTask.artifacts.findIndex(
          (art) => art.artifactId === artifactEvent.artifact.artifactId
        );
        if (existingIndex !== -1) {
          if (artifactEvent.append) {
            const existing = this.currentTask.artifacts[existingIndex];
            existing.parts.push(...artifactEvent.artifact.parts);
            if (artifactEvent.artifact.description)
              existing.description = artifactEvent.artifact.description;
            if (artifactEvent.artifact.name)
              existing.name = artifactEvent.artifact.name;
            if (artifactEvent.artifact.metadata)
              existing.metadata = {
                ...existing.metadata,
                ...artifactEvent.artifact.metadata,
              };
          } else {
            this.currentTask.artifacts[existingIndex] =
              artifactEvent.artifact;
          }
        } else {
          this.currentTask.artifacts.push(artifactEvent.artifact);
        }
        await this.saveCurrentTask();
      } else if (!this.currentTask && artifactEvent.taskId) {
        const loaded = await this.taskStore.load(artifactEvent.taskId);
        if (loaded) {
          this.currentTask = loaded;
          if (!this.currentTask.artifacts) this.currentTask.artifacts = [];
          const existingIndex = this.currentTask.artifacts.findIndex(
            (art) => art.artifactId === artifactEvent.artifact.artifactId
          );
          if (existingIndex !== -1) {
            if (artifactEvent.append) {
              this.currentTask.artifacts[existingIndex].parts.push(
                ...artifactEvent.artifact.parts
              );
            } else {
              this.currentTask.artifacts[existingIndex] =
                artifactEvent.artifact;
            }
          } else {
            this.currentTask.artifacts.push(artifactEvent.artifact);
          }
          await this.saveCurrentTask();
        } else {
          console.warn(
            `ResultManager: Received artifact update for unknown task ${artifactEvent.taskId}`
          );
        }
      }
    }
  }

  /** Persist the current task to the task store. */
  private async saveCurrentTask(): Promise<void> {
    if (this.currentTask) {
      await this.taskStore.save(this.currentTask);
    }
  }

  /** Get the final result for the request: a Message (if one was sent), or the last Task. */
  public getFinalResult(): Message | Task | undefined {
    return this.finalMessageResult ?? this.currentTask;
  }

  /** Get the current in-flight task (if any). */
  public getCurrentTask(): Task | undefined {
    return this.currentTask;
  }
}
