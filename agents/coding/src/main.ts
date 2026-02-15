import { createClient } from "@agentick/client";
import { createLocalTransport } from "@agentick/core";
import { createTUI } from "@agentick/tui";
import { startDevToolsServer } from "@agentick/devtools";
import { createCodingApp } from "./index.js";
import { CodingTUI } from "./tui/index.js";
import { startConnectors } from "./connectors.js";

const _devtools = startDevToolsServer();

const app = createCodingApp({ devTools: true });

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
