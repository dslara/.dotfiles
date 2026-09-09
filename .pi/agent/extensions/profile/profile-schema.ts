import type { ProfileSettings } from "./profile-types.js";

/**
 * Hand validation for a profile settings file. A shareable profile is any
 * plain Pi settings object; only the packages shape is checked, everything
 * else passes through untouched.
 */
export function parseProfileSettings(value: unknown, source: string): ProfileSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid profile settings from ${source}: root: expected object.`);
  }
  const obj = value as Record<string, unknown>;
  if (obj.packages !== undefined) {
    if (!Array.isArray(obj.packages)) {
      throw new Error(`Invalid profile settings from ${source}: packages: expected array.`);
    }
    for (const entry of obj.packages) {
      if (typeof entry === "string") continue;
      if (
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).source === "string"
      ) {
        continue;
      }
      throw new Error(
        `Invalid profile settings from ${source}: packages: entries must be strings or objects with a string source.`,
      );
    }
  }
  return obj as ProfileSettings;
}
