/**
 * Daemon Lifecycle
 *
 * Manages the tentickle daemon process — a background gateway
 * that TUI clients connect to over a Unix domain socket.
 *
 * Socket file security: The Unix domain socket at ~/.tentickle/daemon.sock
 * inherits the user's umask permissions. Any process running as the same
 * user (or root) can connect. This is intentional for local development.
 * For shared machines, ensure ~/.tentickle/ has restrictive permissions
 * (chmod 700) to prevent other users from connecting.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  openSync,
  closeSync,
  statSync,
} from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import type { GatewayPlugin } from "@agentick/gateway";

const TENTICKLE_DIR = join(homedir(), ".tentickle");
const DEFAULT_SOCKET_PATH = join(TENTICKLE_DIR, "daemon.sock");
const DEFAULT_LOG_FILE = join(TENTICKLE_DIR, "daemon.log");
const PID_FILE = join(TENTICKLE_DIR, "daemon.pid");

export function getSocketPath(): string {
  return process.env.TENTICKLE_SOCKET ?? DEFAULT_SOCKET_PATH;
}

export interface DaemonOptions {
  foreground?: boolean;
  agent?: string;
  maxTicks?: number;
  devTools?: boolean;
  logFile?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  socketPath?: string;
  logFile?: string;
}

// ============================================================================
// Start
// ============================================================================

export async function startDaemon(
  opts: DaemonOptions,
  appFactories: Record<string, () => Promise<(o: any) => Promise<any>>>,
): Promise<void> {
  ensureDir();

  const socketPath = getSocketPath();

  // Clean up stale state before checking status
  cleanupStaleSocket(socketPath);

  const status = await daemonStatus();
  if (status.running) {
    console.log(`Daemon already running (pid ${status.pid})`);
    return;
  }

  if (opts.foreground) {
    await runDaemonProcess(socketPath, opts, appFactories);
  } else {
    spawnBackground(socketPath, opts);
  }
}

/**
 * Run the gateway in the current process (foreground mode).
 * Also used by the forked background child.
 */
export async function runDaemonProcess(
  socketPath: string,
  opts: DaemonOptions,
  appFactories: Record<string, () => Promise<(o: any) => Promise<any>>>,
): Promise<void> {
  const { createGateway } = await import("@agentick/gateway");
  const { bindSessionStore, bindMemory } = await import("@tentickle/agent");
  const { CronService, bindSchedulerStore } = await import("@agentick/scheduler");
  const { createClient } = await import("@agentick/client");
  const { TelegramPlugin } = await import("@agentick/connector-telegram");

  const defaultAgent = opts.agent ?? "main";
  const maxTicks = opts.maxTicks ?? 250;
  const devTools = opts.devTools ?? false;

  if (devTools) {
    const { startDevToolsServer } = await import("@agentick/devtools");
    startDevToolsServer();
  }

  // Build all apps
  const gatewayApps: Record<string, any> = {};

  for (const [name, loader] of Object.entries(appFactories)) {
    const factory = await loader();
    const { app, store, memory } = await factory({ devTools, maxTicks });
    gatewayApps[name] = app;

    if (name === defaultAgent) {
      bindSessionStore(store);
      if (memory) bindMemory(memory);
    }
  }

  // Build plugins
  const plugins: GatewayPlugin[] = [];
  if (process.env.TELEGRAM_BOT_TOKEN) {
    plugins.push(
      new TelegramPlugin({
        token: process.env.TELEGRAM_BOT_TOKEN,
        allowedUsers: process.env.TELEGRAM_ALLOWED_USERS?.split(",").map(Number).filter(Boolean),
        chatId: process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : undefined,
      }),
    );
  }

  // Create gateway with Unix socket
  const gateway = createGateway({
    apps: gatewayApps,
    defaultApp: defaultAgent,
    socketPath,
    plugins,
  });

  // Cron via local transport
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

  // Start the gateway (opens unix socket)
  await gateway.start();

  // Secure the socket directory
  try {
    chmodSync(TENTICKLE_DIR, 0o700);
  } catch {
    // Non-fatal — log and continue
  }

  // Write pidfile
  writePid(process.pid);
  console.log(`Daemon started on ${socketPath} (pid ${process.pid})`);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("\nDaemon shutting down...");
    try {
      await cronService.stop();
    } catch (e) {
      console.error("Error stopping cron:", e);
    }
    try {
      await gateway.stop();
    } catch (e) {
      console.error("Error stopping gateway:", e);
    }
    cleanupPid();
    cleanupStaleSocket(socketPath);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Catch uncaught errors so daemon doesn't silently die
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception in daemon:", error);
    shutdown();
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection in daemon:", reason);
  });

  // Keep the process alive
  await new Promise(() => {});
}

/**
 * Fork a child process to run the daemon in the background.
 * Stdout/stderr are redirected to a log file so daemon output
 * isn't lost when detached from the terminal.
 */
function spawnBackground(socketPath: string, opts: DaemonOptions): void {
  const logFile = opts.logFile ?? DEFAULT_LOG_FILE;

  const args = ["--daemon-child"];
  if (opts.agent) args.push("--agent", opts.agent);
  if (opts.maxTicks) args.push("--max-ticks", String(opts.maxTicks));
  if (opts.devTools) args.push("--devtools");

  // Open log file for stdout/stderr
  let logFd: number;
  try {
    ensureDir();
    logFd = openSync(logFile, "a");
  } catch (error) {
    console.error(`Failed to open log file ${logFile}:`, error);
    console.error("Falling back to /dev/null");
    logFd = openSync("/dev/null", "w");
  }

  const child: ChildProcess = fork(process.argv[1], ["start", ...args], {
    detached: true,
    stdio: ["ignore", logFd, logFd, "ipc"],
    env: { ...process.env, TENTICKLE_SOCKET: socketPath },
  });

  // Wait briefly to check if the child exits immediately (startup failure)
  let exitedEarly = false;
  child.on("exit", (code) => {
    exitedEarly = true;
    if (code !== 0) {
      console.error(`Daemon failed to start (exit code ${code}). Check logs: ${logFile}`);
    }
  });

  // Disconnect IPC so parent can exit freely
  child.disconnect();
  child.unref();

  // Close our copy of the log fd
  closeSync(logFd);

  // Brief delay to catch immediate startup failures
  setTimeout(() => {
    if (exitedEarly) return;
    console.log(`Daemon started in background (pid ${child.pid})`);
    console.log(`Socket: ${socketPath}`);
    console.log(`Log: ${logFile}`);
  }, 200);
}

// ============================================================================
// Stop
// ============================================================================

export async function stopDaemon(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log("No daemon running (no pidfile)");
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log(`Stale pidfile (pid ${pid} not running). Cleaning up.`);
    cleanupPid();
    cleanupStaleSocket(getSocketPath());
    return;
  }

  console.log(`Stopping daemon (pid ${pid})...`);
  process.kill(pid, "SIGTERM");

  // Wait for exit with timeout
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (!isProcessAlive(pid)) {
      console.log("Daemon stopped.");
      cleanupPid();
      cleanupStaleSocket(getSocketPath());
      return;
    }
  }

  // Force kill
  console.log("Daemon did not exit gracefully. Sending SIGKILL.");
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
  cleanupPid();
  cleanupStaleSocket(getSocketPath());
}

// ============================================================================
// Status
// ============================================================================

export async function daemonStatus(): Promise<DaemonStatus> {
  const pid = readPid();
  if (!pid) {
    return { running: false };
  }

  if (!isProcessAlive(pid)) {
    // Stale pidfile — clean up
    cleanupPid();
    cleanupStaleSocket(getSocketPath());
    return { running: false };
  }

  const logFile = DEFAULT_LOG_FILE;

  return {
    running: true,
    pid,
    socketPath: getSocketPath(),
    logFile: existsSync(logFile) ? logFile : undefined,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function ensureDir(): void {
  if (!existsSync(TENTICKLE_DIR)) {
    mkdirSync(TENTICKLE_DIR, { recursive: true, mode: 0o700 });
  }
}

function writePid(pid: number): void {
  ensureDir();
  writeFileSync(PID_FILE, String(pid));
}

function readPid(): number | null {
  try {
    const content = readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function cleanupPid(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a stale socket file if no daemon is listening on it.
 * The Unix socket transport also does this on start(), but
 * cleaning up here prevents confusing state for the user.
 */
function cleanupStaleSocket(socketPath: string): void {
  try {
    const stat = statSync(socketPath);
    if (stat.isSocket()) {
      // Socket file exists but no daemon is running (checked by caller)
      unlinkSync(socketPath);
    }
  } catch {
    // File doesn't exist — nothing to clean
  }
}
