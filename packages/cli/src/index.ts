import { Command } from "commander";
import { launchGateway, type GatewayPlugin } from "@tentickle/tui";
import { TelegramPlugin } from "@agentick/connector-telegram";

const AGENTS: Record<string, () => Promise<(opts: any) => Promise<any>>> = {
  main: () => import("@tentickle/main").then((m) => m.createMainApp),
  coding: () => import("@tentickle/coding").then((m) => m.createCodingApp),
};

export function run(argv = process.argv): void {
  const program = new Command()
    .name("tentickle")
    .description("Autonomous coding agent built on agentick")
    .version("0.0.3")
    .option("--agent <name>", `default agent for TUI (${Object.keys(AGENTS).join(", ")})`, "main")
    .option("--max-ticks <n>", "maximum model calls per execution", "250")
    .option("--no-devtools", "disable devtools server")
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
      });
    });

  program.parse(argv);
}
