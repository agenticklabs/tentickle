import React from "react";
import { Box, Text } from "ink";
import type { ToolCallEntry } from "../types.js";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallGroup({ toolCalls }: { toolCalls: ToolCallEntry[] }) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      {toolCalls.map((tc) => (
        <Box key={tc.id} gap={1}>
          <Text dimColor>
            + {tc.name}
            {tc.duration != null && <Text> ({formatDuration(tc.duration)})</Text>}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
