import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { requireProfile, writeState } from "../profile-store.js";
import { notify } from "../profile-ui.js";
import { requireArgument } from "./command-helpers.js";

export async function useProfileCommand(args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const profileName = requireArgument(args, 0, "Usage: /profile use <profile_name>");
  await requireProfile(profileName);
  await writeState({ activeProfile: profileName });
  notify(ctx, `Profile "${profileName}" selected. Pi will now exit; start Pi again to use it.`);
  ctx.shutdown();
}
