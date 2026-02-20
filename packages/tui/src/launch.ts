import { execSync } from "node:child_process";
import { join } from "node:path";
import { createClient } from "@agentick/client";
import { createLocalTransport } from "@agentick/core";
import type { App } from "@agentick/core";
import { createTUI } from "@agentick/tui";
import { startDevToolsServer } from "@agentick/devtools";
import { createGateway, type GatewayPlugin } from "@agentick/gateway";
import { CronService, bindSchedulerStore } from "@agentick/scheduler";
import { bindSessionStore, bindMemory } from "@tentickle/agent";
import type { TentickleSessionStore, TentickleMemory } from "@tentickle/agent";
import { TentickleTUI } from "./tui.js";

type AppFactory = (opts: {
  devTools: boolean;
  maxTicks: number;
}) => Promise<{ app: App<any>; store: TentickleSessionStore; memory?: TentickleMemory }>;

// ============================================================================
// Single-app launcher (for standalone agent entry points)
// ============================================================================

export interface LaunchOptions {
  createApp: AppFactory;
  sessionId?: string;
  maxTicks?: number;
  devTools?: boolean;
}

export async function launchTUI(options: LaunchOptions): Promise<void> {
  const { createApp, sessionId = "tui", maxTicks = 250, devTools = true } = options;

  normalizeToGitRoot();

  if (devTools) {
    startDevToolsServer();
  }

  const { app, store, memory } = await createApp({ devTools, maxTicks });
  bindSessionStore(store);
  if (memory) bindMemory(memory);

  const client = createClient({
    baseUrl: "local://",
    transport: createLocalTransport(app),
  });

  const cronService = new CronService({
    dataDir: join(process.cwd(), ".tentickle"),
    client,
    defaultTarget: "tui",
  });
  bindSchedulerStore(cronService.store);
  await cronService.start();

  const tui = createTUI({
    client,
    sessionId,
    ui: TentickleTUI,
  });

  try {
    await tui.start();
  } finally {
    await cronService.stop();
  }
}

// ============================================================================
// Multi-app gateway launcher (for CLI with all agents)
// ============================================================================

export interface GatewayLaunchOptions {
  /** App factories keyed by agent name. All are created eagerly on startup. */
  apps: Record<string, AppFactory>;
  /** Which agent the TUI connects to (must be a key in `apps`). */
  defaultAgent: string;
  maxTicks?: number;
  devTools?: boolean;
  /** Gateway plugins (connectors, integrations) */
  plugins?: GatewayPlugin[];
}

export async function launchGateway(options: GatewayLaunchOptions): Promise<void> {
  const { apps: factories, defaultAgent, maxTicks = 250, devTools = true, plugins } = options;

  normalizeToGitRoot();

  if (devTools) {
    startDevToolsServer();
  }

  // Create all apps eagerly
  const gatewayApps: Record<string, App<any>> = {};
  let boundStore: TentickleSessionStore | null = null;

  for (const [name, factory] of Object.entries(factories)) {
    const { app, store, memory } = await factory({ devTools, maxTicks });
    gatewayApps[name] = app;

    // Bind the default agent's store and memory for TUI session restoration
    if (name === defaultAgent) {
      boundStore = store;
      if (memory) bindMemory(memory);
    }
  }

  if (boundStore) {
    bindSessionStore(boundStore);
  }

  // Gateway routes sessions to the correct app via session key format
  // - "tui" (no prefix) → routes to defaultAgent
  // - "main:telegram" → routes explicitly to main agent
  const gateway = createGateway({
    apps: gatewayApps,
    defaultApp: defaultAgent,
    plugins,
  });

  const client = createClient({
    baseUrl: "local://",
    transport: gateway.createLocalTransport(),
  });

  const cronService = new CronService({
    dataDir: join(process.cwd(), ".tentickle"),
    client,
    defaultTarget: "tui",
  });
  bindSchedulerStore(cronService.store);
  await cronService.start();

  // TUI session: unqualified key routes to defaultAgent via gateway
  const tui = createTUI({
    client,
    sessionId: "tui",
    ui: TentickleTUI,
  });

  try {
    await tui.start();
  } finally {
    await cronService.stop();
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

function normalizeToGitRoot(): void {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    process.chdir(root);
  } catch {
    // Not in a git repo — stay put
  }
}
