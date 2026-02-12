import React from "react";
import { Box, Text } from "ink";
import type { ContextInfo } from "@agentick/react";
import type { ChatMode } from "../types.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function stateColor(mode: ChatMode): string {
  switch (mode) {
    case "idle":
      return "green";
    case "streaming":
      return "yellow";
    case "confirming_tool":
      return "magenta";
  }
}

function stateLabel(mode: ChatMode): string {
  switch (mode) {
    case "idle":
      return "idle";
    case "streaming":
      return "streaming";
    case "confirming_tool":
      return "confirm";
  }
}

export function Header({
  chatMode,
  contextInfo,
}: {
  chatMode: ChatMode;
  contextInfo: ContextInfo | null;
}) {
  const model = contextInfo?.modelName ?? contextInfo?.modelId ?? "—";
  const tokens = contextInfo?.cumulativeUsage?.totalTokens ?? contextInfo?.totalTokens ?? 0;
  const utilization = contextInfo?.utilization;

  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text>
        <Text bold color="cyan">
          tentickle
        </Text>
        <Text color="gray"> | </Text>
        <Text>{model}</Text>
      </Text>

      <Text>
        {tokens > 0 && (
          <>
            <Text color="gray">{formatTokens(tokens)} tokens</Text>
            {utilization != null && (
              <Text color={utilization > 80 ? "red" : utilization > 50 ? "yellow" : "gray"}>
                {" "}
                {Math.round(utilization)}%
              </Text>
            )}
            <Text color="gray"> | </Text>
          </>
        )}
        <Text color={stateColor(chatMode)}>{stateLabel(chatMode)}</Text>
      </Text>
    </Box>
  );
}
