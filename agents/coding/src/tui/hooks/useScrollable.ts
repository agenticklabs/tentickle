import { useState, useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types.js";

function estimateMessageLines(msg: ChatMessage, width: number): number {
  const contentWidth = Math.max(width - 4, 20); // 2 marginLeft + 2 paddingX
  const labelLine = 1;
  const contentLines = msg.content.split("\n").reduce((total, line) => {
    return total + Math.max(1, Math.ceil((line.length || 1) / contentWidth));
  }, 0);
  const toolLines = msg.toolCalls?.length ?? 0;
  const marginBottom = 1;
  return labelLine + contentLines + toolLines + marginBottom;
}

interface ScrollableResult {
  visibleMessages: ChatMessage[];
  scrollUp: () => void;
  scrollDown: () => void;
  pageUp: () => void;
  pageDown: () => void;
  isAtBottom: boolean;
}

export function useScrollable(
  messages: ChatMessage[],
  viewportHeight: number,
  terminalWidth: number,
): ScrollableResult {
  // scrollOffset = number of lines scrolled UP from bottom. 0 = pinned to bottom.
  const [scrollOffset, setScrollOffset] = useState(0);
  const prevLengthRef = useRef(messages.length);

  // Auto-scroll to bottom when new messages arrive (if already at bottom)
  useEffect(() => {
    if (messages.length > prevLengthRef.current && scrollOffset === 0) {
      // Already at bottom, stay there (offset 0 means bottom)
    } else if (messages.length > prevLengthRef.current && scrollOffset > 0) {
      // New message arrived while scrolled up — keep position but account for new content
      const newMsg = messages[messages.length - 1];
      if (newMsg) {
        setScrollOffset((prev) => prev + estimateMessageLines(newMsg, terminalWidth));
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages.length, scrollOffset, messages, terminalWidth]);

  // Compute total lines
  const totalLines = messages.reduce(
    (sum, msg) => sum + estimateMessageLines(msg, terminalWidth),
    0,
  );
  const maxOffset = Math.max(0, totalLines - viewportHeight);

  // Clamp offset if messages are removed (e.g., clear)
  useEffect(() => {
    if (scrollOffset > maxOffset) {
      setScrollOffset(maxOffset);
    }
  }, [scrollOffset, maxOffset]);

  // Compute visible messages by working backwards from the bottom
  const visibleMessages: ChatMessage[] = [];
  if (viewportHeight > 0 && messages.length > 0) {
    let linesFromBottom = 0;
    let skipLines = scrollOffset;

    // Walk from bottom, skip scrollOffset lines, then fill viewport
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgLines = estimateMessageLines(messages[i]!, terminalWidth);

      if (skipLines > 0) {
        if (skipLines >= msgLines) {
          skipLines -= msgLines;
          continue;
        }
        // Partial skip — still include this message
        skipLines = 0;
      }

      if (linesFromBottom + msgLines <= viewportHeight) {
        visibleMessages.unshift(messages[i]!);
        linesFromBottom += msgLines;
      } else if (linesFromBottom < viewportHeight) {
        // Partially fits — include it (will be clipped by overflow:hidden)
        visibleMessages.unshift(messages[i]!);
        break;
      } else {
        break;
      }
    }
  }

  const scrollUp = useCallback(() => {
    setScrollOffset((prev) => Math.min(prev + 3, maxOffset));
  }, [maxOffset]);

  const scrollDown = useCallback(() => {
    setScrollOffset((prev) => Math.max(prev - 3, 0));
  }, []);

  const pageUp = useCallback(() => {
    setScrollOffset((prev) => Math.min(prev + viewportHeight, maxOffset));
  }, [viewportHeight, maxOffset]);

  const pageDown = useCallback(() => {
    setScrollOffset((prev) => Math.max(prev - viewportHeight, 0));
  }, [viewportHeight]);

  return {
    visibleMessages,
    scrollUp,
    scrollDown,
    pageUp,
    pageDown,
    isAtBottom: scrollOffset === 0,
  };
}
