import { createTUI } from "@agentick/tui";
import { startDevToolsServer } from "@agentick/devtools";
import { createCodingApp } from "./index.js";
import { CodingTUI } from "./tui/index.js";

const _devtools = startDevToolsServer();

const app = createCodingApp({ devTools: true });

const tui = createTUI({
  app,
  ui: CodingTUI,
});

await tui.start();
