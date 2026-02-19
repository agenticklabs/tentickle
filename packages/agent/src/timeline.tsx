import {
  Timeline,
  Message as MessageComponent,
  useOnMount,
  useOnTickStart,
  useState,
} from "@agentick/core";
import type { COMTimelineEntry } from "@agentick/core";
import { extractText, isMediaBlock, type Message } from "@agentick/shared";

const TEXT_THRESHOLD = 280;
const EDGE_LENGTH = 140;

function isOld(msg: Message, threshold: number | null): boolean {
  if (!threshold || !msg.createdAt) return false;
  return new Date(msg.createdAt).getTime() < threshold;
}

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

/**
 * Enhanced timeline: current execution full-fidelity, past compacted.
 *
 * Historical tool results get collapsed summaries. Historical user messages
 * with multimodal content get text-only summaries. Assistant messages are
 * never modified (ICL corruption risk). All collapsed messages get
 * expandable ref names.
 */
export function EnhancedTimeline() {
  const [executionStartedAt, setExecutionStartedAt] = useState<number | null>(null);

  useOnMount(() => {
    setExecutionStartedAt(Date.now());
  });

  useOnTickStart((tickState) => {
    if (tickState.tick === 1) {
      setExecutionStartedAt(Date.now());
    }
  });

  return (
    <Timeline>
      {(entries: COMTimelineEntry[], pending = []) => [
        ...entries.map((entry, index) => {
          const msg = entry.message;

          // Current execution: full fidelity
          if (!isOld(msg, executionStartedAt)) {
            return <MessageComponent key={entry.id} {...msg} />;
          }

          // Historical: role-specific collapse strategy
          switch (msg.role) {
            // Assistant: never modify — ICL corruption risk
            case "assistant":
              return <MessageComponent key={entry.id} {...msg} />;

            // Tool results: collapse with content summary (not drop)
            case "tool":
              return (
                <MessageComponent
                  key={entry.id}
                  {...msg}
                  collapsed={toolResultSummary(msg)}
                  collapsedName={`ref:${index}`}
                />
              );

            // User: only collapse if multimodal content present
            case "user":
              if (hasMultimodal(msg)) {
                return (
                  <MessageComponent
                    key={entry.id}
                    {...msg}
                    collapsed={userMultimodalSummary(msg)}
                    collapsedName={`ref:${index}`}
                  />
                );
              }
              return <MessageComponent key={entry.id} {...msg} />;

            default:
              return <MessageComponent key={entry.id} {...msg} />;
          }
        }),
        ...pending.map((incomingMsg, i) => {
          const msg = incomingMsg.content as Message;
          return <MessageComponent key={msg.id || `pending-${i}`} {...msg} />;
        }),
      ]}
    </Timeline>
  );
}
