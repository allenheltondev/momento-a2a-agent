import { Task } from "../types.js";
import { TaskStore } from "./task_store.js";

interface StoredTask {
  task: Task;
  expiresAt?: number;
}

export class InMemoryTaskStore implements TaskStore {
  private store: Map<string, StoredTask>;
  private timers: Map<string, NodeJS.Timeout>;

  constructor() {
    this.store = new Map();
    this.timers = new Map();
  }

  async save(task: Task, ttlSeconds?: number): Promise<void> {
    const storedTask: StoredTask = {
      task: this.cloneTask(task),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined
    };

    this.store.set(task.id, storedTask);

    if (ttlSeconds) {
      this.scheduleExpiration(task.id, ttlSeconds);
    }
  }

  async load(taskId: string): Promise<Task | undefined> {
    const storedTask = this.store.get(taskId);

    if (!storedTask) {
      return undefined;
    }

    if (storedTask.expiresAt && Date.now() >= storedTask.expiresAt) {
      this.cleanup(taskId);
      return undefined;
    }

    return this.cloneTask(storedTask.task);
  }

  private scheduleExpiration(taskId: string, ttlSeconds: number): void {
    const existingTimer = this.timers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.cleanup(taskId);
    }, ttlSeconds * 1000);

    this.timers.set(taskId, timer);
  }

  private cleanup(taskId: string): void {
    this.store.delete(taskId);

    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  private cloneTask(task: Task): Task {
    return JSON.parse(JSON.stringify(task));
  }
}
