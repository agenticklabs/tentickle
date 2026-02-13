import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSession, useContextInfo, useChat } from "@agentick/react";
import {
  ToolConfirmationPrompt,
  ErrorDisplay,
  InputBar,
  ToolCallIndicator,
  Spinner,
  useSlashCommands,
  useCommandsConfig,
  helpCommand,
  clearCommand,
  exitCommand,
  loadCommand,
  renderMessage,
} from "@agentick/tui";
import type { TUIComponent } from "@agentick/tui";
import { extractText } from "@agentick/shared";
import type { Message } from "@agentick/shared";
import { Footer } from "./components/Footer.js";
import { printBanner } from "./components/Banner.js";
import { useDoubleCtrlC } from "./hooks/useDoubleCtrlC.js";

export const CodingTUI: TUIComponent = ({ sessionId }) => {
  const { exit } = useApp();
  const { abort } = useSession({ sessionId, autoSubscribe: true });
  const { contextInfo } = useContextInfo({ sessionId });

  const {
    submit,
    queued,
    isExecuting,
    chatMode,
    messages,
    toolConfirmation,
    respondToConfirmation,
    clearMessages,
    lastSubmitted,
  } = useChat({ sessionId, mode: "queue", flushMode: "sequential" });

  const [error, setError] = useState<Error | string | null>(null);
  const [inputValue, setInputValue] = useState("");

  const { handleCtrlC, showExitHint } = useDoubleCtrlC(exit);

  const loggedCount = useRef(0);

  // Print banner to scrollback on mount
  useEffect(() => {
    printBanner();
  }, []);

  // Print new messages to stdout via console.log.
  useEffect(() => {
    if (messages.length <= loggedCount.current) return;

    const newMessages = messages.slice(loggedCount.current);
    for (const msg of newMessages) {
      console.log(
        renderMessage({ role: msg.role, content: msg.content, toolCalls: msg.toolCalls }),
      );
      console.log(); // blank line between messages
    }
    loggedCount.current = messages.length;
  }, [messages]);

  const configCommands = useCommandsConfig();
  const commandCtx = useMemo(
    () => ({ sessionId, send: submit as any, abort, output: console.log }),
    [sessionId, submit, abort],
  );
  const { dispatch } = useSlashCommands(
    [
      ...configCommands,
      helpCommand(),
      clearCommand(() => {
        clearMessages();
        loggedCount.current = 0;
      }),
      exitCommand(exit),
      loadCommand(),
    ],
    commandCtx,
  );

  const handleSubmit = useCallback(
    (text: string) => {
      if (dispatch(text)) return;

      setError(null);
      submit(text);
    },
    [dispatch, submit],
  );

  // Global keybindings
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      handleCtrlC(chatMode === "streaming", () => {
        abort();
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

  return (
    <Box flexDirection="column">
      {/* Optimistic user message — submitted but not yet confirmed in timeline */}
      {lastSubmitted && isExecuting && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor wrap="wrap">
            {lastSubmitted}
          </Text>
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

      {/* Queued messages — submitted during execution, waiting their turn */}
      {queued.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {queued.map((msg: Message, i: number) => (
            <Box key={i} flexDirection="row">
              <Text dimColor wrap="wrap">
                {extractText(msg.content)}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {chatMode === "confirming_tool" && toolConfirmation && (
        <ToolConfirmationPrompt
          request={toolConfirmation.request}
          onRespond={respondToConfirmation}
        />
      )}

      {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}

      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
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
