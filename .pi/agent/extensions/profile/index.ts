/**
 * Profile Extension (issue 08: scaffold + config + seleção).
 *
 * Profiles nomeados em `settings.json` (global + projeto), camada opt-in:
 * sem profile ativo = Pi como hoje. Lê `profiles:{}` mesclado (global→projeto,
 * perfil atômico), resolve `extends` pós-merge e seleciona o profile
 * (`--profile` > escolha da sessão > default de projeto (trusted) > global).
 *
 * Escopo 08: seleção + marcador (footer `setStatus` + `profile-state`).
 * Enforcement das allowlists (tools/skills/prompts/extensions) é issue 09 —
 * ver o ponto `applyEnforcement` abaixo.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  activationError,
  emptyProfileWarning,
  formatVersionLine,
  isCompatiblePiVersion,
  isEmptyProfile,
  mergeProfiles,
  resolveProfile,
  selectStartup,
  unknownProfileError,
  type MergedProfiles,
  type Profile,
} from "./config.js";

/** Manter em sync com package.json. Exibido no seletor/list. */
const EXT_VERSION = "0.1.0";
/** Baseline de compat testada. Mismatch = warning, nunca trava o boot. */
const PI_COMPAT = "0.85.0";

const STATUS_ID = "profile";
const STATE_TYPE = "profile-state";
const NONE_LABEL = "(none)";

/** Leitura + UI (eventos e comandos). Reload só onde a troca exige (use/seletor). */
type ProfileReadCtx = Pick<ExtensionContext, "cwd" | "hasUI" | "isProjectTrusted" | "sessionManager" | "ui">;
type ProfileCmdCtx = ProfileReadCtx & { reload(): Promise<unknown> };

interface SettingsSlice {
  profiles: Record<string, Profile>;
  defaultProfile?: string;
}

interface LoadedConfig {
  merged: MergedProfiles;
  projectDefault?: string;
  globalDefault?: string;
  /** Projeto trusted? (untrusted = `.pi/settings.json` invisível) */
  trusted: boolean;
  warnings: string[];
}

function sanitizeProfiles(raw: unknown, scope: string, warnings: string[]): Record<string, Profile> {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    warnings.push(`Warning: profiles (${scope}) ignorado — esperado objeto.`);
    return {};
  }
  const out: Record<string, Profile> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      warnings.push(`Warning: profile "${name}" (${scope}) ignorado — esperado objeto.`);
      continue;
    }
    const src = value as Record<string, unknown>;
    const clean: Profile = {};
    if (typeof src.description === "string") clean.description = src.description;
    if (typeof src.extends === "string") clean.extends = src.extends;
    else if (src.extends !== undefined) {
      warnings.push(`Warning: extends de "${name}" (${scope}) ignorado — esperado string.`);
    }
    for (const field of ["tools", "skills", "prompts", "extensions"] as const) {
      const v = src[field];
      if (v === undefined) continue;
      if (Array.isArray(v) && v.every((e) => typeof e === "string")) {
        clean[field] = [...(v as string[])];
      } else {
        warnings.push(`Warning: campo ${field} de "${name}" (${scope}) ignorado — esperado string[].`);
      }
    }
    out[name] = clean;
  }
  return out;
}

function sanitizeDefault(raw: unknown, scope: string, warnings: string[]): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string" && raw) return raw;
  warnings.push(`Warning: defaultProfile (${scope}) ignorado — esperado string não-vazia.`);
  return undefined;
}

function readSlice(path: string, scope: string, warnings: string[]): SettingsSlice {
  if (!existsSync(path)) return { profiles: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    warnings.push(`Warning: ${scope} settings.json com JSON inválido — ignorado (${path}).`);
    return { profiles: {} };
  }
  if (typeof parsed !== "object" || parsed === null) {
    warnings.push(`Warning: ${scope} settings.json ignorado — esperado objeto.`);
    return { profiles: {} };
  }
  const obj = parsed as Record<string, unknown>;
  return {
    profiles: sanitizeProfiles(obj.profiles, scope, warnings),
    defaultProfile: sanitizeDefault(obj.defaultProfile, scope, warnings),
  };
}

/**
 * Carrega global + projeto (projeto SOMENTE se trusted) e mescla.
 * Nunca lê `.pi/settings.json` via fs quando untrusted (anti-padrão preset.ts).
 */
function loadConfig(ctx: Pick<ProfileReadCtx, "cwd" | "isProjectTrusted">): LoadedConfig {
  const warnings: string[] = [];
  const trusted = ctx.isProjectTrusted();
  const global = readSlice(join(getAgentDir(), "settings.json"), "global", warnings);
  const project = trusted
    ? readSlice(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"), "projeto", warnings)
    : { profiles: {} as Record<string, Profile>, defaultProfile: undefined };
  return {
    merged: mergeProfiles(global.profiles, project.profiles, trusted),
    projectDefault: project.defaultProfile,
    globalDefault: global.defaultProfile,
    trusted,
    warnings,
  };
}

/** Melhor esforço: versão do Pi em execução (package resolvido ou lastChangelogVersion). */
function detectPiVersion(): string | undefined {
  try {
    const req = createRequire(join(getAgentDir(), "noop.js"));
    const pkgPath = req.resolve("@earendil-works/pi-coding-agent/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version) return pkg.version;
  } catch {
    // invisível no binário compilado — tenta o plano B
  }
  try {
    const settings = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf-8")) as {
      lastChangelogVersion?: unknown;
    };
    if (typeof settings.lastChangelogVersion === "string" && settings.lastChangelogVersion) {
      return settings.lastChangelogVersion;
    }
  } catch {
    // sem sinal — sem warning espúrio
  }
  return undefined;
}

function versionLine(): string {
  return formatVersionLine(EXT_VERSION, PI_COMPAT);
}

/** Última escolha explícita da sessão (`profile-state`); null = `(none)` explícito. */
function readSessionChoice(ctx: ProfileReadCtx): { present: boolean; name: string | null } {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as { type?: string; customType?: string; data?: { name?: unknown } };
    if (e?.type === "custom" && e.customType === STATE_TYPE) {
      return { present: true, name: typeof e.data?.name === "string" ? e.data.name : null };
    }
  }
  return { present: false, name: null };
}

export default function profileExtension(pi: ExtensionAPI) {
  /** Nome ativo nesta instância (pós-reload, restaurado via `profile-state`). */
  let activeName: string | null = null;

  pi.registerFlag("profile", {
    description: "Profile nomeado a ativar (profiles em settings.json)",
    type: "string",
  });

  function setMarker(ctx: ProfileReadCtx, name: string | null): void {
    activeName = name;
    ctx.ui.setStatus(STATUS_ID, name ? `profile:${name}` : undefined);
  }

  // Issue 09: aplicar allowlists aqui (setActiveTools + gates). Em 08, seleção
  // pura: só registra o nome + marcador, sem tocar em tools/skills/prompts.
  function applyEnforcement(_name: string): void {
    // noop em 08
  }

  function checkCompat(ctx: ProfileReadCtx): void {
    const running = detectPiVersion();
    if (running && !isCompatiblePiVersion(running, PI_COMPAT)) {
      ctx.ui.notify(
        `Warning: profile ${versionLine()} — Pi atual é ${running}; compatibilidade não garantida, seguindo sem travar.`,
        "warning",
      );
    }
  }

  /** Ativa um profile já escolhido (flag, default ou restore). Erro = fallback sem-profile. */
  function activateResolved(ctx: ProfileReadCtx, loaded: LoadedConfig, name: string, originNote: string | null): void {
    const r = resolveProfile(loaded.merged.map, name);
    if (!r.ok) {
      setMarker(ctx, null);
      ctx.ui.notify(activationError(r.message), originNote === "--profile" ? "warning" : "error");
      return;
    }
    if (isEmptyProfile(r.profile)) ctx.ui.notify(emptyProfileWarning(), "warning");
    setMarker(ctx, name);
    applyEnforcement(name);
    if (originNote) ctx.ui.notify(`Profile "${name}" ativo (${originNote}).`, "info");
  }

  pi.on("session_start", async (_event, ctx) => {
    const loaded = loadConfig(ctx);
    for (const w of loaded.warnings) ctx.ui.notify(w, "warning");
    // Opt-in total: sem profiles definidos, nenhum aviso (só checa compat para quem usa).
    if (Object.keys(loaded.merged.map).length > 0) checkCompat(ctx);

    const flag = pi.getFlag("profile");
    const flagName = typeof flag === "string" && flag ? flag : undefined;
    const choice = readSessionChoice(ctx);
    const { want } = selectStartup({
      flag: flagName,
      restored: choice.name,
      restoredPresent: choice.present,
      projectDefault: loaded.projectDefault,
      globalDefault: loaded.globalDefault,
    });

    if (!want) {
      setMarker(ctx, null);
      return;
    }
    // Restore silencioso (o `use` já avisou antes do reload); flag/default avisam.
    const originNote = flagName
      ? "--profile"
      : choice.present
        ? null
        : want === loaded.projectDefault
          ? "default do projeto"
          : "default global";
    activateResolved(ctx, loaded, want, originNote);
  });

  pi.on("turn_start", async () => {
    if (activeName) pi.appendEntry(STATE_TYPE, { name: activeName });
  });

  function formatProfileLine(name: string, loaded: LoadedConfig): string {
    const p = loaded.merged.map[name];
    const desc = p?.description ? ` — ${p.description}` : "";
    const origin = loaded.merged.origins[name];
    const active = name === activeName ? " (ativo)" : "";
    return `${name}${desc} [${origin}]${active}`;
  }

  function listText(loaded: LoadedConfig): string {
    const scope = loaded.trusted ? "global+projeto" : "só global (projeto untrusted)";
    const names = Object.keys(loaded.merged.map).sort();
    const lines = [`Profiles (${versionLine()}) — ${scope}:`];
    if (names.length === 0) lines.push("(nenhum profile definido)");
    else for (const n of names) lines.push(`- ${formatProfileLine(n, loaded)}`);
    return lines.join("\n");
  }

  /** Persiste a escolha explícita e recarrega in-place (terminal no handler). */
  async function persistChoiceAndReload(
    ctx: ProfileCmdCtx,
    name: string | null,
    message: string,
    level: "info" | "warning" | "error",
  ): Promise<void> {
    setMarker(ctx, name);
    pi.appendEntry(STATE_TYPE, { name });
    const n = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${message} Reload in-place — conversa preservada (${n} entradas).`, level);
    await ctx.reload();
    return;
  }

  /** `use` = valida → persiste escolha → reload in-place (terminal no handler). */
  async function useProfile(ctx: ProfileCmdCtx, name: string | null): Promise<void> {
    if (name === null) {
      await persistChoiceAndReload(ctx, null, "Profile desativado — Pi como hoje.", "info");
      return;
    }
    const loaded = loadConfig(ctx);
    const r = resolveProfile(loaded.merged.map, name);
    if (!r.ok) {
      await persistChoiceAndReload(ctx, null, activationError(r.message), "error");
      return;
    }
    if (isEmptyProfile(r.profile)) ctx.ui.notify(emptyProfileWarning(), "warning");
    await persistChoiceAndReload(ctx, name, `Profile "${name}" ativo.`, "info");
    return;
  }

  function showProfile(ctx: ProfileReadCtx, name: string): void {
    const loaded = loadConfig(ctx);
    const raw = loaded.merged.map[name];
    if (!raw) {
      ctx.ui.notify(unknownProfileError(name, Object.keys(loaded.merged.map).sort()), "error");
      return;
    }
    const r = resolveProfile(loaded.merged.map, name);
    if (!r.ok) {
      // Quebrado também no show: exibe o erro sem aplicar nada.
      ctx.ui.notify(r.message, "error");
      return;
    }
    const lines = [`profile ${name} [${loaded.merged.origins[name]}] (resolvido, sem aplicar):`];
    lines.push(JSON.stringify(r.profile, null, 2));
    if (isEmptyProfile(r.profile)) lines.push(emptyProfileWarning());
    for (const w of loaded.warnings) lines.push(w);
    ctx.ui.notify(lines.join("\n"), "info");
  }

  async function showSelector(ctx: ProfileCmdCtx, loaded: LoadedConfig): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify(listText(loaded), "info");
      return;
    }
    const names = Object.keys(loaded.merged.map).sort();
    const labelByName = new Map<string, string>();
    const items: string[] = names.map((n) => {
      const label = formatProfileLine(n, loaded);
      labelByName.set(label, n);
      return label;
    });
    items.push(NONE_LABEL);
    const picked = await ctx.ui.select(`Select profile (${versionLine()})`, items);
    if (!picked) return;
    if (picked === NONE_LABEL) {
      await useProfile(ctx, null);
      return;
    }
    const name = labelByName.get(picked);
    if (name) await useProfile(ctx, name);
  }

  /** Completions não têm ctx: lê só o global (sugestão; o merge real acontece no handler). */
  function globalNamesForCompletion(): string[] {
    try {
      const warnings: string[] = [];
      const global = readSlice(join(getAgentDir(), "settings.json"), "global", warnings);
      return Object.keys(global.profiles);
    } catch {
      return [];
    }
  }

  pi.registerCommand("profile", {
    description: "Selecionar profile nomeado (list/show/use)",
    getArgumentCompletions: (prefix: string) => {
      const space = prefix.indexOf(" ");
      if (space === -1) {
        const out = ["list", "show", "use", ...globalNamesForCompletion()]
          .filter((v) => v.startsWith(prefix))
          .map((v) => ({ value: v, label: v }));
        return out.length > 0 ? out : null;
      }
      const first = prefix.slice(0, space);
      const rest = prefix.slice(space + 1);
      if (first === "show" || first === "use") {
        const names = globalNamesForCompletion().filter((n) => n.startsWith(rest));
        return names.length > 0 ? names.map((v) => ({ value: `${first} ${v}`, label: v })) : null;
      }
      return null;
    },
    handler: async (args, ctx) => {
      const ctxp = ctx;
      const loaded = loadConfig(ctxp);
      const text = args.trim();
      if (!text) {
        await showSelector(ctxp, loaded);
        return;
      }
      const [sub, ...rest] = text.split(/\s+/);
      const target = rest.join(" ");
      if (sub === "list" && !target) {
        ctx.ui.notify(listText(loaded), "info");
        return;
      }
      if (sub === "show" && target) {
        showProfile(ctxp, target.split(/\s+/)[0]);
        return;
      }
      if (sub === "use" && target) {
        const name = target.split(/\s+/)[0];
        await useProfile(ctxp, name === NONE_LABEL ? null : name);
        return;
      }
      // Atalho: `/profile <nome>` = use; `(none)` = limpar.
      if (!target && loaded.merged.map[sub]) {
        await useProfile(ctxp, sub);
        return;
      }
      if (!target && sub === NONE_LABEL) {
        await useProfile(ctxp, null);
        return;
      }
      ctx.ui.notify(`Uso: /profile · /profile list · /profile show <nome> · /profile use <nome|${NONE_LABEL}>`, "error");
    },
  });
}
