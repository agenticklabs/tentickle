import React from "react";
import { Box } from "ink";
import { StreamingMessage, ToolCallIndicator } from "@agentick/tui";

export function StreamingZone({ isActive, sessionId }: { isActive: boolean; sessionId: string }) {
  if (!isActive) return null;

  return (
    <Box flexDirection="column">
      <StreamingMessage />
      <ToolCallIndicator sessionId={sessionId} />
    </Box>
  );
}
