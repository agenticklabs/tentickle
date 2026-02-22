import { createTool, type ToolClass } from "@agentick/core";
import { z } from "zod";
import { NodeHtmlMarkdown } from "node-html-markdown";

export const MAX_CONTENT_LENGTH = 30_000;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_HTML_SIZE = 5_000_000; // 5MB max HTML before conversion

const nhm = new NodeHtmlMarkdown({
  keepDataImages: false,
  maxConsecutiveNewlines: 2,
  bulletMarker: "-",
});

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cutoff = text.lastIndexOf("\n", max);
  const breakAt = cutoff > max * 0.8 ? cutoff : max;
  return `${text.slice(0, breakAt)}\n\n[truncated — ${text.length - breakAt} chars remaining]`;
}

export function htmlToMarkdown(html: string): string {
  return nhm
    .translate(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textResult(text: string) {
  return [{ type: "text" as const, text }];
}

export async function handleWebFetch({ url }: { url: string }) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return textResult(`Invalid URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return textResult(`Unsupported protocol: ${parsedUrl.protocol}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "Tentickle/1.0 (coding-agent)",
        Accept: "text/html, application/json, text/plain, */*",
      },
      redirect: "follow",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout") || msg.includes("aborted")) {
      return textResult(`Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`);
    }
    return textResult(`Fetch failed: ${msg}`);
  }

  if (!response.ok) {
    return textResult(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // JSON: pretty-print directly
  if (contentType.includes("application/json")) {
    try {
      const json = await response.json();
      const text = JSON.stringify(json, null, 2);
      return textResult(truncate(text, MAX_CONTENT_LENGTH));
    } catch {
      return textResult("Failed to parse JSON response");
    }
  }

  // Plain text: return as-is
  if (contentType.includes("text/plain")) {
    const text = await response.text();
    return textResult(truncate(text, MAX_CONTENT_LENGTH));
  }

  // Binary content: reject
  if (
    contentType.includes("image/") ||
    contentType.includes("audio/") ||
    contentType.includes("video/") ||
    contentType.includes("application/octet-stream") ||
    contentType.includes("application/pdf")
  ) {
    return textResult(`Cannot process binary content (${contentType}): ${url}`);
  }

  // HTML (and everything else): convert to markdown
  const html = await response.text();

  if (html.length > MAX_HTML_SIZE) {
    return textResult(
      `Page too large (${(html.length / 1_000_000).toFixed(1)}MB). Try a more specific URL.`,
    );
  }

  const markdown = htmlToMarkdown(html);

  if (!markdown) {
    return textResult(`No readable content found at: ${url}`);
  }

  return textResult(truncate(markdown, MAX_CONTENT_LENGTH));
}

export const WebFetch: ToolClass = createTool({
  name: "web_fetch",
  description: `Fetch a URL and return its content as markdown.

When to use:
- Reading documentation for an unfamiliar API or library
- Checking package READMEs, changelogs, or migration guides
- Looking up error messages or solutions on Stack Overflow
- Reading GitHub issues, PRs, or code files via raw URLs

Output: page content converted to markdown, truncated at 30k chars.
Follows redirects. Times out after 15 seconds.
Strips scripts, styles, nav, and boilerplate automatically.

Tips:
- For GitHub files, use the raw URL (raw.githubusercontent.com)
- For npm packages, try https://www.npmjs.com/package/{name}
- If a page is too large, the most important content is usually near the top`,
  displaySummary: (input) => {
    try {
      return new URL(input.url).hostname;
    } catch {
      return input.url.slice(0, 50);
    }
  },
  input: z.object({
    url: z.string().describe("URL to fetch"),
  }),
  handler: handleWebFetch,
});
