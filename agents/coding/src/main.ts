import { createTUI } from "@agentick/tui";
import { openai } from "@agentick/openai";
import { startDevToolsServer } from "@agentick/devtools";
import { createCodingApp } from "./index.js";
import { CodingTUI } from "./tui/index.js";

const model = openai({ model: process.env.OPENAI_MODEL ?? "gpt-4o" });

const _devtools = startDevToolsServer();

const app = createCodingApp({ model, devTools: true });

const tui = createTUI({
  app,
  ui: CodingTUI,
});

await tui.start();
