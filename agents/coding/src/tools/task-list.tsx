import React from "react";
import { createTool, Section } from "@agentick/core";
import { z } from "zod";
import { taskStore, type Task } from "../task-store.js";

const STATUS_LABELS: Record<Task["status"], string> = {
  pending: "todo",
  in_progress: "working",
  completed: "done",
};

function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks.";
  return tasks.map((t) => `[${STATUS_LABELS[t.status]}] #${t.id}: ${t.title}`).join("\n");
}

export const TaskTool = createTool({
  name: "task_list",
  description:
    "Manage your task list. Use 'plan' to batch-create tasks from a list, " +
    "'add' to add one task, 'start' to mark in-progress, 'complete' to mark done, " +
    "'remove' to delete a task.",
  displaySummary: (input) => {
    if (input.action === "plan") return `plan (${input.tasks?.length ?? 0} tasks)`;
    if (input.action === "add") return `add: ${input.title}`;
    return `${input.action} #${input.id}`;
  },
  input: z.object({
    action: z.enum(["plan", "add", "start", "complete", "remove"]),
    tasks: z.array(z.string()).optional().describe("Batch task titles (plan action)"),
    title: z.string().optional().describe("Single task title (add action)"),
    id: z.number().optional().describe("Task ID (start/complete/remove actions)"),
  }),
  handler: (input) => {
    switch (input.action) {
      case "plan": {
        if (!input.tasks?.length) {
          return [{ type: "text" as const, text: "Error: 'plan' requires a non-empty tasks array." }];
        }
        taskStore.clear();
        for (const title of input.tasks) {
          taskStore.create(title);
        }
        return [{ type: "text" as const, text: formatTaskList(taskStore.list()) }];
      }
      case "add": {
        if (!input.title) {
          return [{ type: "text" as const, text: "Error: 'add' requires a title." }];
        }
        const task = taskStore.create(input.title);
        return [{ type: "text" as const, text: `Created #${task.id}: ${task.title}` }];
      }
      case "start": {
        if (input.id == null) {
          return [{ type: "text" as const, text: "Error: 'start' requires an id." }];
        }
        const task = taskStore.update(input.id, { status: "in_progress" });
        if (!task) return [{ type: "text" as const, text: `Error: Task #${input.id} not found.` }];
        return [{ type: "text" as const, text: `Started #${task.id}: ${task.title}` }];
      }
      case "complete": {
        if (input.id == null) {
          return [{ type: "text" as const, text: "Error: 'complete' requires an id." }];
        }
        const task = taskStore.update(input.id, { status: "completed" });
        if (!task) return [{ type: "text" as const, text: `Error: Task #${input.id} not found.` }];
        return [{ type: "text" as const, text: `Completed #${task.id}: ${task.title}` }];
      }
      case "remove": {
        if (input.id == null) {
          return [{ type: "text" as const, text: "Error: 'remove' requires an id." }];
        }
        const deleted = taskStore.delete(input.id);
        if (!deleted) return [{ type: "text" as const, text: `Error: Task #${input.id} not found.` }];
        return [{ type: "text" as const, text: `Removed #${input.id}.` }];
      }
    }
  },
  render: () => {
    const tasks = taskStore.list();
    if (tasks.length === 0) return null;
    return <Section id="task-list">{formatTaskList(tasks)}</Section>;
  },
});
