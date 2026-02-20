import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { getTaskStore, type Task } from "@tentickle/agent";

const STATUS_CONFIG: Record<Task["status"], { icon: string; color: string }> = {
  pending: { icon: "○", color: "gray" },
  in_progress: { icon: "▶", color: "yellow" },
  completed: { icon: "✓", color: "green" },
};

export function TaskList() {
  const store = getTaskStore();
  const [tasks, setTasks] = useState<Task[]>(store?.list() ?? []);

  useEffect(() => {
    if (!store) return;
    setTasks(store.list());
    const onChange = () => setTasks(store.list());
    store.on("change", onChange);
    return () => {
      store.off("change", onChange);
    };
  }, [store]);

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
