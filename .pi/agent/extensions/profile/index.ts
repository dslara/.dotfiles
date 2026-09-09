import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleProfileCommand } from "./commands/index.js";
import { isRoutedProcess } from "./profile-config.js";
import { routeActiveProfile } from "./profile-runtime.js";

export default async function profileExtension(pi: ExtensionAPI): Promise<void> {
  registerProfileFlags(pi);
  await routeProfileProcess(pi);
  registerProfileCommand(pi);
  registerProfileStatus(pi);
}

function registerProfileFlags(pi: ExtensionAPI): void {
  pi.registerFlag("profile", {
    description: "Start Pi with a profile",
    type: "string",
  });
  pi.registerFlag("no-profile", {
    description: "Do not route through the active Pi profile",
    type: "boolean",
  });
}

async function routeProfileProcess(pi: ExtensionAPI): Promise<void> {
  try {
    await routeActiveProfile();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Profile routing skipped: ${message}\n`);
  }
}

function registerProfileCommand(pi: ExtensionAPI): void {
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

function registerProfileStatus(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!isRoutedProcess) return;
    const profileName = process.env.PI_PROFILE_NAME;
    if (profileName) ctx.ui.setStatus("pi-profile", `profile: ${profileName}`);
  });
}
