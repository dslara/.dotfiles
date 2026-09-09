import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join, resolve } from "node:path";

export const ROUTED_ENV = "PI_PROFILE_ROUTED";
export const MANAGER_DIR_ENV = "PI_PROFILE_MANAGER_DIR";
export const PROFILES_DIR_NAME = "profiles";
export const STATE_FILE = "state.json";

const currentAgentDir = resolve(getAgentDir());

export const managerDir = resolve(
  process.env[MANAGER_DIR_ENV] ?? join(dirname(currentAgentDir), PROFILES_DIR_NAME),
);
export const isRoutedProcess = process.env[ROUTED_ENV] === "1";

export function getProfilesDir(): string {
  return managerDir;
}

export function getProfileDir(name: string): string {
  return join(managerDir, name);
}

export function getProfileSettingsPath(name: string): string {
  return join(getProfileDir(name), "settings.json");
}

export function getStatePath(): string {
  return join(managerDir, STATE_FILE);
}

export function validateProfileName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error("Profile names may contain only letters, numbers, hyphens, and underscores.");
  }
}
