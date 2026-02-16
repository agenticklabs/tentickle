import { EventEmitter } from "node:events";

export interface Task {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "completed";
}

export class TaskStore extends EventEmitter {
  private tasks = new Map<number, Task>();
  private nextId = 1;

  list(): Task[] {
    return [...this.tasks.values()];
  }

  create(title: string): Task {
    const task: Task = { id: this.nextId++, title, status: "pending" };
    this.tasks.set(task.id, task);
    this.emit("change");
    return task;
  }

  update(id: number, updates: Partial<Pick<Task, "title" | "status">>): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, updates);
    this.emit("change");
    return task;
  }

  delete(id: number): boolean {
    const deleted = this.tasks.delete(id);
    if (deleted) this.emit("change");
    return deleted;
  }

  clear(): void {
    this.tasks.clear();
    this.nextId = 1;
    this.emit("change");
  }

  hasIncomplete(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status !== "completed") return true;
    }
    return false;
  }
}

// Global ref for TUI bridge (parent agent binds, TUI reads)
let _taskStore: TaskStore | null = null;

export function bindTaskStore(store: TaskStore): void {
  _taskStore = store;
}

export function getTaskStore(): TaskStore | null {
  return _taskStore;
}
