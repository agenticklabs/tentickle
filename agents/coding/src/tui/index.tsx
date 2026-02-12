import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSession, useEvents, useContextInfo } from "@agentick/react";
import {
  ToolConfirmationPrompt,
  ErrorDisplay,
  InputBar,
  ToolCallIndicator,
  Spinner,
} from "@agentick/tui";
import type { TUIComponent } from "@agentick/tui";
import type { ChatMode, ChatMessage } from "./types.js";
import { Footer } from "./components/Footer.js";
import { printBanner } from "./components/Banner.js";
import { useMessageHistory } from "./hooks/useMessageHistory.js";
import { useDoubleCtrlC } from "./hooks/useDoubleCtrlC.js";

// ANSI helpers for console.log output
const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const EXEC_EVENT_FILTER: Array<"execution_start" | "execution_end"> = [
  "execution_start",
  "execution_end",
];

function printMessage(msg: ChatMessage): void {
  const color = msg.role === "user" ? ansi.blue : ansi.magenta;
  const label = msg.role === "user" ? "you" : "assistant";
  console.log(`${color}${ansi.bold}${label}${ansi.reset}`);
  console.log(`  ${msg.content}`);

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      const dur =
        tc.duration != null
          ? ` (${tc.duration < 1000 ? `${tc.duration}ms` : `${(tc.duration / 1000).toFixed(1)}s`})`
          : "";
      console.log(`  ${ansi.dim}+ ${tc.name}${dur}${ansi.reset}`);
    }
  }
  console.log(); // blank line between messages
}

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
  const { event: execEvent } = useEvents({
    sessionId,
    filter: EXEC_EVENT_FILTER,
  });
  const { contextInfo } = useContextInfo({ sessionId });

  const [chatMode, setChatMode] = useState<ChatMode>("idle");
  const [error, setError] = useState<Error | string | null>(null);
  const [toolConfirmation, setToolConfirmation] = useState<ToolConfirmationState | null>(null);
  const [inputValue, setInputValue] = useState("");

  const { messages, pending, addUserMessage, clear: clearMessages } = useMessageHistory(sessionId);

  const { handleCtrlC, showExitHint } = useDoubleCtrlC(exit);

  const loggedCount = useRef(0);

  // Print banner to scrollback on mount
  useEffect(() => {
    printBanner();
  }, []);

  // Print new messages to stdout via console.log.
  // Ink intercepts console.log and renders it above the dynamic area.
  useEffect(() => {
    if (messages.length <= loggedCount.current) return;

    const newMessages = messages.slice(loggedCount.current);
    for (const msg of newMessages) {
      printMessage(msg);
    }
    loggedCount.current = messages.length;
  }, [messages]);

  // Sync execution events -> chatMode
  useEffect(() => {
    if (!execEvent) return;
    if (execEvent.type === "execution_start" && chatMode === "idle") {
      setChatMode("streaming");
      setError(null);
    } else if (execEvent.type === "execution_end" && chatMode === "streaming") {
      setChatMode("idle");
    }
  }, [execEvent, chatMode]);

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
        loggedCount.current = 0;
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

  // Global keybindings
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      handleCtrlC(chatMode === "streaming", () => {
        abort();
        setChatMode("idle");
      });
      return;
    }

    if (key.ctrl && input === "l") {
      clearMessages();
      loggedCount.current = 0;
      setInputValue("");
      return;
    }
  });

  const isInputActive = chatMode === "idle";

  return (
    <Box flexDirection="column">
      {/* Pending user message (optimistic, before server confirms) */}
      {pending && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="blue" bold>
            you
          </Text>
          <Box marginLeft={2}>
            <Text wrap="wrap">{pending.content}</Text>
          </Box>
        </Box>
      )}

      {chatMode === "streaming" && (
        <Box marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text color="yellow">Thinking...</Text>
          </Box>
          <ToolCallIndicator sessionId={sessionId} />
        </Box>
      )}

      {chatMode === "confirming_tool" && toolConfirmation && (
        <ToolConfirmationPrompt
          request={toolConfirmation.request}
          onRespond={handleToolConfirmationResponse}
        />
      )}

      {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}

      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        isDisabled={!isInputActive}
        placeholder={
          chatMode === "streaming"
            ? "Thinking..."
            : chatMode === "confirming_tool"
              ? "Confirm tool above..."
              : "Describe what you need..."
        }
      />

      <Footer chatMode={chatMode} contextInfo={contextInfo} showExitHint={showExitHint} />
    </Box>
  );
};
