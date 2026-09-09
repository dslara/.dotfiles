import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createProfileCommand } from "./create-profile.js";
import { deleteProfileCommand } from "./delete-profile.js";
import { disableProfileCommand } from "./disable-profile.js";
import { listProfilesCommand } from "./list-profiles.js";
import { showProfileCommand } from "./show-profile.js";
import { useProfileCommand } from "./use-profile.js";

type ProfileCommandEntrypoint = (args: string[], ctx: ExtensionCommandContext) => Promise<void>;

const profileCommandEntrypoints: Record<string, ProfileCommandEntrypoint> = {
  list: listProfilesCommand,
  create: createProfileCommand,
  use: useProfileCommand,
  off: disableProfileCommand,
  delete: deleteProfileCommand,
  show: showProfileCommand,
};

export async function handleProfileCommand(args: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
  const tokens = args?.trim().split(/\s+/).filter(Boolean) ?? [];
  const [command = "list", ...commandArgs] = tokens;
  const entrypoint = profileCommandEntrypoints[command];
  if (!entrypoint) throw new Error(`Usage: /profile [${Object.keys(profileCommandEntrypoints).join("|")}]`);
  await entrypoint(commandArgs, ctx);
}
