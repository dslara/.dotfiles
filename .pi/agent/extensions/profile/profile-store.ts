import { mkdir, readdir } from "node:fs/promises";
import { pathExists, readJson, removePath, writeJson } from "./files.js";
import {
  getProfileDir,
  getProfileSettingsPath,
  getProfilesDir,
  getStatePath,
  isValidProfileName,
  validateProfileName,
} from "./profile-config.js";
import { parseProfileSettings } from "./profile-schema.js";
import type { ProfileSettings, ProfileState } from "./profile-types.js";

export async function readState(): Promise<ProfileState> {
  return readJson(getStatePath(), {});
}

export async function writeState(state: ProfileState): Promise<void> {
  await writeJson(getStatePath(), state);
}

export async function getActiveProfile(): Promise<string | undefined> {
  return (await readState()).activeProfile;
}

export async function requireActiveProfile(): Promise<string> {
  const profileName = await getActiveProfile();
  if (!profileName) throw new Error("No active profile.");
  await requireProfile(profileName);
  return profileName;
}

export async function requireProfile(name: string): Promise<void> {
  validateProfileName(name);
  if (!(await pathExists(getProfileDir(name)))) throw new Error(`Profile ${name} does not exist.`);
}

export async function requireInactiveProfile(name: string): Promise<void> {
  await requireProfile(name);
  if ((await getActiveProfile()) === name) throw new Error("Deactivate the profile before deleting it.");
}

export async function createProfile(name: string): Promise<void> {
  validateProfileName(name);
  const profileDir = getProfileDir(name);
  if (await pathExists(profileDir)) throw new Error(`Profile ${name} already exists.`);
  await mkdir(profileDir, { recursive: true });
  try {
    await writeProfileSettings(name, {});
  } catch (error) {
    await removePath(profileDir);
    throw error;
  }
}

export async function writeProfileSettings(name: string, settings: unknown): Promise<void> {
  await requireProfile(name);
  const parsed = parseProfileSettings(settings, getProfileSettingsPath(name));
  await writeJson(getProfileSettingsPath(name), parsed);
}

export async function readProfileSettings(name: string): Promise<ProfileSettings> {
  await requireProfile(name);
  const path = getProfileSettingsPath(name);
  return parseProfileSettings(await readJson(path), path);
}

export async function listProfileNames(): Promise<string[]> {
  if (!(await pathExists(getProfilesDir()))) return [];
  const profiles: string[] = [];
  for (const entry of await readdir(getProfilesDir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidProfileName(entry.name)) continue;
    profiles.push(entry.name);
  }
  return profiles.sort((left, right) => left.localeCompare(right));
}

export async function deleteProfile(name: string): Promise<void> {
  await removePath(getProfileDir(name));
}
