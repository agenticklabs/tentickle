/**
 * Tests for message transformation and history accumulation logic.
 *
 * The pure functions (extractToolCalls, timelineToMessages) are imported
 * directly from message-transforms.ts. The accumulation tests simulate
 * the hook's state management without needing React.
 */

import { describe, it, expect } from "vitest";
import type { ContentBlock, Message } from "@agentick/shared";
import { extractToolCalls, timelineToMessages, type TimelineEntry } from "../message-transforms.js";
import type { ChatMessage } from "../types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeTimelineEntry(overrides: {
  role: "user" | "assistant" | "tool" | "event";
  content: ContentBlock[];
  id?: string;
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
      { id: "u1", role: "user", content: [textBlock("Hello")], toolCalls: undefined },
      { id: "a1", role: "assistant", content: [textBlock("Hi there!")], toolCalls: undefined },
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

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[1].toolCalls).toEqual([{ id: "tc-1", name: "search", status: "done" }]);
    expect(result[2].content).toEqual([textBlock("Found bar!")]);
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
    const entries: TimelineEntry[] = [
      { message: { role: "user", content: [textBlock("hello")] } as Message },
    ];

    expect(timelineToMessages(entries, emptyDurations)).toHaveLength(0);
  });

  it("handles entries without message field", () => {
    const entries: TimelineEntry[] = [{ kind: "message" }];

    expect(timelineToMessages(entries, emptyDurations)).toHaveLength(0);
  });

  it("generates synthetic IDs when message.id is missing", () => {
    const entries = [makeTimelineEntry({ role: "user", content: [textBlock("test")] })];
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
// ============================================================================

describe("execution_end event shape compatibility", () => {
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

    expect(event.newTimelineEntries).toBeDefined();
    expect(event.newTimelineEntries!.length).toBeGreaterThan(0);

    const messages = timelineToMessages(event.newTimelineEntries!, new Map());
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      id: "u1",
      role: "user",
      content: [textBlock("Hi")],
      toolCalls: undefined,
    });
    expect(messages[1]).toEqual({
      id: "a1",
      role: "assistant",
      content: [textBlock("Hello!")],
      toolCalls: undefined,
    });
  });

  it("fallback path: extracts messages from output.timeline", () => {
    const timeline = [
      makeTimelineEntry({ role: "user", content: [textBlock("Hi")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hello!")], id: "a1" }),
    ];

    const event = makeExecutionEndEvent({ outputTimeline: timeline });

    expect(!event.newTimelineEntries || event.newTimelineEntries.length === 0).toBe(true);
    expect(Array.isArray(event.output?.timeline)).toBe(true);
    const messages = timelineToMessages(event.output!.timeline!, new Map());
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

    if (event.newTimelineEntries && event.newTimelineEntries.length > 0) {
      const messages = timelineToMessages(event.newTimelineEntries, new Map());
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toEqual([textBlock("Delta!")]);
      return;
    }

    expect.unreachable("Delta path should have taken priority");
  });

  it("handles multi-tick execution with tool calls in timeline", () => {
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

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      id: "u1",
      role: "user",
      content: [textBlock("Find all TODO comments")],
      toolCalls: undefined,
    });
    expect(messages[1]).toEqual({
      id: "a1",
      role: "assistant",
      content: [
        textBlock("I'll search for TODOs."),
        toolUseBlock("tc-1", "grep", { pattern: "TODO" }),
      ],
      toolCalls: [{ id: "tc-1", name: "grep", status: "done", duration: 250 }],
    });
    expect(messages[2]).toEqual({
      id: "a2",
      role: "assistant",
      content: [textBlock("Found 3 TODO comments in the codebase.")],
      toolCalls: undefined,
    });
  });

  it("handles SemanticContentBlock (superset of ContentBlock)", () => {
    const semanticEntry: TimelineEntry = {
      kind: "message",
      message: {
        id: "s1",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Semantic content",
            semanticNode: { type: "paragraph", children: [] },
            semantic: { type: "paragraph" },
          } as any,
        ],
      },
    };

    const messages = timelineToMessages([semanticEntry], new Map());
    expect(messages).toHaveLength(1);
    expect((messages[0].content as ContentBlock[])[0]).toMatchObject({
      type: "text",
      text: "Semantic content",
    });
  });
});

// ============================================================================
// Tests: Flat message accumulation
// Simulates the hook's state transitions without React.
// ============================================================================

describe("flat message accumulation", () => {
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

      onExecutionEndDelta(entries: TimelineEntry[]) {
        const newMessages = timelineToMessages(entries, new Map());
        if (newMessages.length > 0) {
          messages = [...messages, ...newMessages];
          messageCount += newMessages.length;
        }
        pending = null;
      },

      onExecutionEndFull(timeline: TimelineEntry[]) {
        const allMessages = timelineToMessages(timeline, new Map());
        const newMessages = allMessages.slice(messageCount);
        if (newMessages.length > 0) {
          messages = [...messages, ...newMessages];
          messageCount += newMessages.length;
        }
        pending = null;
      },

      addUserMessage(text: string) {
        pending = { id: `pending-${Date.now()}`, role: "user", content: text };
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

    expect(hook.messages).toHaveLength(2);
    expect(hook.pending).not.toBeNull();
    expect(hook.pending!.content).toBe("Follow up");
  });

  it("multi-turn conversation accumulates all messages", () => {
    const hook = createSimulatedHook();

    for (let i = 1; i <= 3; i++) {
      hook.addUserMessage(`Q${i}`);
      hook.onExecutionEndDelta([
        makeTimelineEntry({ role: "user", content: [textBlock(`Q${i}`)], id: `u${i}` }),
        makeTimelineEntry({ role: "assistant", content: [textBlock(`A${i}`)], id: `a${i}` }),
      ]);
    }

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
    const ids = hook.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(10);
  });

  it("fallback path deduplicates using messageCount", () => {
    const hook = createSimulatedHook();

    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
    ]);

    const fullTimeline = [
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
      makeTimelineEntry({ role: "user", content: [textBlock("Q2")], id: "u2" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A2")], id: "a2" }),
    ];
    hook.onExecutionEndFull(fullTimeline);

    expect(hook.messages).toHaveLength(4);
    expect(hook.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("clear resets everything", () => {
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

    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
    ]);

    hook.clear();

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

// ============================================================================
// Tests: Queued messages during active execution
// ============================================================================

describe("queued messages during execution", () => {
  /**
   * Simulates the hook with execution lifecycle awareness.
   * This is the desired behavior — queued messages survive execution end.
   */
  function createExecutionAwareHook() {
    let messages: ChatMessage[] = [];
    let pending: ChatMessage | null = null;
    let queued: ChatMessage[] = [];
    let messageCount = 0;
    let executing = false;

    return {
      get messages() {
        return messages;
      },
      get pending() {
        return pending;
      },
      get queued() {
        return queued;
      },
      get isExecuting() {
        return executing;
      },

      onExecutionStart() {
        executing = true;
      },

      onExecutionEndDelta(entries: TimelineEntry[]) {
        const newMessages = timelineToMessages(entries, new Map());
        if (newMessages.length > 0) {
          messages = [...messages, ...newMessages];
          messageCount += newMessages.length;
        }
        executing = false;

        // Only clear pending if it was confirmed in this execution's results.
        // Queued messages become pending for the next execution.
        if (queued.length > 0) {
          pending = queued[0];
          queued = queued.slice(1);
        } else {
          pending = null;
        }
      },

      addUserMessage(text: string) {
        const msg: ChatMessage = {
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "user",
          content: text,
        };

        if (executing) {
          // During execution: queue the message, don't overwrite pending
          queued = [...queued, msg];
        } else {
          pending = msg;
        }
      },

      clear() {
        messages = [];
        pending = null;
        queued = [];
        messageCount = 0;
        executing = false;
      },
    };
  }

  it("message submitted while idle becomes pending (baseline)", () => {
    const hook = createExecutionAwareHook();

    hook.addUserMessage("Hello");

    expect(hook.pending).not.toBeNull();
    expect(hook.pending!.content).toBe("Hello");
    expect(hook.queued).toHaveLength(0);
  });

  it("message submitted during execution goes to queue, not pending", () => {
    const hook = createExecutionAwareHook();

    hook.addUserMessage("First");
    hook.onExecutionStart();

    // User types another message while model is thinking
    hook.addUserMessage("Second");

    // "First" is still the pending (optimistic) message
    expect(hook.pending!.content).toBe("First");
    // "Second" is queued — not yet sent, waiting for execution to end
    expect(hook.queued).toHaveLength(1);
    expect(hook.queued[0].content).toBe("Second");
  });

  it("queued message survives execution_end and becomes pending", () => {
    const hook = createExecutionAwareHook();

    hook.addUserMessage("First");
    hook.onExecutionStart();
    hook.addUserMessage("Follow up");

    // Execution completes — "First" is confirmed in the timeline
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("First")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Response")], id: "a1" }),
    ]);

    // "Follow up" should now be the pending message, not wiped
    expect(hook.pending).not.toBeNull();
    expect(hook.pending!.content).toBe("Follow up");
    expect(hook.queued).toHaveLength(0);
    expect(hook.messages).toHaveLength(2);
  });

  it("multiple queued messages drain one at a time", () => {
    const hook = createExecutionAwareHook();

    hook.addUserMessage("Q1");
    hook.onExecutionStart();
    hook.addUserMessage("Q2");
    hook.addUserMessage("Q3");

    expect(hook.queued).toHaveLength(2);

    // First execution ends
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q1")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A1")], id: "a1" }),
    ]);

    // Q2 becomes pending, Q3 still queued
    expect(hook.pending!.content).toBe("Q2");
    expect(hook.queued).toHaveLength(1);
    expect(hook.queued[0].content).toBe("Q3");

    // Second execution runs and ends
    hook.onExecutionStart();
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q2")], id: "u2" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A2")], id: "a2" }),
    ]);

    // Q3 becomes pending
    expect(hook.pending!.content).toBe("Q3");
    expect(hook.queued).toHaveLength(0);

    // Third execution runs and ends
    hook.onExecutionStart();
    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Q3")], id: "u3" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("A3")], id: "a3" }),
    ]);

    // All done
    expect(hook.pending).toBeNull();
    expect(hook.queued).toHaveLength(0);
    expect(hook.messages).toHaveLength(6);
  });

  it("no queued messages — pending clears normally on execution end", () => {
    const hook = createExecutionAwareHook();

    hook.addUserMessage("Hello");
    hook.onExecutionStart();

    hook.onExecutionEndDelta([
      makeTimelineEntry({ role: "user", content: [textBlock("Hello")], id: "u1" }),
      makeTimelineEntry({ role: "assistant", content: [textBlock("Hi!")], id: "a1" }),
    ]);

    expect(hook.pending).toBeNull();
    expect(hook.queued).toHaveLength(0);
  });

  it("clear wipes queued messages too", () => {
    const hook = createExecutionAwareHook();

    hook.addUserMessage("Q1");
    hook.onExecutionStart();
    hook.addUserMessage("Q2");
    hook.addUserMessage("Q3");

    hook.clear();

    expect(hook.messages).toHaveLength(0);
    expect(hook.pending).toBeNull();
    expect(hook.queued).toHaveLength(0);
    expect(hook.isExecuting).toBe(false);
  });

  it("queued messages are visible to the UI while waiting", () => {
    const hook = createExecutionAwareHook();

    hook.addUserMessage("Working on it");
    hook.onExecutionStart();

    hook.addUserMessage("Also check the tests");
    hook.addUserMessage("And update the README");

    // UI should be able to show all three states:
    // 1. pending = "Working on it" (currently being processed)
    // 2. queued[0] = "Also check the tests" (waiting)
    // 3. queued[1] = "And update the README" (waiting)
    expect(hook.pending!.content).toBe("Working on it");
    expect(hook.queued).toHaveLength(2);
    expect(hook.queued.map((q) => q.content)).toEqual([
      "Also check the tests",
      "And update the README",
    ]);
  });
});
