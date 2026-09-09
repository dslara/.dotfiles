import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pathExists } from "./files.js";
import {
  getProfileDir,
  isRoutedProcess,
  managerDir,
  MANAGER_DIR_ENV,
  ROUTED_ENV,
  validateProfileName,
} from "./profile-config.js";
import { getActiveProfile } from "./profile-store.js";

export async function runPiInProfile(name: string, args: string[]): Promise<number> {
  const invocation = getPiInvocation(isPackageCommand(args) ? args : getProfileLaunchArguments(args));
  const child = spawn(invocation.command, invocation.args, {
    stdio: "inherit",
    env: {
      ...process.env,
      [ROUTED_ENV]: "1",
      [MANAGER_DIR_ENV]: managerDir,
      PI_PROFILE_NAME: name,
      PI_CODING_AGENT_DIR: getProfileDir(name),
    },
  });
  return new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
      resolveExit(code ?? exitCodeForSignal(signal)),
    );
  });
}

export function getProfileLaunchArguments(args: string[]): string[] {
  return ["--extension", fileURLToPath(new URL("./index.ts", import.meta.url)), ...args];
}

export async function routeActiveProfile(): Promise<void> {
  if (isRoutedProcess || hasCliFlag("no-profile")) return;
  const requested = getCliStringFlag("profile");
  const activeProfile = requested || (await getActiveProfile());
  if (!activeProfile || activeProfile === "off") return;
  validateProfileName(activeProfile);
  if (!(await pathExists(getProfileDir(activeProfile)))) {
    throw new Error(`Pi profile "${activeProfile}" does not exist; continuing with the base environment.`);
  }
  process.exit(await runPiInProfile(activeProfile, getCliArgs()));
}

function isPackageCommand(args: string[]): boolean {
  return ["install", "remove", "update"].includes(args[0] ?? "");
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  if (process.versions.bun) return { command: process.execPath, args };
  const entrypoint = process.argv[1];
  if (!entrypoint) throw new Error("Could not determine the current Pi entrypoint.");
  return { command: process.execPath, args: [entrypoint, ...args] };
}

function getCliArgs(): string[] {
  return process.versions.bun ? process.argv.slice(1) : process.argv.slice(2);
}

function hasCliFlag(name: string): boolean {
  return getCliArgs().some((argument) => argument === `--${name}`);
}

function getCliStringFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const args = getCliArgs();
  const inlineValue = args.find((argument) => argument.startsWith(prefix));
  if (inlineValue) return inlineValue.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function exitCodeForSignal(signal: NodeJS.Signals | null): number {
  if (!signal) return 1;
  const signals: Record<string, number> = {
    SIGINT: 130,
    SIGTERM: 143,
    SIGHUP: 129,
  };
  return signals[signal] ?? 1;
}
