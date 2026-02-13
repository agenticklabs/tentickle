import { useState, useCallback, useEffect, useRef } from "react";
import { useEvents } from "@agentick/react";
import type { ToolCallStartEvent, ToolResultEvent, ExecutionEndEvent } from "@agentick/shared";
import type { ChatMessage } from "../types.js";
import { timelineToMessages, type TimelineEntry } from "../message-transforms.js";

/**
 * Flat message history with execution-aware queuing.
 *
 * - `messages`: confirmed messages (append-only). Printed via console.log
 *   so Ink commits them to terminal scrollback.
 * - `pending`: optimistic user message currently being processed.
 * - `queued`: messages submitted during an active execution, waiting their turn.
 *
 * When the user submits while an execution is running, the message goes to
 * `queued` instead of overwriting `pending`. On execution end, the first
 * queued message promotes to `pending` for the next execution cycle.
 */
export function useMessageHistory(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatMessage | null>(null);
  const [queued, setQueued] = useState<ChatMessage[]>([]);
  const executing = useRef(false);
  const toolDurations = useRef<Map<string, number>>(new Map());
  const toolTimers = useRef<Map<string, number>>(new Map());
  const messageCount = useRef(0);

  const { event } = useEvents({
    sessionId,
    filter: ["execution_start", "execution_end", "tool_call_start", "tool_result"],
  });

  useEffect(() => {
    if (!event) return;

    if (event.type === "execution_start") {
      executing.current = true;
    }

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
      executing.current = false;

      // Prefer delta (append) over full timeline (replace)
      const delta = execEnd.newTimelineEntries as TimelineEntry[] | undefined;
      if (delta && delta.length > 0) {
        const newMessages = timelineToMessages(delta, toolDurations.current);
        if (newMessages.length > 0) {
          setMessages((prev) => [...prev, ...newMessages]);
          messageCount.current += newMessages.length;
        }
        drainQueue();
        toolTimers.current.clear();
        return;
      }

      // Fallback: full timeline replace — extract only new messages
      const output = execEnd.output as { timeline?: TimelineEntry[] } | undefined;
      const timeline = output?.timeline;
      if (Array.isArray(timeline)) {
        const allMessages = timelineToMessages(timeline, toolDurations.current);
        const newMessages = allMessages.slice(messageCount.current);
        if (newMessages.length > 0) {
          setMessages((prev) => [...prev, ...newMessages]);
          messageCount.current += newMessages.length;
        }
        drainQueue();
        toolTimers.current.clear();
      }
    }
  }, [event]);

  // Promote first queued message to pending, or clear pending
  function drainQueue() {
    setQueued((prev) => {
      if (prev.length > 0) {
        setPending(prev[0]);
        return prev.slice(1);
      }
      setPending(null);
      return prev;
    });
  }

  const addUserMessage = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
    };

    if (executing.current) {
      setQueued((prev) => [...prev, msg]);
    } else {
      setPending(msg);
    }
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setPending(null);
    setQueued([]);
    messageCount.current = 0;
    executing.current = false;
    toolTimers.current.clear();
    toolDurations.current.clear();
  }, []);

  return { messages, pending, queued, addUserMessage, clear };
}
