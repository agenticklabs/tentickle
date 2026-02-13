import React from "react";
import { Box, Text } from "ink";
import type { ContextInfo } from "@agentick/react";
import type { ChatMode } from "@agentick/client";

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
      return "active";
    case "confirming_tool":
      return "confirm";
  }
}

function IdleHints() {
  return (
    <Text>
      <Text bold>Enter</Text>
      <Text color="gray"> send | </Text>
      <Text bold>Ctrl+L</Text>
      <Text color="gray"> clear | </Text>
      <Text bold>Ctrl+C</Text>
      <Text color="gray"> exit</Text>
    </Text>
  );
}

function StreamingHints() {
  return (
    <Text>
      <Text bold>Ctrl+C</Text>
      <Text color="gray"> abort</Text>
    </Text>
  );
}

function ConfirmHints() {
  return (
    <Text>
      <Text bold color="green">
        Y
      </Text>
      <Text color="gray"> approve | </Text>
      <Text bold color="red">
        N
      </Text>
      <Text color="gray"> reject | </Text>
      <Text bold color="#34d399">
        A
      </Text>
      <Text color="gray"> always</Text>
    </Text>
  );
}

export function Footer({
  chatMode,
  contextInfo,
  showExitHint,
}: {
  chatMode: ChatMode;
  contextInfo: ContextInfo | null;
  showExitHint: boolean;
}) {
  if (showExitHint) {
    return (
      <Box paddingX={1}>
        <Text color="red" bold>
          Press Ctrl+C again to exit
        </Text>
      </Box>
    );
  }

  const model = contextInfo?.modelName ?? contextInfo?.modelId ?? "—";
  const tokens = contextInfo?.cumulativeUsage?.totalTokens ?? contextInfo?.totalTokens ?? 0;
  const utilization = contextInfo?.utilization;

  let hints: React.ReactNode;
  if (chatMode === "confirming_tool") {
    hints = <ConfirmHints />;
  } else if (chatMode === "streaming") {
    hints = <StreamingHints />;
  } else {
    hints = <IdleHints />;
  }

  return (
    <Box flexDirection="row" paddingX={1} justifyContent="space-between">
      {hints}
      <Text>
        <Text bold color="#34d399">
          tentickle
        </Text>
        <Text color="gray"> | </Text>
        <Text>{model}</Text>
        {tokens > 0 && (
          <>
            <Text color="gray"> | {formatTokens(tokens)}</Text>
            {utilization != null && (
              <Text color={utilization > 80 ? "red" : utilization > 50 ? "yellow" : "gray"}>
                {" "}
                {Math.round(utilization)}%
              </Text>
            )}
          </>
        )}
        <Text color="gray"> | </Text>
        <Text color={stateColor(chatMode)}>{stateLabel(chatMode)}</Text>
      </Text>
    </Box>
  );
}
