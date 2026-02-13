import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSession, useEvents, useContextInfo } from "@agentick/react";
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
import type { ChatMode } from "./types.js";
import { Footer } from "./components/Footer.js";
import { printBanner } from "./components/Banner.js";
import { useMessageHistory } from "./hooks/useMessageHistory.js";
import { useDoubleCtrlC } from "./hooks/useDoubleCtrlC.js";

const EXEC_EVENT_FILTER: Array<"execution_start" | "execution_end"> = [
  "execution_start",
  "execution_end",
];

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

  const {
    messages,
    pending,
    queued,
    addUserMessage,
    clear: clearMessages,
  } = useMessageHistory(sessionId);

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
      console.log(
        renderMessage({ role: msg.role, content: msg.content, toolCalls: msg.toolCalls }),
      );
      console.log(); // blank line between messages
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

  const configCommands = useCommandsConfig();
  const commandCtx = useMemo(
    () => ({ sessionId, send, abort, output: console.log }),
    [sessionId, send, abort],
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
    [dispatch, send, addUserMessage],
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

  // const isInputActive = chatMode === "idle";

  return (
    <Box flexDirection="column">
      {/* Pending user message (optimistic, before server confirms) */}
      {pending && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor wrap="wrap">
            {extractText(pending.content)}
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
          {queued.map((msg) => (
            <Box key={msg.id} flexDirection="row">
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
          onRespond={handleToolConfirmationResponse}
        />
      )}

      {error && <ErrorDisplay error={error} onDismiss={() => setError(null)} />}

      {/* TODO: Enable input during execution for steering messages (session.queue).
          Long-running executions need user communication — inject messages mid-run. */}
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
