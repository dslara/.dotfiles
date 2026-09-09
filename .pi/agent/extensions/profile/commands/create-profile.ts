import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createProfile } from "../profile-store.js";
import { notify } from "../profile-ui.js";
import { requireArgument } from "./command-helpers.js";

export async function createProfileCommand(args: string[], ctx: ExtensionContext): Promise<void> {
  const profileName = requireArgument(args, 0, "Usage: /profile create <profile_name>");
  await createProfile(profileName);
  notify(ctx, `Created profile "${profileName}". Use /profile use ${profileName} to activate it.`);
}
