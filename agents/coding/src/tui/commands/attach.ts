import type { SlashCommand } from "@agentick/tui";
import type { Attachment, AttachmentInput } from "@agentick/client";
import { attachFile } from "../attach-file.js";

export function attachCommand(addAttachment: (input: AttachmentInput) => Attachment): SlashCommand {
  return {
    name: "attach",
    description: "Attach a file (image or PDF)",
    args: "<path>",
    handler: async (args, ctx) => {
      const filePath = args.trim();
      if (!filePath) {
        ctx.output("Usage: /attach <path>");
        return;
      }

      const result = await attachFile(filePath, addAttachment);
      if (result.ok) {
        ctx.output(`Attached: ${result.attachment.name}`);
      } else {
        ctx.output(`Failed: ${result.reason}`);
      }
    },
  };
}
