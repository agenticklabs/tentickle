import { createTool, type ToolClass } from "@agentick/core";
import { useSandbox } from "@agentick/sandbox";
import { z } from "zod";
import { resolve } from "node:path";

export const AddDirCommand: ToolClass = createTool({
  name: "add-dir",
  description: "Mount a directory into the sandbox",
  input: z.object({ path: z.string().describe("Directory path to mount") }),
  audience: "user",
  aliases: ["mount"],
  use() {
    return { sandbox: useSandbox() };
  },
  handler: async ({ path: dirPath }, deps) => {
    const resolved = resolve(dirPath.trim());
    await deps!.sandbox.addMount({ host: resolved, sandbox: resolved, mode: "rw" });
    return [{ type: "text" as const, text: `Mounted: ${resolved}` }];
  },
});
