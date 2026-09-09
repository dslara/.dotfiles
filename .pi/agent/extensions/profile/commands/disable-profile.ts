import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { writeState } from "../profile-store.js";
import { notify } from "../profile-ui.js";

export async function disableProfileCommand(_args: string[], ctx: ExtensionCommandContext): Promise<void> {
  await writeState({});
  notify(ctx, "Profile routing disabled. Pi will now exit; start Pi again to return to the base environment.");
  ctx.shutdown();
}
