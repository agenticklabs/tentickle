import { Timeline, Message as MessageComponent, useContextInfo } from "@agentick/core";
import type { COMTimelineEntry, CompactionStrategy } from "@agentick/core";
import type { Message } from "@agentick/shared";
import { extractText, isMediaBlock } from "@agentick/shared";

const TEXT_THRESHOLD = 280;
const EDGE_LENGTH = 140;

export function truncateEdges(text: string): string {
  if (text.length <= TEXT_THRESHOLD) return text;
  return `${text.slice(0, EDGE_LENGTH)}\n...\n${text.slice(-EDGE_LENGTH)}`;
}

export function hasMultimodal(msg: Message): boolean {
  return msg.content.some(isMediaBlock);
}

/**
 * Summary for user messages that contain multimodal content.
 * Preserves text, notes collapsed media types and count.
 */
export function userMultimodalSummary(msg: Message): string {
  const text = extractText(msg.content);
  const media = msg.content.filter(isMediaBlock);
  const typeCounts = new Map<string, number>();
  for (const b of media) typeCounts.set(b.type, (typeCounts.get(b.type) ?? 0) + 1);
  const labels = [...typeCounts].map(([t, c]) => (c > 1 ? `${t} ×${c}` : t));
  const parts: string[] = [];
  if (text) parts.push(truncateEdges(text));
  parts.push(`[${labels.join(", ")}]`);
  return parts.join("\n");
}

/**
 * Summary for tool result messages.
 * Truncates text output, notes media types. Falls back to "[tool result]".
 */
export function toolResultSummary(msg: Message): string {
  const text = extractText(msg.content);
  const media = msg.content.filter(isMediaBlock);
  const parts: string[] = [];
  if (text) parts.push(truncateEdges(text));
  if (media.length > 0) {
    const labels = media.map((b) => b.type);
    parts.push(`[${labels.join(", ")}]`);
  }
  return parts.join("\n") || "[tool result]";
}

// ---------------------------------------------------------------------------
// EnhancedTimeline — KV-cache-safe, budget-aware
// ---------------------------------------------------------------------------

export interface EnhancedTimelineProps {
  /** Explicit token budget. Omit to auto-derive from model context window. */
  maxTokens?: number;
  /** Compaction strategy. Default: sliding-window. */
  strategy?: CompactionStrategy;
  /** Reserved headroom tokens. Default: 8192. */
  headroom?: number;
}

/**
 * Timeline with automatic token budget management.
 *
 * KV cache safety: messages are NEVER modified between ticks. Instead,
 * TokenBudget evicts old entries entirely — the remaining entries are
 * verbatim, preserving the prefix cache across ticks.
 *
 * Budget: derived from `useContextInfo().contextWindow` if not explicitly
 * set. The `headroom` prop is the sole safety margin — no additional
 * multiplier. Uses sliding-window strategy that preserves system and user
 * messages while evicting old assistant/tool entries.
 */
export function EnhancedTimeline({ maxTokens, strategy, headroom }: EnhancedTimelineProps = {}) {
  const contextInfo = useContextInfo();

  // Derive budget from model's actual context window when not explicit.
  // headroom is the sole safety margin — no multiplier.
  const effectiveMaxTokens = maxTokens ?? contextInfo?.contextWindow ?? undefined;

  return (
    <Timeline
      maxTokens={effectiveMaxTokens}
      strategy={strategy ?? "sliding-window"}
      headroom={headroom ?? 8192}
      preserveRoles={["system", "user"]}
    >
      {(entries: COMTimelineEntry[], pending = []) => [
        ...entries.map((entry) => <MessageComponent key={entry.id} {...entry.message} />),
        ...pending.map((incomingMsg, i) => {
          const msg = incomingMsg.content as Message;
          return <MessageComponent key={msg.id || `pending-${i}`} {...msg} />;
        }),
      ]}
    </Timeline>
  );
}
