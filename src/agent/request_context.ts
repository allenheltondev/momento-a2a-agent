import type { Message, Task } from "../types";

export class RequestContext {
  public readonly userMessage: Message;
  public readonly task?: Task;
  public readonly referenceTasks?: Task[];
  private readonly cancellationChecker?: () => boolean | Promise<boolean>;

  constructor(userMessage: Message, cancellationChecker?: () => boolean | Promise<boolean>, task?: Task, referenceTasks?: Task[]) {
    this.userMessage = userMessage;
    this.cancellationChecker = cancellationChecker;
    this.task = task;
    this.referenceTasks = referenceTasks;
  }

  isCancelled(): boolean | Promise<boolean> {
    if (!this.cancellationChecker) return false;
    return this.cancellationChecker();
  }
}
