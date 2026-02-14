import React from "react";
import type { ReactNode } from "react";
import { Box, Text } from "ink";
import type { ChatMode } from "@agentick/client";
import {
  StatusBar,
  KeyboardHints,
  BrandLabel,
  TokenCount,
  ContextUtilization,
  StateIndicator,
  useStatusBarData,
} from "@agentick/tui";

const TENTICKLE_HINTS: Record<ChatMode, { key: string; action: string; color?: string }[]> = {
  idle: [
    { key: "Enter", action: "send" },
    { key: "Ctrl+L", action: "clear" },
    { key: "Ctrl+C", action: "exit" },
  ],
  streaming: [{ key: "Ctrl+C", action: "abort" }],
  confirming_tool: [
    { key: "Y", action: "approve", color: "green" },
    { key: "N", action: "reject", color: "red" },
    { key: "A", action: "always", color: "#34d399" },
  ],
};

/** Right side — reads context, builds segments dynamically to avoid dangling separators. */
function RightContent() {
  const data = useStatusBarData();
  const ci = data?.contextInfo;

  const segments: ReactNode[] = [];

  // Brand — always
  segments.push(<BrandLabel key="brand" name="tentickle" />);

  // Model — only when we have info
  const modelDisplay = ci?.modelName ?? ci?.modelId;
  if (modelDisplay) {
    segments.push(<Text key="model">{modelDisplay}</Text>);
  }

  // Tokens + utilization — only when there's data
  const hasTokens = (ci?.cumulativeUsage?.totalTokens ?? ci?.totalTokens ?? 0) > 0;
  if (hasTokens) {
    segments.push(
      <Text key="tokens">
        <TokenCount cumulative />
        {ci?.utilization != null && (
          <>
            <Text> </Text>
            <ContextUtilization />
          </>
        )}
      </Text>,
    );
  }

  // State — always
  segments.push(
    <StateIndicator key="state" labels={{ streaming: "active", confirming_tool: "confirm" }} />,
  );

  const sep = <Text color="gray"> | </Text>;
  return (
    <Text>
      {segments.map((seg, i) => (
        <Text key={i}>
          {i > 0 && sep}
          {seg}
        </Text>
      ))}
    </Text>
  );
}

export function Footer({
  chatMode,
  sessionId,
  showExitHint,
}: {
  chatMode: ChatMode;
  sessionId: string;
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

  return (
    <StatusBar
      sessionId={sessionId}
      mode={chatMode}
      left={<KeyboardHints hints={TENTICKLE_HINTS} />}
      right={<RightContent />}
    />
  );
}
