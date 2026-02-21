import { Command } from "commander";
import { launchGateway, type GatewayPlugin } from "@tentickle/tui";
import { TelegramPlugin } from "@agentick/connector-telegram";
import {
  startDaemon,
  stopDaemon,
  daemonStatus,
  runDaemonProcess,
  getSocketPath,
} from "./daemon.js";

const AGENTS: Record<string, () => Promise<(opts: any) => Promise<any>>> = {
  main: () => import("@tentickle/main").then((m) => m.createMainApp),
  coding: () => import("@tentickle/coding").then((m) => m.createCodingApp),
};

export function run(argv = process.argv): void {
  const program = new Command()
    .name("tentickle")
    .description("Autonomous coding agent built on agentick")
    .version("0.0.3");

  // ── Default command: TUI (auto: daemon → in-process fallback) ──────
  program
    .option("--agent <name>", `default agent for TUI (${Object.keys(AGENTS).join(", ")})`, "main")
    .option("--max-ticks <n>", "maximum model calls per execution", "250")
    .option("--no-devtools", "disable devtools server")
    .option("--url <ws-url>", "connect to remote daemon (ws://host:port)")
    .action(async (opts) => {
      if (!AGENTS[opts.agent]) {
        console.error(`Unknown agent: ${opts.agent}\nAvailable: ${Object.keys(AGENTS).join(", ")}`);
        process.exit(1);
      }

      // Load all agent modules and build factory map
      const apps: Record<string, (o: any) => Promise<any>> = {};
      for (const [name, loader] of Object.entries(AGENTS)) {
        apps[name] = await loader();
      }

      // Build plugins from env vars
      const plugins: GatewayPlugin[] = [];
      if (process.env.TELEGRAM_BOT_TOKEN) {
        plugins.push(
          new TelegramPlugin({
            token: process.env.TELEGRAM_BOT_TOKEN,
            allowedUsers: process.env.TELEGRAM_ALLOWED_USERS?.split(",")
              .map(Number)
              .filter(Boolean),
            chatId: process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : undefined,
          }),
        );
      }

      await launchGateway({
        apps,
        defaultAgent: opts.agent,
        maxTicks: parseInt(opts.maxTicks, 10),
        devTools: opts.devtools,
        plugins,
        daemonUrl: opts.url,
      });
    });

  // ── tentickle start ────────────────────────────────────────────────
  program
    .command("start")
    .description("Start the daemon (background gateway process)")
    .option("--foreground", "run in foreground (for debugging)")
    .option("--agent <name>", "default agent", "main")
    .option("--max-ticks <n>", "maximum model calls per execution", "250")
    .option("--no-devtools", "disable devtools server")
    .option("--port <n>", "WebSocket port (enables network access)")
    .option("--host <addr>", "bind address (default: 0.0.0.0)")
    .option("--log-file <path>", "daemon log file (default: ~/.tentickle/daemon.log)")
    .option("--daemon-child", "internal: marks this process as the forked daemon child")
    .action(async (opts) => {
      if (opts.daemonChild) {
        // We're the forked background child — run the gateway directly
        const socketPath = getSocketPath();
        await runDaemonProcess(
          socketPath,
          {
            ...opts,
            maxTicks: parseInt(opts.maxTicks, 10),
            port: opts.port ? parseInt(opts.port, 10) : undefined,
          },
          AGENTS,
        );
        return;
      }

      await startDaemon(
        {
          foreground: opts.foreground,
          agent: opts.agent,
          maxTicks: parseInt(opts.maxTicks, 10),
          devTools: opts.devtools,
          logFile: opts.logFile,
          port: opts.port ? parseInt(opts.port, 10) : undefined,
          host: opts.host,
        },
        AGENTS,
      );
    });

  // ── tentickle stop ─────────────────────────────────────────────────
  program
    .command("stop")
    .description("Stop the running daemon")
    .action(async () => {
      await stopDaemon();
    });

  // ── tentickle status ───────────────────────────────────────────────
  program
    .command("status")
    .description("Check if daemon is running")
    .action(async () => {
      const status = await daemonStatus();
      if (status.running) {
        console.log(`Daemon running (pid ${status.pid})`);
        console.log(`Socket: ${status.socketPath}`);
        if (status.logFile) console.log(`Log: ${status.logFile}`);
      } else {
        console.log("Daemon not running");
      }
    });

  program.parse(argv);
}
