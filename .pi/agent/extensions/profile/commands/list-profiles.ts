import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getActiveProfile, listProfileNames } from "../profile-store.js";
import { notify } from "../profile-ui.js";

export async function listProfilesCommand(_args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const activeProfile = await getActiveProfile();
  const profileNames = await listProfileNames();
  const profiles = profileNames.map((name) => `${name}${name === activeProfile ? " (active)" : ""}`);
  notify(ctx, profiles.length > 0 ? profiles.join("\n") : "No Pi profiles exist.");
}
