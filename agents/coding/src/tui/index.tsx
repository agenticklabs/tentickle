import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useSession, useChat } from "@agentick/react";
import { timelineToMessages } from "@agentick/client";
import { fileURLToPath } from "node:url";
import { dirname, basename } from "node:path";
import fs from "node:fs";
import { getProjectDir, getSessionStore } from "@tentickle/agent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getProjectInfo() {
  const projectRoot = process.cwd();
  const projectName = basename(projectRoot);
  let projectAuthor = "Unknown";

  try {
    const packageJsonPath = `${projectRoot}/package.json`;
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (packageJson.author) {
        projectAuthor =
          typeof packageJson.author === "string"
            ? packageJson.author
            : packageJson.author.name || "Unknown";
      }
    }
  } catch (e) {
    console.error("Error reading package.json:", e);
  }

  return { projectName, projectAuthor };
}

import {
  ToolConfirmationPrompt,
  ErrorDisplay,
  InputBar,
  CompletionPicker,
  ToolCallIndicator,
  SpawnIndicator,
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
import {
  createFileCompletionSource,
  createDirCompletionSource,
  createMentionCompletionSource,
} from "./file-completion.js";
import { ContextStrip } from "./components/ContextStrip.js";

const confirmationPolicy: ConfirmationPolicy = (req) => {
  if (req.name === "write_file" || req.name === "edit_file") {
    const path = req.arguments.path as string | undefined;
    if (path && path.startsWith(getProjectDir(process.cwd()))) {
      return { action: "approve" };
    }
  }
  return { action: "prompt" };
};

export const CodingTUI: TUIComponent = ({ sessionId }) => {
  const { exit } = useApp();
  const { abort, accessor } = useSession({ sessionId, autoSubscribe: true });

  const initialMessages = useMemo(() => {
    const store = getSessionStore();
    if (!store) return undefined;
    const snapshot = store.loadSync(sessionId);
    if (!snapshot?.timeline) return undefined;
    return timelineToMessages(snapshot.timeline, new Map());
  }, [sessionId]);

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
  } = useChat({
    sessionId,
    mode: "queue",
    flushMode: "sequential",
    confirmationPolicy,
    initialMessages,
  });

  const { handleCtrlC, showExitHint } = useDoubleCtrlC(exit);

  const loggedCount = useRef(initialMessages?.length ?? 0);
  const [attachmentFocus, setAttachmentFocus] = useState<number | null>(null);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [contextFocus, setContextFocus] = useState<number | null>(null);

  // Auto-clear focus when attachments/context change (e.g. last one removed)
  useEffect(() => {
    if (attachments.length === 0) {
      setAttachmentFocus(null);
    } else if (attachmentFocus !== null && attachmentFocus >= attachments.length) {
      setAttachmentFocus(attachments.length - 1);
    }
  }, [attachments.length, attachmentFocus]);

  useEffect(() => {
    if (contextFiles.length === 0) {
      setContextFocus(null);
    } else if (contextFocus !== null && contextFocus >= contextFiles.length) {
      setContextFocus(contextFiles.length - 1);
    }
  }, [contextFiles.length, contextFocus]);

  // Print banner to scrollback on mount
  useEffect(() => {
    const { projectName, projectAuthor } = getProjectInfo();
    printBanner(projectName, projectAuthor);
  }, []);

  // Print restored history on mount
  useEffect(() => {
    if (!initialMessages?.length) return;
    for (const msg of initialMessages) {
      console.log(
        renderMessage({ role: msg.role, content: msg.content, toolCalls: msg.toolCalls }),
      );
      console.log();
    }
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
      {
        name: "add-dir",
        description: "Mount a directory into the sandbox",
        aliases: ["mount"],
        args: "<path>",
        handler: async (args: string, ctx: { output: (text: string) => void }) => {
          const input = args.trim();
          if (!input) {
            ctx.output("Usage: /add-dir <path>");
            return;
          }
          if (!accessor) {
            ctx.output("Session not ready.");
            return;
          }
          try {
            const result = await accessor.dispatch("add-dir", { path: input });
            ctx.output(extractText(result));
          } catch (err: any) {
            ctx.output(`Failed: ${err.message}`);
          }
        },
      },
    ],
    commandCtx,
  );

  const addContextFile = useCallback((filePath: string) => {
    setContextFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
  }, []);

  const removeContextFile = useCallback((filePath: string) => {
    setContextFiles((prev) => prev.filter((f) => f !== filePath));
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      // Text submitted during tool confirmation → reject with feedback
      if (chatMode === "confirming_tool" && toolConfirmation) {
        if (!text.trim()) return;
        respondToConfirmation({ approved: false, reason: text });
        return;
      }
      if (dispatch(text)) return;

      // Extract @mentions from text → add to context, strip from message
      const mentionRe = /(?:^|\s)@(\S+)/g;
      let match;
      const mentioned: string[] = [];
      while ((match = mentionRe.exec(text)) !== null) {
        mentioned.push(match[1]!);
      }
      const cleanText = text.replace(/(?:^|\s)@\S+/g, "").trim();

      // Collect all context file paths (persistent + inline mentions)
      const allContext = [...new Set([...contextFiles, ...mentioned])];

      // Add inline mentions to persistent context
      for (const m of mentioned) addContextFile(m);

      // Prepend context references so the model knows to read them
      const prefix =
        allContext.length > 0
          ? `[Context files: ${allContext.map((f) => `@${f}`).join(", ")}]\n\n`
          : "";
      submit(prefix + (cleanText || text));
    },
    [
      chatMode,
      toolConfirmation,
      respondToConfirmation,
      dispatch,
      submit,
      contextFiles,
      addContextFile,
    ],
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

  useEffect(() => {
    return editor.editor.registerCompletion(createMentionCompletionSource());
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

    // Tool confirmation → Y/N/A shortcuts when editor empty, else text input
    if (chatMode === "confirming_tool" && toolConfirmation) {
      if (editor.value.length === 0 && handleConfirmationKey(input, respondToConfirmation)) {
        return;
      }
      editor.handleInput(input, key);
      return;
    }

    // Idle mode input routing
    if (chatMode === "idle") {
      // Context file focus mode
      if (contextFocus !== null) {
        if (key.leftArrow) {
          setContextFocus(Math.max(0, contextFocus - 1));
          return;
        }
        if (key.rightArrow) {
          setContextFocus(Math.min(contextFiles.length - 1, contextFocus + 1));
          return;
        }
        if (key.backspace || key.delete) {
          removeContextFile(contextFiles[contextFocus]!);
          return;
        }
        if (key.downArrow || key.escape) {
          setContextFocus(null);
          return;
        }
        if (!key.ctrl && !key.meta && input && !key.return) {
          setContextFocus(null);
          editor.handleInput(input, key);
          return;
        }
        return;
      }

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
        if (!key.ctrl && !key.meta && input && !key.return) {
          setAttachmentFocus(null);
          editor.handleInput(input, key);
          return;
        }
        return;
      }

      // ↑ with empty input → enter strip focus (context first, then attachments)
      if (key.upArrow && editor.value === "") {
        if (contextFiles.length > 0) {
          setContextFocus(contextFiles.length - 1);
          return;
        }
        if (attachments.length > 0) {
          setAttachmentFocus(attachments.length - 1);
          return;
        }
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
          <SpawnIndicator sessionId={sessionId} />
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

      <ContextStrip files={contextFiles} focusIndex={contextFocus} />
      <AttachmentStrip attachments={attachments} focusIndex={attachmentFocus} />

      <InputBar
        value={editor.value}
        cursor={editor.cursor}
        isActive={true}
        placeholder={
          chatMode === "streaming"
            ? "Thinking..."
            : chatMode === "confirming_tool"
              ? "Type feedback to reject, or press Y/N/A..."
              : "Describe what you need..."
        }
      />

      <Footer chatMode={chatMode} sessionId={sessionId} showExitHint={showExitHint} />
    </Box>
  );
};
