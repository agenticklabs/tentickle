import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "../types.js";
import { ToolCallGroup } from "./ToolCallGroup.js";

function roleColor(role: "user" | "assistant"): string {
  return role === "user" ? "blue" : "magenta";
}

function roleLabel(role: "user" | "assistant"): string {
  return role === "user" ? "you" : "assistant";
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={roleColor(message.role)} bold>
        {roleLabel(message.role)}
      </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallGroup toolCalls={message.toolCalls} />
      )}
    </Box>
  );
}
