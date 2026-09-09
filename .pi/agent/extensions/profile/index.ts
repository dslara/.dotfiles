import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleProfileCommand } from "./commands/index.js";

export default function profileExtension(pi: ExtensionAPI): void {
  pi.registerCommand("profile", {
    description: "Manage isolated Pi profiles",
    handler: async (args, ctx) => {
      try {
        await handleProfileCommand(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "error");
      }
    },
  });
}
