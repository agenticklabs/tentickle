import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSession, useChat } from "@agentick/react";
import {
  ToolConfirmationPrompt,
  ErrorDisplay,
  InputBar,
  CompletionPicker,
  ToolCallIndicator,
  Spinner,
  useSlashCommands,
  useCommandsConfig,
  helpCommand,
  clearCommand,
  exitCommand,
  loadCommand,
  createCommandCompletionSource,
  renderMessage,
  useLineEditor,
  useDoubleCtrlC,
  handleConfirmationKey,
} from "@agentick/tui";
import type { TUIComponent } from "@agentick/tui";
import type { ConfirmationPolicy } from "@agentick/client";
import { extractText } from "@agentick/shared";
import type { Message } from "@agentick/shared";
import { Footer } from "./components/Footer.js";
import { printBanner } from "./components/Banner.js";
import { AttachmentStrip } from "./components/AttachmentStrip.js";
import { TaskList } from "./components/TaskList.js";
import { attachCommand } from "./commands/attach.js";
import { addDirCommand } from "./commands/add-dir.js";
import { createFileCompletionSource, createDirCompletionSource } from "./file-completion.js";
import { getMemoryDir } from "../memory-path.js";

const confirmationPolicy: ConfirmationPolicy = (req) => {
  if (req.name === "write_file" || req.name === "edit_file") {
    const path = req.arguments.path as string | undefined;
    if (path && path.startsWith(getMemoryDir(process.cwd()))) {
      return { action: "approve" };
    }
  }
  return { action: "prompt" };
};

export const CodingTUI: TUIComponent = ({ sessionId }) => {
  const { exit } = useApp();
  const { abort } = useSession({ sessionId, autoSubscribe: true });

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
    error: executionError,
    attachments,
    addAttachment,
    removeAttachment,
  } = useChat({ sessionId, mode: "queue", flushMode: "sequential", confirmationPolicy });

  const { handleCtrlC, showExitHint } = useDoubleCtrlC(exit);

  const loggedCount = useRef(0);
  const [attachmentFocus, setAttachmentFocus] = useState<number | null>(null);

  // Auto-clear focus when attachments change (e.g. last one removed)
  useEffect(() => {
    if (attachments.length === 0) {
      setAttachmentFocus(null);
    } else if (attachmentFocus !== null && attachmentFocus >= attachments.length) {
      setAttachmentFocus(attachments.length - 1);
    }
  }, [attachments.length, attachmentFocus]);

  // Print banner to scrollback on mount
  useEffect(() => {
    printBanner();
  }, []);

  // Print new messages to stdout via console.log.
  useEffect(() => {
    if (messages.length <= loggedCount.current) return;

    const newMessages = messages.slice(loggedCount.current);
    for (const msg of newMessages) {
      // Show attachment tags above user text
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const mediaNames = msg.content
          .filter((b) => b.type === "image" || b.type === "document")
          .map((b) => `[${b.type === "document" && "title" in b ? b.title : "image"}]`);
        if (mediaNames.length > 0) {
          console.log(`  ${mediaNames.join(" ")}`);
        }
      }

      console.log(
        renderMessage({ role: msg.role, content: msg.content, toolCalls: msg.toolCalls }),
      );
      console.log(); // blank line between messages
    }
    loggedCount.current = messages.length;
  }, [messages]);

  const configCommands = useCommandsConfig();
  const commandCtx = useMemo(
    () => ({ sessionId, send: (text: string) => submit(text), abort, output: console.log }),
    [sessionId, submit, abort],
  );
  const { dispatch, commands } = useSlashCommands(
    [
      ...configCommands,
      helpCommand(),
      clearCommand(() => {
        clearMessages();
        loggedCount.current = 0;
      }),
      exitCommand(exit),
      loadCommand(),
      attachCommand(addAttachment),
      addDirCommand(),
    ],
    commandCtx,
  );

  const handleSubmit = useCallback(
    (text: string) => {
      if (dispatch(text)) return;
      submit(text);
    },
    [dispatch, submit],
  );

  const editor = useLineEditor({ onSubmit: handleSubmit });

  // Register completion sources: slash commands, file paths, dir paths
  useEffect(() => {
    return editor.editor.registerCompletion(createCommandCompletionSource(commands));
  }, [editor.editor, commands]);

  useEffect(() => {
    return editor.editor.registerCompletion(createFileCompletionSource());
  }, [editor.editor]);

  useEffect(() => {
    return editor.editor.registerCompletion(createDirCompletionSource());
  }, [editor.editor]);

  // Single centralized input handler — all keystrokes route through here
  useInput((input, key) => {
    // Esc → abort execution
    if (key.escape && isExecuting) {
      abort();
      return;
    }

    // Ctrl+C → double-press to exit; also aborts if executing
    if (key.ctrl && input === "c") {
      if (isExecuting) abort();
      // isStreaming=false: onAbort is never called, double-press logic only
      handleCtrlC(false, abort);
      return;
    }

    // Ctrl+L → clear screen
    if (key.ctrl && input === "l") {
      clearMessages();
      loggedCount.current = 0;
      editor.clear();
      return;
    }

    // Tool confirmation → Y/N/A
    if (chatMode === "confirming_tool" && toolConfirmation) {
      handleConfirmationKey(input, respondToConfirmation);
      return;
    }

    // Idle mode input routing
    if (chatMode === "idle") {
      // Attachment focus mode
      if (attachmentFocus !== null) {
        if (key.leftArrow) {
          setAttachmentFocus(Math.max(0, attachmentFocus - 1));
          return;
        }
        if (key.rightArrow) {
          setAttachmentFocus(Math.min(attachments.length - 1, attachmentFocus + 1));
          return;
        }
        if (key.backspace || key.delete) {
          removeAttachment(attachments[attachmentFocus].id);
          return;
        }
        if (key.downArrow || key.escape) {
          setAttachmentFocus(null);
          return;
        }
        // Printable char → exit focus, route to editor
        if (!key.ctrl && !key.meta && input && !key.return) {
          setAttachmentFocus(null);
          editor.handleInput(input, key);
          return;
        }
        return;
      }

      // ↑ with empty input and attachments → enter attachment focus
      if (key.upArrow && editor.value === "" && attachments.length > 0) {
        setAttachmentFocus(attachments.length - 1);
        return;
      }

      editor.handleInput(input, key);
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
        <ToolConfirmationPrompt request={toolConfirmation.request} />
      )}

      {executionError && <ErrorDisplay error={executionError.message} />}

      {editor.completion && <CompletionPicker completion={editor.completion} />}

      <TaskList />

      <AttachmentStrip attachments={attachments} focusIndex={attachmentFocus} />

      <InputBar
        value={editor.value}
        cursor={editor.cursor}
        isActive={chatMode === "idle"}
        placeholder={
          chatMode === "streaming"
            ? "Thinking..."
            : chatMode === "confirming_tool"
              ? "Confirm tool above..."
              : "Describe what you need..."
        }
      />

      <Footer chatMode={chatMode} sessionId={sessionId} showExitHint={showExitHint} />
    </Box>
  );
};
