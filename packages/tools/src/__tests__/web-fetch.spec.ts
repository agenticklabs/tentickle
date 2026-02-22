import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  truncate,
  htmlToMarkdown,
  handleWebFetch,
  MAX_CONTENT_LENGTH,
  MAX_HTML_SIZE,
} from "../web-fetch.js";

// ===========================================================================
// Helpers
// ===========================================================================

function text(result: { type: string; text: string }[]): string {
  return result[0]!.text;
}

function mockFetch(
  body: string,
  init?: { status?: number; statusText?: string; headers?: Record<string, string> },
) {
  const status = init?.status ?? 200;
  const statusText = init?.statusText ?? "OK";
  const headers = new Headers(init?.headers ?? { "content-type": "text/html" });

  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers,
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockImplementation(async () => JSON.parse(body || "null")),
  } as unknown as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// truncate
// ===========================================================================

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 100)).toBe("hello");
  });

  it("returns text at exactly max unchanged", () => {
    const text = "x".repeat(100);
    expect(truncate(text, 100)).toBe(text);
  });

  it("truncates at newline boundary when within 80% of max", () => {
    // Line at position 90, max is 100
    const text = "a".repeat(90) + "\n" + "b".repeat(50);
    const result = truncate(text, 100);
    expect(result).toContain("[truncated");
    expect(result.startsWith("a".repeat(90))).toBe(true);
  });

  it("truncates at max when no good newline break found", () => {
    // No newlines anywhere near the boundary
    const text = "a".repeat(200);
    const result = truncate(text, 100);
    expect(result).toContain("[truncated");
    expect(result).toContain("100 chars remaining");
  });

  it("reports correct remaining chars", () => {
    const text = "a".repeat(150);
    const result = truncate(text, 100);
    expect(result).toContain("50 chars remaining");
  });

  it("handles empty string", () => {
    expect(truncate("", 100)).toBe("");
  });

  it("handles max of 0", () => {
    const result = truncate("hello", 0);
    expect(result).toContain("[truncated");
  });
});

// ===========================================================================
// htmlToMarkdown
// ===========================================================================

describe("htmlToMarkdown", () => {
  it("converts basic HTML to markdown", () => {
    const md = htmlToMarkdown("<h1>Title</h1><p>Hello world</p>");
    expect(md).toContain("Title");
    expect(md).toContain("Hello world");
  });

  it("converts links", () => {
    const md = htmlToMarkdown('<a href="https://example.com">click</a>');
    expect(md).toContain("[click]");
    expect(md).toContain("https://example.com");
  });

  it("converts lists", () => {
    const md = htmlToMarkdown("<ul><li>one</li><li>two</li></ul>");
    expect(md).toContain("- one");
    expect(md).toContain("- two");
  });

  it("strips scripts", () => {
    const md = htmlToMarkdown("<p>visible</p><script>alert('xss')</script>");
    expect(md).toContain("visible");
    expect(md).not.toContain("alert");
  });

  it("strips styles", () => {
    const md = htmlToMarkdown("<style>body{color:red}</style><p>text</p>");
    expect(md).toContain("text");
    expect(md).not.toContain("color:red");
  });

  it("collapses excessive newlines to max 2", () => {
    const md = htmlToMarkdown("<p>a</p><br><br><br><br><p>b</p>");
    const maxConsecutiveNewlines =
      md.match(/\n+/g)?.reduce((max, match) => Math.max(max, match.length), 0) ?? 0;
    expect(maxConsecutiveNewlines).toBeLessThanOrEqual(2);
  });

  it("returns empty string for empty HTML", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  it("returns empty string for HTML with only scripts/styles", () => {
    const md = htmlToMarkdown("<script>x</script><style>y</style>");
    expect(md).toBe("");
  });

  it("handles malformed HTML gracefully", () => {
    const md = htmlToMarkdown("<p>unclosed <b>tags <i>everywhere");
    expect(md).toContain("unclosed");
    expect(md).toContain("tags");
  });
});

// ===========================================================================
// handleWebFetch — input validation
// ===========================================================================

describe("handleWebFetch: input validation", () => {
  it("rejects invalid URLs", async () => {
    const result = await handleWebFetch({ url: "not-a-url" });
    expect(text(result)).toContain("Invalid URL");
  });

  it("rejects URLs with no protocol", async () => {
    const result = await handleWebFetch({ url: "just-a-hostname.com" });
    expect(text(result)).toContain("Invalid URL");
  });

  it("rejects ftp protocol", async () => {
    const result = await handleWebFetch({ url: "ftp://files.example.com/file.txt" });
    expect(text(result)).toContain("Unsupported protocol");
    expect(text(result)).toContain("ftp:");
  });

  it("rejects file:// protocol", async () => {
    const result = await handleWebFetch({ url: "file:///etc/passwd" });
    expect(text(result)).toContain("Unsupported protocol");
  });

  it("rejects javascript: protocol", async () => {
    const result = await handleWebFetch({ url: "javascript:alert(1)" });
    expect(text(result)).toContain("Unsupported protocol");
  });

  it("rejects data: URLs", async () => {
    const result = await handleWebFetch({ url: "data:text/html,<h1>hi</h1>" });
    expect(text(result)).toContain("Unsupported protocol");
  });
});

// ===========================================================================
// handleWebFetch — network errors
// ===========================================================================

describe("handleWebFetch: network errors", () => {
  it("handles timeout", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("The operation was aborted due to timeout"));
    const result = await handleWebFetch({ url: "https://slow.example.com" });
    expect(text(result)).toContain("timed out");
  });

  it("handles abort", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("This operation was aborted"));
    const result = await handleWebFetch({ url: "https://aborted.example.com" });
    expect(text(result)).toContain("timed out");
  });

  it("handles DNS failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("getaddrinfo ENOTFOUND nonexistent.example.com"));
    const result = await handleWebFetch({ url: "https://nonexistent.example.com" });
    expect(text(result)).toContain("Fetch failed");
    expect(text(result)).toContain("ENOTFOUND");
  });

  it("handles connection refused", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await handleWebFetch({ url: "https://down.example.com" });
    expect(text(result)).toContain("Fetch failed");
  });

  it("handles non-Error throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue("string error");
    const result = await handleWebFetch({ url: "https://weird.example.com" });
    expect(text(result)).toContain("Fetch failed");
    expect(text(result)).toContain("string error");
  });
});

// ===========================================================================
// handleWebFetch — HTTP error responses
// ===========================================================================

describe("handleWebFetch: HTTP errors", () => {
  it("handles 404", async () => {
    globalThis.fetch = mockFetch("", { status: 404, statusText: "Not Found" });
    const result = await handleWebFetch({ url: "https://example.com/missing" });
    expect(text(result)).toContain("HTTP 404");
    expect(text(result)).toContain("Not Found");
  });

  it("handles 500", async () => {
    globalThis.fetch = mockFetch("", { status: 500, statusText: "Internal Server Error" });
    const result = await handleWebFetch({ url: "https://example.com/broken" });
    expect(text(result)).toContain("HTTP 500");
  });

  it("handles 403", async () => {
    globalThis.fetch = mockFetch("", { status: 403, statusText: "Forbidden" });
    const result = await handleWebFetch({ url: "https://example.com/secret" });
    expect(text(result)).toContain("HTTP 403");
  });

  it("includes URL in error message", async () => {
    globalThis.fetch = mockFetch("", { status: 404, statusText: "Not Found" });
    const result = await handleWebFetch({ url: "https://example.com/specific-page" });
    expect(text(result)).toContain("https://example.com/specific-page");
  });
});

// ===========================================================================
// handleWebFetch — content type handling
// ===========================================================================

describe("handleWebFetch: content types", () => {
  it("handles JSON responses", async () => {
    const json = JSON.stringify({ name: "test", version: "1.0" });
    globalThis.fetch = mockFetch(json, { headers: { "content-type": "application/json" } });
    const result = await handleWebFetch({ url: "https://api.example.com/data" });
    expect(text(result)).toContain('"name": "test"');
    expect(text(result)).toContain('"version": "1.0"');
  });

  it("handles JSON with charset", async () => {
    const json = JSON.stringify({ ok: true });
    globalThis.fetch = mockFetch(json, {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    const result = await handleWebFetch({ url: "https://api.example.com" });
    expect(text(result)).toContain('"ok": true');
  });

  it("handles malformed JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    });
    const result = await handleWebFetch({ url: "https://api.example.com/bad" });
    expect(text(result)).toContain("Failed to parse JSON");
  });

  it("handles plain text", async () => {
    globalThis.fetch = mockFetch("Hello plain text", { headers: { "content-type": "text/plain" } });
    const result = await handleWebFetch({ url: "https://example.com/readme.txt" });
    expect(text(result)).toBe("Hello plain text");
  });

  it("rejects images", async () => {
    globalThis.fetch = mockFetch("", { headers: { "content-type": "image/png" } });
    const result = await handleWebFetch({ url: "https://example.com/photo.png" });
    expect(text(result)).toContain("Cannot process binary content");
  });

  it("rejects audio", async () => {
    globalThis.fetch = mockFetch("", { headers: { "content-type": "audio/mpeg" } });
    const result = await handleWebFetch({ url: "https://example.com/song.mp3" });
    expect(text(result)).toContain("Cannot process binary content");
  });

  it("rejects video", async () => {
    globalThis.fetch = mockFetch("", { headers: { "content-type": "video/mp4" } });
    const result = await handleWebFetch({ url: "https://example.com/video.mp4" });
    expect(text(result)).toContain("Cannot process binary content");
  });

  it("rejects PDFs", async () => {
    globalThis.fetch = mockFetch("", { headers: { "content-type": "application/pdf" } });
    const result = await handleWebFetch({ url: "https://example.com/doc.pdf" });
    expect(text(result)).toContain("Cannot process binary content");
  });

  it("rejects octet-stream", async () => {
    globalThis.fetch = mockFetch("", { headers: { "content-type": "application/octet-stream" } });
    const result = await handleWebFetch({ url: "https://example.com/binary" });
    expect(text(result)).toContain("Cannot process binary content");
  });

  it("handles missing content-type as HTML", async () => {
    globalThis.fetch = mockFetch("<h1>No content type</h1>", { headers: {} });
    const result = await handleWebFetch({ url: "https://example.com" });
    expect(text(result)).toContain("No content type");
  });
});

// ===========================================================================
// handleWebFetch — HTML conversion
// ===========================================================================

describe("handleWebFetch: HTML conversion", () => {
  it("converts HTML to markdown", async () => {
    globalThis.fetch = mockFetch(
      "<html><body><h1>Docs</h1><p>Some documentation</p></body></html>",
    );
    const result = await handleWebFetch({ url: "https://docs.example.com" });
    expect(text(result)).toContain("Docs");
    expect(text(result)).toContain("Some documentation");
  });

  it("handles empty body", async () => {
    globalThis.fetch = mockFetch("<html><body></body></html>");
    const result = await handleWebFetch({ url: "https://example.com/empty" });
    expect(text(result)).toContain("No readable content");
  });

  it("handles script-only pages", async () => {
    globalThis.fetch = mockFetch("<html><body><script>var x = 1;</script></body></html>");
    const result = await handleWebFetch({ url: "https://example.com/spa" });
    expect(text(result)).toContain("No readable content");
  });
});

// ===========================================================================
// handleWebFetch — adversarial: size limits
// ===========================================================================

describe("handleWebFetch: size limits", () => {
  it("rejects HTML over 5MB", async () => {
    const hugeHtml = "<p>" + "x".repeat(MAX_HTML_SIZE + 1) + "</p>";
    globalThis.fetch = mockFetch(hugeHtml);
    const result = await handleWebFetch({ url: "https://example.com/huge" });
    expect(text(result)).toContain("Page too large");
    expect(text(result)).toContain("MB");
  });

  it("truncates converted markdown over 30k chars", async () => {
    // Create HTML that produces >30k chars of markdown
    const lines = Array.from(
      { length: 2000 },
      (_, i) => `<p>Line ${i}: ${"content ".repeat(10)}</p>`,
    );
    globalThis.fetch = mockFetch(`<html><body>${lines.join("")}</body></html>`);
    const result = await handleWebFetch({ url: "https://example.com/long" });
    expect(text(result).length).toBeLessThanOrEqual(MAX_CONTENT_LENGTH + 200); // +200 for truncation message
    expect(text(result)).toContain("[truncated");
  });

  it("truncates large JSON over 30k chars", async () => {
    const bigObj = { data: "x".repeat(MAX_CONTENT_LENGTH + 1000) };
    globalThis.fetch = mockFetch(JSON.stringify(bigObj), {
      headers: { "content-type": "application/json" },
    });
    const result = await handleWebFetch({ url: "https://api.example.com/big" });
    expect(text(result)).toContain("[truncated");
  });

  it("truncates large plain text over 30k chars", async () => {
    const bigText = "x".repeat(MAX_CONTENT_LENGTH + 1000);
    globalThis.fetch = mockFetch(bigText, {
      headers: { "content-type": "text/plain" },
    });
    const result = await handleWebFetch({ url: "https://example.com/big.txt" });
    expect(text(result)).toContain("[truncated");
  });

  it("HTML at exactly 5MB is accepted", async () => {
    const html = "<p>" + "x".repeat(MAX_HTML_SIZE - 10) + "</p>";
    globalThis.fetch = mockFetch(html);
    const result = await handleWebFetch({ url: "https://example.com/exact" });
    expect(text(result)).not.toContain("Page too large");
  });
});

// ===========================================================================
// handleWebFetch — adversarial: edge cases
// ===========================================================================

describe("handleWebFetch: edge cases", () => {
  it("handles URL with special characters", async () => {
    globalThis.fetch = mockFetch("<p>found</p>");
    const result = await handleWebFetch({
      url: "https://example.com/search?q=hello%20world&lang=en",
    });
    expect(text(result)).toContain("found");
  });

  it("handles URL with fragment", async () => {
    globalThis.fetch = mockFetch("<p>section</p>");
    const result = await handleWebFetch({ url: "https://example.com/docs#section" });
    expect(text(result)).toContain("section");
  });

  it("handles URL with port", async () => {
    globalThis.fetch = mockFetch("<p>custom port</p>");
    const result = await handleWebFetch({ url: "https://example.com:8080/api" });
    expect(text(result)).toContain("custom port");
  });

  it("handles http:// (not just https)", async () => {
    globalThis.fetch = mockFetch("<p>insecure</p>");
    const result = await handleWebFetch({ url: "http://example.com" });
    expect(text(result)).toContain("insecure");
  });

  it("every result is a single-element array with type 'text'", async () => {
    // Invalid URL
    let result = await handleWebFetch({ url: "garbage" });
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("text");

    // Network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fail"));
    result = await handleWebFetch({ url: "https://fail.example.com" });
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("text");

    // Success
    globalThis.fetch = mockFetch("<p>ok</p>");
    result = await handleWebFetch({ url: "https://ok.example.com" });
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("text");
  });
});
