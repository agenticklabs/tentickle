import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSession, useStreamingText, useContextInfo } from "@agentick/react";
import { ToolConfirmationPrompt, ErrorDisplay } from "@agentick/tui";
import type { TUIComponent } from "@agentick/tui";
import type { ChatMode, UIMode } from "./types.js";
import { Header } from "./components/Header.js";
import { Footer } from "./components/Footer.js";
import { MessageArea } from "./components/MessageArea.js";
import { StreamingZone } from "./components/StreamingZone.js";
import { CodingInputBar } from "./components/CodingInputBar.js";
import { useMessageHistory } from "./hooks/useMessageHistory.js";
import { useDoubleCtrlC } from "./hooks/useDoubleCtrlC.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useScrollable } from "./hooks/useScrollable.js";

// Chrome = header (3) + input (3) + footer (3)
const CHROME_HEIGHT = 9;

interface ToolConfirmationState {
  request: {
    toolUseId: string;
    name: string;
    arguments: Record<string, unknown>;
    message?: string;
  };
  respond: (response: { approved: boolean; reason?: string }) => void;
}

export const CodingTUI: TUIComponent = ({ sessionId }) => {
  const { exit } = useApp();
  const { send, abort, accessor } = useSession({ sessionId, autoSubscribe: true });
  const { isStreaming } = useStreamingText();
  const { contextInfo } = useContextInfo({ sessionId });
  const { width: termWidth, height: termHeight } = useTerminalSize();

  const [chatMode, setChatMode] = useState<ChatMode>("idle");
  const [uiMode, setUiMode] = useState<UIMode>("input");
  const [error, setError] = useState<Error | string | null>(null);
  const [toolConfirmation, setToolConfirmation] = useState<ToolConfirmationState | null>(null);
  const [inputValue, setInputValue] = useState("");

  const { messages, addUserMessage, clear: clearMessages } = useMessageHistory(sessionId);

  const contentHeight = Math.max(3, termHeight - CHROME_HEIGHT);
  const { visibleMessages, scrollUp, scrollDown, pageUp, pageDown, isAtBottom } = useScrollable(
    messages,
    contentHeight,
    termWidth,
  );

  const { handleCtrlC, showExitHint } = useDoubleCtrlC(exit);

  // Auto-exit scroll mode when scrolled back to bottom
  useEffect(() => {
    if (uiMode === "scroll" && isAtBottom) {
      setUiMode("input");
    }
  }, [uiMode, isAtBottom]);

  // Sync streaming state -> chatMode
  useEffect(() => {
    if (isStreaming && chatMode === "idle") {
      setChatMode("streaming");
      setError(null);
    } else if (!isStreaming && chatMode === "streaming") {
      setChatMode("idle");
    }
  }, [isStreaming, chatMode]);

  // Register tool confirmation handler
  useEffect(() => {
    if (!accessor) return;
    return accessor.onToolConfirmation(
      (request: ToolConfirmationState["request"], respond: ToolConfirmationState["respond"]) => {
        setToolConfirmation({ request, respond });
        setChatMode("confirming_tool");
      },
    );
  }, [accessor]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }
      if (text === "/clear") {
        clearMessages();
        return;
      }

      setError(null);
      addUserMessage(text);

      try {
        send({
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text }],
            },
          ],
        });
      } catch (err) {
        setError(err instanceof Error ? err : String(err));
      }
    },
    [send, exit, addUserMessage, clearMessages],
  );

  const handleToolConfirmationResponse = useCallback(
    (response: { approved: boolean; reason?: string }) => {
      if (toolConfirmation) {
        toolConfirmation.respond(response);
        setToolConfirmation(null);
        setChatMode("streaming");
      }
    },
    [toolConfirmation],
  );

  // During streaming at bottom: show all messages, let flex-end + overflow clip old ones.
  // During streaming scrolled up: show windowed messages (user is reviewing history).
  // During idle: always use windowed messages from useScrollable.
  const showStreaming = chatMode === "streaming" && isAtBottom;
  const messagesToShow =
    chatMode === "streaming" && isAtBottom
      ? messages.slice(-10) // During streaming, show last ~10 messages + streaming zone
      : visibleMessages;

  // Global keybindings
  useInput((input, key) => {
    // Ctrl+C: double-tap exit or abort
    if (key.ctrl && input === "c") {
      handleCtrlC(chatMode === "streaming", () => {
        abort();
        setChatMode("idle");
      });
      return;
    }

    // Ctrl+L: clear history + reset input (runs after TextInput's handler in same batch)
    if (key.ctrl && input === "l") {
      clearMessages();
      setInputValue("");
      return;
    }

    // Ctrl+U / Ctrl+D: vi-style half-page scroll (also enters scroll mode)
    if (key.ctrl && input === "u") {
      if (uiMode === "input") setUiMode("scroll");
      setInputValue("");
      pageUp();
      return;
    }
    if (key.ctrl && input === "d") {
      setInputValue("");
      pageDown();
      if (isAtBottom) setUiMode("input");
      return;
    }

    // Scroll mode navigation
    if (uiMode === "scroll") {
      if (key.upArrow) {
        scrollUp();
        return;
      }
      if (key.downArrow) {
        scrollDown();
        return;
      }
      if (key.escape) {
        setUiMode("input");
        return;
      }
    }

    // PageUp/PageDown: also works if terminal passes them through
    if (key.pageUp) {
      if (uiMode === "input") setUiMode("scroll");
      pageUp();
      return;
    }
    if (key.pageDown) {
      pageDown();
      if (isAtBottom) setUiMode("input");
      return;
    }
  });

  const isInputActive = uiMode === "input" && chatMode === "idle";

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header chatMode={chatMode} contextInfo={contextInfo} />

      {/* Single content area: messages + streaming, height-constrained */}
      <Box
        flexDirection="column"
        height={contentHeight}
        overflow="hidden"
        justifyContent="flex-end"
        paddingX={1}
      >
        {messagesToShow.length === 0 && chatMode === "idle" ? (
          <Text color="gray">No messages yet. Type below to start.</Text>
        ) : (
          <MessageArea messages={messagesToShow} />
        )}

        {showStreaming && <StreamingZone isActive sessionId={sessionId} />}

        {!isAtBottom && chatMode === "idle" && (
          <Box justifyContent="center">
            <Text color="gray" dimColor>
              --- scrolled up (PgUp/PgDn to navigate, Esc to return) ---
            </Text>
          </Box>
        )}

        {!isAtBottom && chatMode === "streaming" && (
          <Box justifyContent="center">
            <Text color="yellow" dimColor>
              --- streaming below (PgDn to return) ---
            </Text>
          </Box>
        )}
      </Box>

      {chatMode === "confirming_tool" && toolConfirmation && (
        <ToolConfirmationPrompt
          request={toolConfirmation.request}
          onRespond={handleToolConfirmationResponse}
        />
      )}

      {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}

      <CodingInputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        isDisabled={!isInputActive}
        placeholder={
          chatMode === "streaming"
            ? "Streaming..."
            : chatMode === "confirming_tool"
              ? "Confirm tool above..."
              : uiMode === "scroll"
                ? "Scroll mode (Esc to return)"
                : "Describe what you need..."
        }
      />

      <Footer chatMode={chatMode} uiMode={uiMode} showExitHint={showExitHint} />
    </Box>
  );
};
