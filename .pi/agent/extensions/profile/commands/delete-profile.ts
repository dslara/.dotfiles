import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { deleteProfile, requireInactiveProfile } from "../profile-store.js";
import { confirmProfileDeletion, notify } from "../profile-ui.js";
import { requireArgument } from "./command-helpers.js";

export async function deleteProfileCommand(args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const profileName = requireArgument(args, 0, "Usage: /profile delete <profile_name>");
  await requireInactiveProfile(profileName);
  if (!(await confirmProfileDeletion(profileName, ctx))) return;
  await deleteProfile(profileName);
  notify(ctx, `Deleted profile "${profileName}".`);
}
