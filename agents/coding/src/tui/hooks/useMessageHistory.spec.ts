/**
 * Tests for useMessageHistory's data transformation logic.
 *
 * The hook processes execution_end events from agentick sessions.
 * These tests verify the pure data transformation (timelineToMessages)
 * works with the ACTUAL event shapes emitted by the session, and that
 * the hook correctly accumulates `messages` (append-only for Static)
 * from both the delta path (newTimelineEntries) and the fallback path
 * (output.timeline).
 */

import { describe, it, expect } from "vitest";
import type { ContentBlock, Message } from "@agentick/shared";

// ============================================================================
// Re-implement the pure functions from useMessageHistory for direct testing.
// These are currently private — if we refactor them out, we can import directly.
// For now, mirror the exact logic so tests catch any drift.
// ============================================================================

type TimelineEntry = { kind?: string; message?: Message };

interface ToolCallEntry {
  id: string;
  name: string;
  status: "running" | "done";
  duration?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEntry[];
}

function extractText(content: ContentBlock[] | string): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is ContentBlock & { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function extractToolCalls(content: ContentBlock[]): ToolCallEntry[] {
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

function timelineToMessages(
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
      const content = Array.isArray(msg.content) ? msg.content : [];
      const toolCalls = msg.role === "assistant" ? extractToolCalls(content) : undefined;

      const toolCallsWithDurations = toolCalls?.map((tc) => ({
        ...tc,
        duration: toolDurations.get(tc.id),
      }));

      return {
        id: msg.id ?? `msg-${i}`,
        role: msg.role as "user" | "assistant",
        content: extractText(msg.content),
        toolCalls:
          toolCallsWithDurations && toolCallsWithDurations.length > 0
            ? toolCallsWithDurations
            : undefined,
      };
    });
}

// ============================================================================
// Fixtures: realistic event data matching agentick's actual emission shapes
// ============================================================================

/** COMTimelineEntry shape — what session._timeline actually contains */
function makeTimelineEntry(overrides: {
  role: "user" | "assistant" | "tool" | "event";
  content: ContentBlock[];
  id?: string;
  visibility?: "model" | "observer" | "log";
}): TimelineEntry {
  return {
    kind: "message",
    message: {
      id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
      role: overrides.role,
      content: overrides.content,
    },
  };
}

function textBlock(text: string): ContentBlock {
  return { type: "text", text } as ContentBlock;
}

function toolUseBlock(id: string, name: string, input: Record<string, unknown> = {}): ContentBlock {
  return { type: "tool_use", id, name, input } as ContentBlock;
}

function toolResultBlock(toolUseId: string, content: string): ContentBlock {
  return {
    type: "tool_result",
    toolUseId,
    name: "test_tool",
    content: [{ type: "text", text: content }],
    isError: false,
  } as unknown as ContentBlock;
}

// ============================================================================
// Tests: extractText
// ============================================================================

describe("extractText", () => {
  it("extracts text from a single text block", () => {
    expect(extractText([textBlock("Hello world")])).toBe("Hello world");
  });

  it("concatenates multiple text blocks", () => {
    expect(extractText([textBlock("Hello "), textBlock("world")])).toBe("Hello world");
  });

  it("ignores non-text blocks", () => {
    const blocks = [
      textBlock("Before"),
      toolUseBlock("tc-1", "search", { q: "test" }),
      textBlock(" After"),
    ];
    expect(extractText(blocks)).toBe("Before After");
  });

  it("handles string content (legacy path)", () => {
    expect(extractText("plain string")).toBe("plain string");
  });

  it("returns empty string for empty array", () => {
    expect(extractText([])).toBe("");
  });
});

// ============================================================================
// Tests: extractToolCalls
// ============================================================================

describe("extractToolCalls", () => {
  it("extracts tool_use blocks from content", () => {
    const blocks = [textBlock("Let me search"), toolUseBlock("tc-1", "search", { q: "test" })];
    expect(extractToolCalls(blocks)).toEqual([{ id: "tc-1", name: "search", status: "done" }]);
  });

  it("extracts multiple tool calls", () => {
    const blocks = [
      toolUseBlock("tc-1", "read_file", { path: "/a.ts" }),
      toolUseBlock("tc-2", "write_file", { path: "/b.ts", content: "x" }),
    ];
    expect(extractToolCalls(blocks)).toEqual([
      { id: "tc-1", name: "read_file", status: "done" },
      { id: "tc-2", name: "write_file", status: "done" },
    ]);
  });

  it("returns empty array when no tool_use blocks", () => {
    expect(extractToolCalls([textBlock("no tools")])).toEqual([]);
  });

  it("ignores tool_result blocks", () => {
    const blocks = [toolResultBlock("tc-1", "file contents"), textBlock("Here's the file")];
    expect(extractToolCalls(blocks)).toEqual([]);
  });
});

// ============================================================================
// Tests: timelineToMessages
// ============================================================================

describe("timelineToMessages", () => {
  const emptyDurations = new Map<string, number>();

  it("converts a simple user + assistant exchange", () => {
    const entries = [
      makeTimelineEntry({ role: "user", content: [textBlock("Hello")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hi there!")], id: "a1" }),
    ];

    const result = timelineToMessages(entries, emptyDurations);

    expect(result).toEqual([
      { id: "u1", role: "user", content: "Hello", toolCalls: undefined },
      { id: "a1", role: "assistant", content: "Hi there!", toolCalls: undefined },
    ]);
  });

  it("filters out tool messages", () => {
    const entries = [
      makeTimelineEntry({ role: "user", content: [textBlock("Search for foo")] }),
      makeTimelineEntry({
        role: "assistant",
        content: [textBlock("Searching..."), toolUseBlock("tc-1", "search")],
      }),
      makeTimelineEntry({ role: "tool", content: [toolResultBlock("tc-1", "found: bar")] }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Found bar!")] }),
    ];

    const result = timelineToMessages(entries, emptyDurations);

    expect(result).toHaveLength(3); // user, assistant (with tool call), assistant (result)
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[1].toolCalls).toEqual([{ id: "tc-1", name: "search", status: "done" }]);
    expect(result[2].role).toBe("assistant");
    expect(result[2].content).toBe("Found bar!");
  });

  it("filters out event messages", () => {
    const entries = [
      makeTimelineEntry({ role: "event", content: [textBlock("system event")] }),
      makeTimelineEntry({ role: "user", content: [textBlock("Hello")] }),
    ];

    const result = timelineToMessages(entries, emptyDurations);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("attaches tool durations when available", () => {
    const durations = new Map([["tc-1", 1500]]);
    const entries = [
      makeTimelineEntry({
        role: "assistant",
        content: [textBlock("Let me check"), toolUseBlock("tc-1", "glob")],
        id: "a1",
      }),
    ];

    const result = timelineToMessages(entries, durations);

    expect(result[0].toolCalls).toEqual([
      { id: "tc-1", name: "glob", status: "done", duration: 1500 },
    ]);
  });

  it("handles entries without kind field", () => {
    // Entries without kind should be filtered out
    const entries: TimelineEntry[] = [
      { message: { role: "user", content: [textBlock("hello")] } as Message },
    ];

    const result = timelineToMessages(entries, emptyDurations);
    expect(result).toHaveLength(0);
  });

  it("handles entries without message field", () => {
    const entries: TimelineEntry[] = [{ kind: "message" }];

    const result = timelineToMessages(entries, emptyDurations);
    expect(result).toHaveLength(0);
  });

  it("generates synthetic IDs when message.id is missing", () => {
    const entries = [makeTimelineEntry({ role: "user", content: [textBlock("test")] })];
    // Override to remove id
    (entries[0].message as any).id = undefined;

    const result = timelineToMessages(entries, emptyDurations);
    expect(result[0].id).toBe("msg-0");
  });

  it("returns empty array for empty input", () => {
    expect(timelineToMessages([], emptyDurations)).toEqual([]);
  });
});

// ============================================================================
// Tests: execution_end event shapes
// These verify the hook's assumptions about the event structure match reality.
// ============================================================================

describe("execution_end event shape compatibility", () => {
  /**
   * Simulates what session.ts emits:
   *   this.emitEvent({
   *     type: "execution_end",
   *     executionId,
   *     output: await this.complete(),  // COMInput with .timeline
   *     newTimelineEntries: this._timeline.slice(startIndex),
   *   })
   */
  function makeExecutionEndEvent(options: {
    newTimelineEntries?: TimelineEntry[];
    outputTimeline?: TimelineEntry[];
  }) {
    return {
      type: "execution_end" as const,
      id: "evt-1",
      sequence: 1,
      tick: 1,
      timestamp: new Date().toISOString(),
      executionId: "exec-1",
      sessionId: "main",
      stopReason: "end_turn",
      aborted: false,
      output: options.outputTimeline ? { timeline: options.outputTimeline } : null,
      newTimelineEntries: options.newTimelineEntries,
    };
  }

  it("delta path: extracts messages from newTimelineEntries", () => {
    const entries = [
      makeTimelineEntry({ role: "user", content: [textBlock("Hi")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hello!")], id: "a1" }),
    ];

    const event = makeExecutionEndEvent({ newTimelineEntries: entries });

    // Simulate what useMessageHistory does
    const execEnd = event as typeof event & {
      newTimelineEntries?: TimelineEntry[];
      output?: { timeline?: TimelineEntry[] };
    };

    expect(execEnd.newTimelineEntries).toBeDefined();
    expect(execEnd.newTimelineEntries!.length).toBeGreaterThan(0);

    const messages = timelineToMessages(execEnd.newTimelineEntries!, new Map());
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ id: "u1", role: "user", content: "Hi", toolCalls: undefined });
    expect(messages[1]).toEqual({
      id: "a1",
      role: "assistant",
      content: "Hello!",
      toolCalls: undefined,
    });
  });

  it("fallback path: extracts messages from output.timeline", () => {
    const timeline = [
      makeTimelineEntry({ role: "user", content: [textBlock("Hi")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hello!")], id: "a1" }),
    ];

    const event = makeExecutionEndEvent({ outputTimeline: timeline });

    const execEnd = event as typeof event & {
      newTimelineEntries?: TimelineEntry[];
      output?: { timeline?: TimelineEntry[] };
    };

    // Delta path should not trigger (no newTimelineEntries)
    expect(!execEnd.newTimelineEntries || execEnd.newTimelineEntries.length === 0).toBe(true);

    // Fallback path
    expect(Array.isArray(execEnd.output?.timeline)).toBe(true);
    const messages = timelineToMessages(execEnd.output!.timeline!, new Map());
    expect(messages).toHaveLength(2);
  });

  it("delta path takes priority over fallback", () => {
    const deltaEntries = [
      makeTimelineEntry({ role: "assistant", content: [textBlock("Delta!")], id: "d1" }),
    ];
    const fullTimeline = [
      makeTimelineEntry({ role: "user", content: [textBlock("Old")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Delta!")], id: "d1" }),
    ];

    const event = makeExecutionEndEvent({
      newTimelineEntries: deltaEntries,
      outputTimeline: fullTimeline,
    });

    // The hook checks newTimelineEntries first and returns early
    if (event.newTimelineEntries && event.newTimelineEntries.length > 0) {
      const messages = timelineToMessages(event.newTimelineEntries, new Map());
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Delta!");
      return;
    }

    // Should not reach here
    expect.unreachable("Delta path should have taken priority");
  });

  it("handles multi-tick execution with tool calls in timeline", () => {
    // A realistic multi-tick execution:
    // Tick 1: user message → assistant responds with tool call
    // Tick 2: tool result → assistant gives final answer
    const entries = [
      makeTimelineEntry({ role: "user", content: [textBlock("Find all TODO comments")], id: "u1" }),
      makeTimelineEntry({
        role: "assistant",
        content: [
          textBlock("I'll search for TODOs."),
          toolUseBlock("tc-1", "grep", { pattern: "TODO" }),
        ],
        id: "a1",
      }),
      makeTimelineEntry({ role: "tool", content: [toolResultBlock("tc-1", "Found 3 TODOs")] }),
      makeTimelineEntry({
        role: "assistant",
        content: [textBlock("Found 3 TODO comments in the codebase.")],
        id: "a2",
      }),
    ];

    const durations = new Map([["tc-1", 250]]);
    const messages = timelineToMessages(entries, durations);

    expect(messages).toHaveLength(3); // user, assistant+tool, assistant
    expect(messages[0]).toEqual({
      id: "u1",
      role: "user",
      content: "Find all TODO comments",
      toolCalls: undefined,
    });
    expect(messages[1]).toEqual({
      id: "a1",
      role: "assistant",
      content: "I'll search for TODOs.",
      toolCalls: [{ id: "tc-1", name: "grep", status: "done", duration: 250 }],
    });
    expect(messages[2]).toEqual({
      id: "a2",
      role: "assistant",
      content: "Found 3 TODO comments in the codebase.",
      toolCalls: undefined,
    });
  });

  it("handles SemanticContentBlock (superset of ContentBlock)", () => {
    // COMTimelineEntry has SemanticContentBlock which extends ContentBlock
    // with optional semanticNode and semantic fields.
    // The filter for type: "text" should still work.
    const semanticEntry: TimelineEntry = {
      kind: "message",
      message: {
        id: "s1",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Semantic content",
            // Extra fields from SemanticContentBlock — should be ignored
            semanticNode: { type: "paragraph", children: [] },
            semantic: { type: "paragraph" },
          } as any,
        ],
      },
    };

    const messages = timelineToMessages([semanticEntry], new Map());
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Semantic content");
  });
});

// ============================================================================
// Tests: Flat message accumulation
// Simulates the hook's state transitions across multiple user turns.
// All confirmed messages go straight to `messages` (fed to <Static>).
// ============================================================================

describe("flat message accumulation", () => {
  /**
   * Simulates the hook's flat state management.
   * messages = all confirmed (append-only, fed to Static).
   * pending = optimistic user message in dynamic area.
   * messageCount = tracks count for fallback dedup.
   */
  function createSimulatedHook() {
    let messages: ChatMessage[] = [];
    let pending: ChatMessage | null = null;
    let messageCount = 0;

    return {
      get messages() {
        return messages;
      },
      get pending() {
        return pending;
      },

      // Simulates execution_end with delta entries (preferred path)
      onExecutionEndDelta(entries: TimelineEntry[]) {
        const newMessages = timelineToMessages(entries, new Map());
        if (newMessages.length > 0) {
          messages = [...messages, ...newMessages];
          messageCount += newMessages.length;
        }
        pending = null;
      },

      // Simulates execution_end with full timeline (fallback path)
      onExecutionEndFull(timeline: TimelineEntry[]) {
        const allMessages = timelineToMessages(timeline, new Map());
        const newMessages = allMessages.slice(messageCount);
        if (newMessages.length > 0) {
          messages = [...messages, ...newMessages];
          messageCount += newMessages.length;
        }
        pending = null;
      },

      addUserMessage(content: string) {
        pending = { id: `pending-${Date.now()}`, role: "user", content };
      },

      clear() {
        messages = [];
        pending = null;
        messageCount = 0;
      },
    };
  }

  it("first execution appends messages directly", () => {
    const hook = createSimulatedHook();

    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Hi")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hello!")], id: "a1" }),
    ]);

    expect(hook.messages).toHaveLength(2);
    expect(hook.messages[0].id).toBe("u1");
    expect(hook.messages[1].id).toBe("a1");
    expect(hook.pending).toBeNull();
  });

  it("addUserMessage sets pending without touching messages", () => {
    const hook = createSimulatedHook();

    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Hi")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hello!")], id: "a1" }),
    ]);

    hook.addUserMessage("Follow up");

    // Messages unchanged — no promotion needed
    expect(hook.messages).toHaveLength(2);
    expect(hook.pending).not.toBeNull();
    expect(hook.pending!.content).toBe("Follow up");
  });

  it("multi-turn conversation accumulates all messages", () => {
    const hook = createSimulatedHook();

    // Turn 1
    hook.addUserMessage("Q1");
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
    ]);

    // Turn 2
    hook.addUserMessage("Q2");
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q2")], id: "u2" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A2")], id: "a2" }),
    ]);

    // Turn 3
    hook.addUserMessage("Q3");
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q3")], id: "u3" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A3")], id: "a3" }),
    ]);

    // All 6 messages in flat array
    expect(hook.messages).toHaveLength(6);
    expect(hook.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
    expect(hook.pending).toBeNull();
  });

  it("messages grow monotonically — safe for Static", () => {
    const hook = createSimulatedHook();

    for (let i = 1; i <= 5; i++) {
      hook.addUserMessage(`Q${i}`);
      hook.onExecutionEndDelta([
        makeTimelineEntry({ role: "user", content: [textBlock(`Q${i}`)], id: `u${i}` }),
        makeTimelineEntry({ role: "assistant", content: [textBlock(`A${i}`)], id: `a${i}` }),
      ]);
    }

    expect(hook.messages).toHaveLength(10);

    // All IDs unique — safe for Static keys
    const ids = hook.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(10);
  });

  it("fallback path deduplicates using messageCount", () => {
    const hook = createSimulatedHook();

    // Turn 1 via delta
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
    ]);

    // Turn 2 via fallback — full timeline includes turn 1
    const fullTimeline = [
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
      makeTimelineEntry({ role: "user", content: [textBlock("Q2")], id: "u2" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A2")], id: "a2" }),
    ];
    hook.onExecutionEndFull(fullTimeline);

    // Should only have 4 messages, not 6 (no duplicates)
    expect(hook.messages).toHaveLength(4);
    expect(hook.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("clear resets messages and pending", () => {
    const hook = createSimulatedHook();

    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Hi")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hello!")], id: "a1" }),
    ]);
    hook.addUserMessage("More");

    hook.clear();

    expect(hook.messages).toHaveLength(0);
    expect(hook.pending).toBeNull();
  });

  it("clear resets messageCount so fallback works after clear", () => {
    const hook = createSimulatedHook();

    // Build up some messages
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
    ]);

    hook.clear();

    // New conversation via fallback — should start from scratch
    const freshTimeline = [
      makeTimelineEntry({ role: "user", content: [textBlock("Fresh")], id: "f1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Start!")], id: "f2" }),
    ];
    hook.onExecutionEndFull(freshTimeline);

    expect(hook.messages).toHaveLength(2);
    expect(hook.messages[0].id).toBe("f1");
  });

  it("addUserMessage before any execution does not corrupt state", () => {
    const hook = createSimulatedHook();

    hook.addUserMessage("First");

    expect(hook.messages).toHaveLength(0);
    expect(hook.pending).not.toBeNull();
  });

  it("execution_end clears pending", () => {
    const hook = createSimulatedHook();

    hook.addUserMessage("Hello");
    expect(hook.pending).not.toBeNull();

    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Hello")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hi!")], id: "a1" }),
    ]);

    expect(hook.pending).toBeNull();
  });
});
