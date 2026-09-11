import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readProfileSettings, requireActiveProfile } from "../profile-store.js";
import { notify } from "../profile-ui.js";

export async function showProfileCommand(args: string[], ctx: ExtensionCommandContext): Promise<void> {
  const profileName = args[0] ?? (await requireActiveProfile());
  const settings = await readProfileSettings(profileName);
  notify(ctx, JSON.stringify(settings, null, 2));
}
