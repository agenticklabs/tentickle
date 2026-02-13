import type { ContentBlock, Message } from "@agentick/shared";
import type { ChatMessage, ToolCallEntry } from "./types.js";

export type TimelineEntry = { kind?: string; message?: Message };

export function extractToolCalls(content: ContentBlock[]): ToolCallEntry[] {
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

export function timelineToMessages(
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
      const contentBlocks = Array.isArray(msg.content) ? msg.content : [];
      const toolCalls = msg.role === "assistant" ? extractToolCalls(contentBlocks) : undefined;

      const toolCallsWithDurations = toolCalls?.map((tc) => ({
        ...tc,
        duration: toolDurations.get(tc.id),
      }));

      return {
        id: msg.id ?? `msg-${i}`,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        toolCalls:
          toolCallsWithDurations && toolCallsWithDurations.length > 0
            ? toolCallsWithDurations
            : undefined,
      };
    });
}
