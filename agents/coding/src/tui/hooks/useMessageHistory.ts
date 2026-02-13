import { useState, useCallback, useEffect, useRef } from "react";
import { useEvents } from "@agentick/react";
import type { ToolCallStartEvent, ToolResultEvent, ExecutionEndEvent } from "@agentick/shared";
import type { ChatMessage } from "../types.js";
import { timelineToMessages, type TimelineEntry } from "../message-transforms.js";

/**
 * Flat message history — confirmed messages go straight to scrollback.
 *
 * - `messages`: all confirmed messages (append-only). Printed via console.log
 *   so Ink commits them to terminal scrollback. Never re-rendered, never flicker.
 * - `pending`: optimistic user message in the dynamic area until confirmed.
 *
 * Messages preserve raw content (string | ContentBlock[]) for per-type rendering.
 */
export function useMessageHistory(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatMessage | null>(null);
  const toolDurations = useRef<Map<string, number>>(new Map());
  const toolTimers = useRef<Map<string, number>>(new Map());
  const messageCount = useRef(0);

  const { event } = useEvents({
    sessionId,
    filter: ["execution_end", "tool_call_start", "tool_result"],
  });

  useEffect(() => {
    if (!event) return;

    if (event.type === "tool_call_start") {
      const e = event as ToolCallStartEvent;
      toolTimers.current.set(e.callId, Date.now());
    }

    if (event.type === "tool_result") {
      const e = event as ToolResultEvent;
      const startTime = toolTimers.current.get(e.callId);
      if (startTime) {
        toolDurations.current.set(e.callId, Date.now() - startTime);
        toolTimers.current.delete(e.callId);
      }
    }

    if (event.type === "execution_end") {
      const execEnd = event as ExecutionEndEvent;

      // Prefer delta (append) over full timeline (replace)
      const delta = execEnd.newTimelineEntries as TimelineEntry[] | undefined;
      if (delta && delta.length > 0) {
        const newMessages = timelineToMessages(delta, toolDurations.current);
        if (newMessages.length > 0) {
          setMessages((prev) => [...prev, ...newMessages]);
          messageCount.current += newMessages.length;
        }
        setPending(null);
        toolTimers.current.clear();
        return;
      }

      // Fallback: full timeline replace — extract only new messages
      // NOTE: output.timeline is not typed in ExecutionEndEvent (output is `unknown`).
      // This is a framework gap — should be typed upstream in @agentick/shared.
      const output = execEnd.output as { timeline?: TimelineEntry[] } | undefined;
      const timeline = output?.timeline;
      if (Array.isArray(timeline)) {
        const allMessages = timelineToMessages(timeline, toolDurations.current);
        const newMessages = allMessages.slice(messageCount.current);
        if (newMessages.length > 0) {
          setMessages((prev) => [...prev, ...newMessages]);
          messageCount.current += newMessages.length;
        }
        setPending(null);
        toolTimers.current.clear();
      }
    }
  }, [event]);

  // Will support attachments (images, files, etc.) — content becomes ContentBlock[]
  const addUserMessage = useCallback((content: string) => {
    setPending({
      id: `pending-${Date.now()}`,
      role: "user",
      content,
    });
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setPending(null);
    messageCount.current = 0;
    toolTimers.current.clear();
    toolDurations.current.clear();
  }, []);

  return { messages, pending, addUserMessage, clear };
}
