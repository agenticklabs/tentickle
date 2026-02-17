import { execSync } from "node:child_process";
import { createClient } from "@agentick/client";
import { createLocalTransport } from "@agentick/core";
import { createTUI } from "@agentick/tui";
import { startDevToolsServer } from "@agentick/devtools";
import { createCodingApp } from "./index.js";
import { CodingTUI } from "./tui/index.js";
import { startConnectors } from "./connectors.js";

// pnpm runs from agents/coding/ — normalize to workspace root so all paths
// (sandbox, file picker, attachments) resolve from where the user expects.
try {
  const root = execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  process.chdir(root);
} catch {
  // Not in a git repo — stay put
}

const _devtools = startDevToolsServer();

const app = createCodingApp({ devTools: true, maxTicks: 250 });

// Shared client for TUI + connectors
const client = createClient({
  baseUrl: "local://",
  transport: createLocalTransport(app),
});

// Start connectors (Telegram, iMessage) based on env vars
const connectors = await startConnectors(client, {
  telegram: { sessionId: "telegram" },
  imessage: { sessionId: "imessage" },
});

const tui = createTUI({
  client,
  ui: CodingTUI,
});

try {
  await tui.start();
} finally {
  for (const c of connectors) {
    await c.stop();
  }
}
