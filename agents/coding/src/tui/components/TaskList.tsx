import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { taskStore, type Task } from "../../task-store.js";

const STATUS_CONFIG: Record<Task["status"], { icon: string; color: string }> = {
  pending: { icon: "○", color: "gray" },
  in_progress: { icon: "▶", color: "yellow" },
  completed: { icon: "✓", color: "green" },
};

export function TaskList() {
  const [tasks, setTasks] = useState<Task[]>(taskStore.list());

  useEffect(() => {
    const onChange = () => setTasks(taskStore.list());
    taskStore.on("change", onChange);
    return () => {
      taskStore.off("change", onChange);
    };
  }, []);

  if (tasks.length === 0) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold>
        Tasks ({completed}/{tasks.length})
      </Text>
      {tasks.map((task) => {
        const { icon, color } = STATUS_CONFIG[task.status];
        return (
          <Box key={task.id} flexDirection="row" gap={1}>
            <Text color={color}>{icon}</Text>
            <Text color={color} dimColor={task.status === "completed"}>
              #{task.id}: {task.title}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
