import React from "react";
import type { ChatMessage } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";

export function MessageArea({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </>
  );
}
