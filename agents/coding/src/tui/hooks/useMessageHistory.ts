import { useState, useCallback, useEffect, useRef } from "react";
import { useEvents } from "@agentick/react";
import type { ContentBlock, Message, StreamEvent } from "@agentick/shared";
import type { ChatMessage, ToolCallEntry } from "../types.js";

function extractText(content: ContentBlock[] | string): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is ContentBlock & { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function extractToolCalls(content: ContentBlock[]): ToolCallEntry[] {
  return content
    .filter(
      (b): b is ContentBlock & { type: "tool_use"; id: string; name: string } =>
        b.type === "tool_use",
    )
    .map((b) => ({
      id: b.id,
      name: b.name,
      status: "done" as const,
    }));
}

export function useMessageHistory(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Tool call durations tracked separately, applied when timeline arrives
  const toolDurations = useRef<Map<string, number>>(new Map());
  const toolTimers = useRef<Map<string, number>>(new Map());

  const { event } = useEvents({
    sessionId,
    filter: ["execution_end", "tool_call_start", "tool_result"],
  });

  useEffect(() => {
    if (!event) return;

    // Track tool call durations for later application
    if (event.type === "tool_call_start") {
      const e = event as StreamEvent & { callId?: string };
      const id = e.callId ?? "unknown";
      toolTimers.current.set(id, Date.now());
    }

    if (event.type === "tool_result") {
      const e = event as StreamEvent & { callId?: string };
      const id = e.callId ?? "unknown";
      const startTime = toolTimers.current.get(id);
      if (startTime) {
        toolDurations.current.set(id, Date.now() - startTime);
        toolTimers.current.delete(id);
      }
    }

    if (event.type === "execution_end") {
      const execEnd = event as StreamEvent & {
        output?: {
          timeline?: Array<{ kind?: string; message?: Message }>;
        };
      };

      const timeline = execEnd.output?.timeline;
      if (!Array.isArray(timeline)) return;

      // Timeline IS the conversation. Extract all messages, REPLACE state.
      const allMessages: ChatMessage[] = timeline
        .filter(
          (entry) =>
            entry.kind === "message" &&
            entry.message &&
            (entry.message.role === "user" || entry.message.role === "assistant"),
        )
        .map((entry, i) => {
          const msg = entry.message!;
          const content = Array.isArray(msg.content) ? msg.content : [];
          const toolCalls = msg.role === "assistant" ? extractToolCalls(content) : undefined;

          // Apply tracked durations to tool calls
          const toolCallsWithDurations = toolCalls?.map((tc) => ({
            ...tc,
            duration: toolDurations.current.get(tc.id),
          }));

          return {
            id: msg.id ?? `msg-${i}`,
            role: msg.role as "user" | "assistant",
            content: extractText(msg.content),
            toolCalls:
              toolCallsWithDurations && toolCallsWithDurations.length > 0
                ? toolCallsWithDurations
                : undefined,
          };
        });

      toolTimers.current.clear();
      setMessages(allMessages);
    }
  }, [event]);

  // Instant feedback — user sees their message immediately, before execution_end
  // arrives with the canonical timeline. Gets overwritten on next execution_end.
  const addUserMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content,
      },
    ]);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    toolTimers.current.clear();
    toolDurations.current.clear();
  }, []);

  return { messages, addUserMessage, clear };
}
