import React from "react";
import { Box, Text } from "ink";
import type { ChatMode, UIMode } from "../types.js";

function IdleInputHints() {
  return (
    <Text>
      <Text bold>Enter</Text>
      <Text color="gray"> send | </Text>
      <Text bold>Ctrl+U</Text>
      <Text color="gray"> scroll | </Text>
      <Text bold>Ctrl+L</Text>
      <Text color="gray"> clear | </Text>
      <Text bold>Ctrl+C</Text>
      <Text color="gray"> exit</Text>
    </Text>
  );
}

function ScrollHints() {
  return (
    <Text>
      <Text bold>↑↓</Text>
      <Text color="gray"> scroll | </Text>
      <Text bold>Ctrl+U/D</Text>
      <Text color="gray"> page | </Text>
      <Text bold>Esc</Text>
      <Text color="gray"> back</Text>
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
      <Text bold color="cyan">
        A
      </Text>
      <Text color="gray"> always</Text>
    </Text>
  );
}

export function Footer({
  chatMode,
  uiMode,
  showExitHint,
}: {
  chatMode: ChatMode;
  uiMode: UIMode;
  showExitHint: boolean;
}) {
  if (showExitHint) {
    return (
      <Box borderStyle="single" borderColor="red" paddingX={1}>
        <Text color="red" bold>
          Press Ctrl+C again to exit
        </Text>
      </Box>
    );
  }

  let hints: React.ReactNode;
  if (chatMode === "confirming_tool") {
    hints = <ConfirmHints />;
  } else if (chatMode === "streaming") {
    hints = <StreamingHints />;
  } else if (uiMode === "scroll") {
    hints = <ScrollHints />;
  } else {
    hints = <IdleInputHints />;
  }

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {hints}
    </Box>
  );
}
