import { describe, it, expect } from "vitest";
import {
  truncateEdges,
  hasMultimodal,
  userMultimodalSummary,
  toolResultSummary,
} from "./timeline.js";
import type { Message } from "@agentick/shared";

function msg(role: Message["role"], content: any[]): Message {
  return { role, content } as Message;
}

const IMAGE_BLOCK = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "" },
};
const AUDIO_BLOCK = {
  type: "audio",
  source: { type: "base64", media_type: "audio/mp3", data: "" },
};
const DOC_BLOCK = {
  type: "document",
  source: { type: "base64", media_type: "application/pdf", data: "" },
};
const VIDEO_BLOCK = {
  type: "video",
  source: { type: "base64", media_type: "video/mp4", data: "" },
};
const TEXT_BLOCK = (text: string) => ({ type: "text", text });
const TOOL_USE = (name: string) => ({ type: "tool_use", toolUseId: "1", name, input: {} });

// ===========================================================================
// truncateEdges
// ===========================================================================

describe("truncateEdges", () => {
  it("returns short text unchanged", () => {
    expect(truncateEdges("hello")).toBe("hello");
  });

  it("returns text at exactly 280 chars unchanged", () => {
    const text = "X".repeat(280);
    expect(truncateEdges(text)).toBe(text);
  });

  it("truncates at 281 chars", () => {
    const text = "X".repeat(281);
    const result = truncateEdges(text);
    expect(result).toContain("\n...\n");
  });

  it("preserves first 140 and last 140 chars", () => {
    const text = "S".repeat(200) + "E".repeat(200);
    const result = truncateEdges(text);
    expect(result.startsWith("S".repeat(140))).toBe(true);
    expect(result.endsWith("E".repeat(140))).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncateEdges("")).toBe("");
  });

  it("handles text with newlines within threshold", () => {
    const text = "line1\nline2\nline3";
    expect(truncateEdges(text)).toBe(text);
  });
});

// ===========================================================================
// hasMultimodal
// ===========================================================================

describe("hasMultimodal", () => {
  it("returns false for text-only message", () => {
    expect(hasMultimodal(msg("user", [TEXT_BLOCK("hello")]))).toBe(false);
  });

  it("returns true for image", () => {
    expect(hasMultimodal(msg("user", [IMAGE_BLOCK]))).toBe(true);
  });

  it("returns true for audio", () => {
    expect(hasMultimodal(msg("user", [AUDIO_BLOCK]))).toBe(true);
  });

  it("returns true for document", () => {
    expect(hasMultimodal(msg("user", [DOC_BLOCK]))).toBe(true);
  });

  it("returns true for video", () => {
    expect(hasMultimodal(msg("user", [VIDEO_BLOCK]))).toBe(true);
  });

  it("returns false for tool_use blocks (not media)", () => {
    expect(hasMultimodal(msg("assistant", [TOOL_USE("shell")]))).toBe(false);
  });

  it("returns true when mixed text + media", () => {
    expect(hasMultimodal(msg("user", [TEXT_BLOCK("look"), IMAGE_BLOCK]))).toBe(true);
  });

  it("returns false for empty content", () => {
    expect(hasMultimodal(msg("user", []))).toBe(false);
  });
});

// ===========================================================================
// userMultimodalSummary
// ===========================================================================

describe("userMultimodalSummary", () => {
  it("preserves text and appends media type", () => {
    const result = userMultimodalSummary(
      msg("user", [TEXT_BLOCK("Check this screenshot"), IMAGE_BLOCK]),
    );
    expect(result).toContain("Check this screenshot");
    expect(result).toContain("[image]");
  });

  it("counts multiple media of same type", () => {
    const result = userMultimodalSummary(
      msg("user", [TEXT_BLOCK("Here are the screenshots"), IMAGE_BLOCK, IMAGE_BLOCK, IMAGE_BLOCK]),
    );
    expect(result).toContain("image \u00d73");
  });

  it("lists different media types separately", () => {
    const result = userMultimodalSummary(
      msg("user", [TEXT_BLOCK("Files"), IMAGE_BLOCK, DOC_BLOCK, AUDIO_BLOCK]),
    );
    expect(result).toContain("image");
    expect(result).toContain("document");
    expect(result).toContain("audio");
  });

  it("media-only message (no text) shows just media types", () => {
    const result = userMultimodalSummary(msg("user", [IMAGE_BLOCK, IMAGE_BLOCK]));
    expect(result).toBe("[image \u00d72]");
    expect(result).not.toContain("undefined");
  });

  it("truncates long text at edges", () => {
    const longText = "A".repeat(500);
    const result = userMultimodalSummary(msg("user", [TEXT_BLOCK(longText), IMAGE_BLOCK]));
    expect(result).toContain("\n...\n");
    expect(result).toContain("[image]");
  });

  it("handles all four media types with counts", () => {
    const result = userMultimodalSummary(
      msg("user", [IMAGE_BLOCK, IMAGE_BLOCK, AUDIO_BLOCK, DOC_BLOCK, VIDEO_BLOCK, VIDEO_BLOCK]),
    );
    expect(result).toContain("image \u00d72");
    expect(result).toContain("audio");
    expect(result).toContain("document");
    expect(result).toContain("video \u00d72");
  });

  // --- Adversarial ---

  it("does NOT include tool_use in media summary", () => {
    const result = userMultimodalSummary(
      msg("user", [TEXT_BLOCK("run this"), TOOL_USE("shell"), IMAGE_BLOCK]),
    );
    expect(result).not.toContain("tool_use");
    expect(result).not.toContain("shell");
    expect(result).toContain("[image]");
  });

  it("empty content produces just media placeholder", () => {
    // Degenerate case: called on message with no media — shouldn't happen
    // but function should not crash
    const result = userMultimodalSummary(msg("user", [TEXT_BLOCK("hello")]));
    // No media → labels is empty → produces "hello\n[]"
    expect(result).toContain("hello");
  });
});

// ===========================================================================
// toolResultSummary
// ===========================================================================

describe("toolResultSummary", () => {
  it("returns truncated text output", () => {
    const result = toolResultSummary(
      msg("tool", [TEXT_BLOCK("total 42\ndrwxr-xr-x  5 user  staff  160 Feb  1 10:00 src")]),
    );
    expect(result).toContain("total 42");
    expect(result).toContain("src");
  });

  it("truncates long tool output at edges", () => {
    const longOutput = "L".repeat(500);
    const result = toolResultSummary(msg("tool", [TEXT_BLOCK(longOutput)]));
    expect(result).toContain("\n...\n");
    expect(result.startsWith("L".repeat(140))).toBe(true);
    expect(result.endsWith("L".repeat(140))).toBe(true);
  });

  it("notes media types in tool result", () => {
    const result = toolResultSummary(msg("tool", [TEXT_BLOCK("Screenshot taken"), IMAGE_BLOCK]));
    expect(result).toContain("Screenshot taken");
    expect(result).toContain("[image]");
  });

  it("media-only tool result", () => {
    const result = toolResultSummary(msg("tool", [IMAGE_BLOCK]));
    expect(result).toBe("[image]");
  });

  it("empty tool result returns fallback", () => {
    expect(toolResultSummary(msg("tool", []))).toBe("[tool result]");
  });

  it("handles multiple media types", () => {
    const result = toolResultSummary(msg("tool", [IMAGE_BLOCK, DOC_BLOCK]));
    expect(result).toBe("[image, document]");
  });

  it("text + multiple media", () => {
    const result = toolResultSummary(
      msg("tool", [TEXT_BLOCK("Results:"), IMAGE_BLOCK, IMAGE_BLOCK, DOC_BLOCK]),
    );
    expect(result).toContain("Results:");
    expect(result).toContain("[image, image, document]");
  });

  // --- Adversarial ---

  it("does not crash on unrecognized block types", () => {
    const result = toolResultSummary(msg("tool", [{ type: "unknown_type", data: {} } as any]));
    expect(result).toBe("[tool result]");
  });

  it("empty text block produces fallback", () => {
    const result = toolResultSummary(msg("tool", [TEXT_BLOCK("")]));
    expect(result).toBe("[tool result]");
  });

  it("whitespace-only text is preserved (not treated as empty)", () => {
    const result = toolResultSummary(msg("tool", [TEXT_BLOCK("   ")]));
    expect(result).toBe("   ");
  });

  it("handles very large number of media blocks", () => {
    const blocks = Array.from({ length: 100 }, () => IMAGE_BLOCK);
    const result = toolResultSummary(msg("tool", blocks));
    // Should list all 100 "image" labels
    expect(result.startsWith("[")).toBe(true);
    expect(result.split("image").length - 1).toBe(100);
  });
});

// ===========================================================================
// Collapse strategy (role-based behavior contracts)
// ===========================================================================

describe("collapse strategy contracts", () => {
  // These test the INVARIANTS of the EnhancedTimeline collapse logic.
  // The component uses these functions to decide what to collapse.
  // If these invariants break, the model sees corrupted context.

  describe("assistant messages must never be summarized", () => {
    it("assistant with tool_use: hasMultimodal is false", () => {
      const m = msg("assistant", [
        TEXT_BLOCK("Let me check"),
        TOOL_USE("shell"),
        TOOL_USE("read_file"),
      ]);
      // hasMultimodal drives user collapse — must be false for tool_use
      expect(hasMultimodal(m)).toBe(false);
    });

    it("assistant with image: hasMultimodal is true but role check prevents collapse", () => {
      // This tests the invariant that even if hasMultimodal returns true
      // for an assistant message, the switch(msg.role) in EnhancedTimeline
      // routes "assistant" to pass-through, not to the hasMultimodal check.
      // We can't test the component here, but we document the contract.
      const m = msg("assistant", [TEXT_BLOCK("Here's the image"), IMAGE_BLOCK]);
      expect(hasMultimodal(m)).toBe(true);
      // The component MUST check role before checking hasMultimodal
    });
  });

  describe("user text-only must not be collapsed", () => {
    it("text-only user message: hasMultimodal is false", () => {
      expect(hasMultimodal(msg("user", [TEXT_BLOCK("fix the bug")]))).toBe(false);
    });

    it("user with only tool_use: hasMultimodal is false", () => {
      expect(hasMultimodal(msg("user", [TOOL_USE("custom_tool")]))).toBe(false);
    });
  });

  describe("tool results must be collapsed, not dropped", () => {
    it("text-only tool result produces non-empty summary", () => {
      const result = toolResultSummary(msg("tool", [TEXT_BLOCK("file contents here")]));
      expect(result).toBeTruthy();
      expect(result).not.toBe("[tool result]"); // has actual content
    });

    it("empty tool result has fallback (not empty string)", () => {
      const result = toolResultSummary(msg("tool", []));
      expect(result).toBe("[tool result]");
      expect(result.length).toBeGreaterThan(0);
    });

    it("media-only tool result still has summary", () => {
      const result = toolResultSummary(msg("tool", [IMAGE_BLOCK, IMAGE_BLOCK]));
      expect(result).toBeTruthy();
      expect(result).toContain("image");
    });
  });
});
