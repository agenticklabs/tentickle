import { resolve } from "node:path";
import type { SlashCommand } from "@agentick/tui";
import { getSandbox } from "../../sandbox-ref.js";

export function addDirCommand(): SlashCommand {
  return {
    name: "add-dir",
    description: "Mount a directory into the sandbox",
    aliases: ["mount"],
    args: "<path>",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!input) {
        ctx.output("Usage: /add-dir <path>");
        return;
      }

      const sandbox = getSandbox();
      if (!sandbox) {
        ctx.output("Sandbox not available yet.");
        return;
      }

      const hostPath = resolve(input);

      try {
        await sandbox.addMount({ host: hostPath, sandbox: hostPath, mode: "rw" });
        ctx.output(`Mounted: ${hostPath}`);
      } catch (err: any) {
        ctx.output(`Failed: ${err.message}`);
      }
    },
  };
}
