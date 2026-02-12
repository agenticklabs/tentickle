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

type TimelineEntry = { kind?: string; message?: Message };

function timelineToMessages(
  entries: TimelineEntry[],
  toolDurations: Map<string, number>,
): ChatMessage[] {
  return entries
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

      const toolCallsWithDurations = toolCalls?.map((tc) => ({
        ...tc,
        duration: toolDurations.get(tc.id),
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
}

/**
 * Flat message history — confirmed messages go straight to Static.
 *
 * - `messages`: all confirmed messages (append-only). Fed to <Static> so they
 *   commit to terminal scrollback immediately. Never re-rendered, never flicker.
 * - `pending`: optimistic user message in the dynamic area until confirmed.
 *
 * The dynamic area stays small (pending + streaming + input + footer) regardless
 * of how long responses are. Long responses live in scrollback, not dynamic area.
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
        newTimelineEntries?: TimelineEntry[];
        output?: { timeline?: TimelineEntry[] };
      };

      // Prefer delta (append) over full timeline (replace)
      if (execEnd.newTimelineEntries && execEnd.newTimelineEntries.length > 0) {
        const newMessages = timelineToMessages(execEnd.newTimelineEntries, toolDurations.current);
        if (newMessages.length > 0) {
          setMessages((prev) => [...prev, ...newMessages]);
          messageCount.current += newMessages.length;
        }
        setPending(null);
        toolTimers.current.clear();
        return;
      }

      // Fallback: full timeline replace — extract only new messages
      const timeline = execEnd.output?.timeline;
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
