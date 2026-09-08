/**
 * Profile Extension (issues 08+09+10).
 *
 * Profiles nomeados em `settings.json` (global + projeto), camada opt-in:
 * sem profile ativo = Pi como hoje. Lê `profiles:{}` mesclado (global→projeto,
 * perfil atômico), resolve `extends` pós-merge, seleciona o profile
 * (`--profile` > escolha da sessão > default de projeto (trusted) > global)
 * e aplica as allowlists (tools via `setActiveTools` + backstop `tool_call`;
 * skills/prompts via `input` + filtro no system prompt; gate de extensões).
 * Troca = reload in-place com marcador triplo (footer + `profile-state` +
 * carimbo `profile-mark`). Detalhes em README.md; problemas em
 * TROUBLESHOOTING.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Box, Container, SettingsList, Text, type SettingItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  activationError,
  applyBuilderChange,
  builderInitial,
  builderResult,
  BUILDER_RESOURCES,
  emptyProfileWarning,
  formatVersionLine,
  isCompatiblePiVersion,
  isEmptyProfile,
  mergeProfiles,
  nonBlockableExtensionsWarning,
  normalizeSkillName,
  parseCliToolFlags,
  planField,
  planTools,
  filterSkillMentions,
  inventoryOrigin,
  isValidProfileName,
  knownExtensionOwners,
  resolveProfile,
  saveProfileToFile,
  selectStartup,
  toolOwnerName,
  unknownFieldWarning,
  unknownProfileError,
  type CliToolFlags,
  type BuilderResource,
  type BuilderState,
  type MergedProfiles,
  type Profile,
  type ResolvedProfile,
  type ToolInventoryEntry,
  type ToolSourceInfo,
} from "./config.js";

/** Manter em sync com package.json. Exibido no seletor/list. */
const EXT_VERSION = "0.3.0";
/** Baseline de compat testada. Mismatch = warning, nunca trava o boot. */
const PI_COMPAT = "0.85.0";

const STATUS_ID = "profile";
const STATE_TYPE = "profile-state";
const MARK_TYPE = "profile-mark";
const NONE_LABEL = "(none)";
const TOOL_NAME = "profile_use";

/** Leitura + UI (eventos e comandos). Reload só onde a troca exige (use/seletor). */
type ProfileReadCtx = Pick<ExtensionContext, "cwd" | "hasUI" | "isProjectTrusted" | "mode" | "sessionManager" | "ui">;
type ProfileCmdCtx = ProfileReadCtx & { reload(): Promise<unknown> };

/** Comando registrado por extensão (inventário de skills/prompts/comandos). */
interface CommandInventoryEntry {
  name: string;
  source: string;
  sourceInfo: ToolSourceInfo;
}

/** Gates ativos do profile em vigor (null = sem profile = Pi como hoje). */
interface EnforcementState {
  profileName: string;
  toolsTouched: boolean;
  finalTools: string[];
  skillsTouched: boolean;
  allowedSkills: string[];
  inventorySkills: string[];
  promptsTouched: boolean;
  allowedPrompts: string[];
  promptNames: string[];
}

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
  /** Gates em vigor (issue 09). null = sem profile ativo = Pi como hoje. */
  let enforcement: EnforcementState | null = null;

  pi.registerFlag("profile", {
    description: "Profile nomeado a ativar (profiles em settings.json)",
    type: "string",
  });

  // Carimbo no transcript (marcador triplo, espec §5): rende `profile-mark` no TUI,
  // persiste na sessão, fora do contexto do LLM.
  pi.registerEntryRenderer(MARK_TYPE, (entry, _options, theme) => {
    const data = (entry as { data?: { name?: unknown; entries?: unknown } }).data ?? {};
    const label =
      typeof data.name === "string" && data.name ? `Profile: ${data.name}` : "Profile desativado — Pi como hoje";
    const n = typeof data.entries === "number" ? data.entries : "?";
    const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
    box.addChild(new Text(`${theme.bold(label)} — reload in-place, conversa preservada (${String(n)} entradas)`));
    return box;
  });

  // Ferramenta do LLM para trocar de profile (molde reload-runtime.ts): enfileira
  // `/profile use` como follow-up. Obedece ao profile vigente como qualquer tool.
  pi.registerTool({
    name: TOOL_NAME,
    label: "Switch profile",
    description:
      "Switch the active Pi profile. Use /profile list for names; \"(none)\" clears back to plain Pi. Queues /profile use as a follow-up command (in-place reload, conversation preserved).",
    parameters: Type.Object({
      name: Type.String({ description: "Profile name from /profile list, or (none) to clear" }),
    }),
    async execute(_toolCallId, params) {
      const raw = params.name;
      const name = typeof raw === "string" ? raw.trim().split(/\s+/)[0] : "";
      if (!name || (name !== NONE_LABEL && !/^[A-Za-z0-9._-]+$/.test(name))) {
        return {
          content: [{ type: "text", text: `Invalid profile name: ${JSON.stringify(raw)}. Use /profile list for names.` }],
          details: {},
        };
      }
      pi.sendUserMessage(`/profile use ${name}`, { deliverAs: "followUp" });
      return {
        content: [{ type: "text", text: `Queued /profile use ${name} as a follow-up command.` }],
        details: {},
      };
    },
  });

  function setMarker(ctx: ProfileReadCtx, name: string | null): void {
    activeName = name;
    if (name === null) enforcement = null;
    ctx.ui.setStatus(STATUS_ID, name ? `profile:${name}` : undefined);
  }

  function collectTools(): ToolInventoryEntry[] {
    return pi.getAllTools().map((t) => ({
      name: t.name,
      owner: toolOwnerName(t.sourceInfo as ToolSourceInfo),
      builtin: (t.sourceInfo as { source: string }).source === "builtin",
    }));
  }

  function collectCommands(): CommandInventoryEntry[] {
    return pi.getCommands().map((c) => ({
      name: c.name,
      source: c.source,
      sourceInfo: c.sourceInfo as ToolSourceInfo,
    }));
  }

  /**
   * Calcula gates + warnings de um profile resolvido (puro dados os inventários).
   * Aplicar = `setActiveTools` + guardar `enforcement`; `show` só pré-visualiza.
   */
  function computeEnforcement(
    profileName: string,
    resolved: ResolvedProfile,
    toolsInv: ToolInventoryEntry[],
    commands: CommandInventoryEntry[],
    cli: CliToolFlags,
  ): { state: EnforcementState; warnings: string[] } {
    const warnings: string[] = [];
    const toolPlan = planTools({
      profileTools: resolved.tools,
      tools: toolsInv,
      allowedExtensions: resolved.extensions,
      cli,
    });
    warnings.push(...toolPlan.warnings);

    const skillNames = commands.filter((c) => c.source === "skill").map((c) => normalizeSkillName(c.name));
    const skillPlan = planField({ values: resolved.skills, inventory: skillNames, field: "skills" });
    if (skillPlan.unknown.length > 0) warnings.push(unknownFieldWarning("skills", skillPlan.unknown));

    const promptNames = commands.filter((c) => c.source === "prompt").map((c) => c.name);
    const promptPlan = planField({ values: resolved.prompts, inventory: promptNames, field: "prompts" });
    if (promptPlan.unknown.length > 0) warnings.push(unknownFieldWarning("prompts", promptPlan.unknown));

    if (resolved.extensions !== undefined) {
      const allow = new Set(resolved.extensions);
      const selfOwners = new Set(
        commands
          .filter((c) => c.source === "extension" && c.name === "profile")
          .map((c) => toolOwnerName(c.sourceInfo))
          .filter((o): o is string => o !== null),
      );
      const nonBlockable = [
        ...new Set(
          commands
            .filter((c) => c.source === "extension")
            .map((c) => toolOwnerName(c.sourceInfo))
            .filter((o): o is string => o !== null && !allow.has(o) && !selfOwners.has(o)),
        ),
      ].sort();
      if (nonBlockable.length > 0) warnings.push(nonBlockableExtensionsWarning(nonBlockable));
    }

    return {
      state: {
        profileName,
        toolsTouched: toolPlan.touched,
        finalTools: toolPlan.finalTools,
        skillsTouched: skillPlan.touched,
        allowedSkills: skillPlan.allowed,
        inventorySkills: [...new Set(skillNames)],
        promptsTouched: promptPlan.touched,
        allowedPrompts: promptPlan.allowed,
        promptNames: [...new Set(promptNames)],
      },
      warnings,
    };
  }

  /** Aplica os gates (issue 09): tools somem do prompt + backstops armados. */
  function applyEnforcement(ctx: ProfileReadCtx, name: string, resolved: ResolvedProfile): void {
    const { state, warnings } = computeEnforcement(
      name,
      resolved,
      collectTools(),
      collectCommands(),
      parseCliToolFlags(process.argv),
    );
    enforcement = state;
    if (state.toolsTouched) pi.setActiveTools(state.finalTools);
    for (const w of warnings) ctx.ui.notify(w, "warning");
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
    if (originNote && isEmptyProfile(r.profile)) ctx.ui.notify(emptyProfileWarning(), "warning");
    setMarker(ctx, name);
    applyEnforcement(ctx, name, r.profile);
    if (originNote) {
      stampMark(ctx, name, originNote);
      ctx.ui.notify(`Profile "${name}" ativo (${originNote}).`, "info");
    }
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

  // Backstop: tool fora do profile nunca executa (defesa em profundidade;
  // setActiveTools já a escondeu do prompt). Sem profile/tools = inerte.
  pi.on("tool_call", async (event) => {
    const en = enforcement;
    if (!en || !en.toolsTouched) return;
    const toolName = (event as { toolName?: unknown }).toolName;
    if (typeof toolName === "string" && !en.finalTools.includes(toolName)) {
      return {
        block: true,
        reason: `Bloqueado pelo profile "${en.profileName}": tool "${toolName}" fora do profile.`,
      };
    }
  });

  // Skills/prompts fora do profile recusam no input, antes da expansão.
  // Comandos de extensão passam antes (bypass) e builtins/desconhecidos não tocam.
  pi.on("input", async (event, ctx) => {
    const en = enforcement;
    if (!en) return;
    const e = event as { text?: unknown; source?: unknown };
    if (e.source === "extension") return;
    if (typeof e.text !== "string") return;
    const m = e.text.trim().match(/^\/(\S+)/);
    if (!m) return;
    const invoked = m[1];
    if (invoked === "skill:" || invoked.startsWith("skill:")) {
      if (!en.skillsTouched) return;
      const name = normalizeSkillName(invoked);
      if (!name) return;
      if (!en.inventorySkills.includes(name)) return; // desconhecida: o Pi trata
      if (!en.allowedSkills.includes(name)) {
        ctx.ui.notify(`Profile "${en.profileName}" bloqueou /skill:${name} (fora do profile).`, "warning");
        return { action: "handled" };
      }
      return;
    }
    if (!en.promptsTouched) return;
    if (!en.promptNames.includes(invoked)) return; // builtin, extensão ou desconhecido: não toca
    if (!en.allowedPrompts.includes(invoked)) {
      ctx.ui.notify(`Profile "${en.profileName}" bloqueou /${invoked} (fora do profile).`, "warning");
      return { action: "handled" };
    }
  });

  // Skills fora do profile somem do systemPrompt (blocos <skill> exatos).
  pi.on("before_agent_start", async (event) => {
    const en = enforcement;
    if (!en || !en.skillsTouched) return;
    const e = event as { systemPrompt?: unknown };
    if (typeof e.systemPrompt !== "string") return;
    const filtered = filterSkillMentions(e.systemPrompt, en.allowedSkills);
    if (filtered !== e.systemPrompt) return { systemPrompt: filtered };
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

  /** Carimbo no transcript da troca/ativação (terceira perna do marcador). */
  function stampMark(ctx: ProfileReadCtx, name: string | null, via: string): void {
    pi.appendEntry(MARK_TYPE, { name, entries: ctx.sessionManager.getEntries().length, via });
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
    stampMark(ctx, name, "use");
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
    // Preview do que a ativação faria/emitiria (issue 09), sem aplicar nada.
    const toolsInv = collectTools();
    const commands = collectCommands();
    const { state, warnings } = computeEnforcement(name, r.profile, toolsInv, commands, parseCliToolFlags(process.argv));
    if (r.profile.tools !== undefined) {
      const byName = new Map(toolsInv.map((t) => [t.name, t]));
      const ownerOf = (n: string): string => {
        const t = byName.get(n);
        if (!t) return "desconhecida";
        if (t.owner === null) return t.builtin ? "builtin" : "sdk";
        return `extensão ${t.owner}`;
      };
      const listed = r.profile.tools.length > 0 ? r.profile.tools.map((n) => `${n} (${ownerOf(n)})`).join(", ") : "(nenhuma — tudo desligado)";
      lines.push(`tools: ${listed}`);
      if (state.toolsTouched) lines.push(`tools efetivas: ${state.finalTools.join(", ") || "(nenhuma)"}`);
    }
    const extensionsNote = undetectedExtensionsNote(r.profile, toolsInv, commands);
    if (extensionsNote !== null) lines.push(extensionsNote);
    lines.push("Veja /profile inventory para todos os nomes disponíveis.");
    for (const w of warnings) lines.push(w);
    for (const w of loaded.warnings) lines.push(w);
    ctx.ui.notify(lines.join("\n"), "info");
  }

  /** Info (não warning): extensões listadas sem tools/comandos detectados — inventário parcial. */
  function undetectedExtensionsNote(
    resolved: ResolvedProfile,
    toolsInv: ToolInventoryEntry[],
    commands: CommandInventoryEntry[],
  ): string | null {
    if (resolved.extensions === undefined || resolved.extensions.length === 0) return null;
    const seen = new Set(knownExtensionOwners(toolsInv, commands));
    const missing = resolved.extensions.filter((e) => !seen.has(e));
    if (missing.length === 0) return null;
    return `Nota: extensões no profile sem tools/comandos detectados: ${missing.join(", ")} (verifique o nome)`;
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

  /** Builder interativo (issue 11): toggles sobre o inventário real + modo por recurso. */
  async function openBuilder(
    ctx: ProfileCmdCtx,
    loaded: LoadedConfig,
    opts: { name: string; stored: Profile | undefined; origin: "global" | "projeto"; lockTarget: boolean },
  ): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify("Builder de profile requer TUI — edite profiles:{} em settings.json (veja /profile inventory).", "error");
      return;
    }
    const toolsInv = collectTools();
    const commands = collectCommands();
    const toolDescs = new Map(pi.getAllTools().map((t) => [t.name, t.description]));
    const cmdDescs = new Map(pi.getCommands().map((c) => [c.name, c.description]));
    const short = (d: string | undefined): string => {
      if (!d) return "";
      const one = d.replace(/\s+/g, " ").trim();
      return one.length > 60 ? `${one.slice(0, 57)}…` : ` — ${one}`;
    };
    const inventory: Record<BuilderResource, string[]> = {
      tools: toolsInv.map((t) => t.name),
      skills: commands.filter((c) => c.source === "skill").map((c) => normalizeSkillName(c.name)),
      prompts: commands.filter((c) => c.source === "prompt").map((c) => c.name),
      extensions: knownExtensionOwners(toolsInv, commands),
    };
    const describe = (res: BuilderResource, key: string): string => {
      if (res === "tools") return toolDescs.get(key) ?? "";
      if (res === "extensions") return "";
      const full = res === "skills" ? `skill:${key}` : key;
      return cmdDescs.get(full) ?? cmdDescs.get(key) ?? "";
    };
    const state = builderInitial(opts.name, opts.stored, inventory, opts.origin);
    const targetPath = (t: "global" | "projeto"): string =>
      t === "projeto" ? join(ctx.cwd, CONFIG_DIR_NAME, "settings.json") : join(getAgentDir(), "settings.json");

    const buildItems = (): SettingItem[] => {
      const items: SettingItem[] = [];
      if (!opts.lockTarget && loaded.trusted) {
        items.push({ id: "__target", label: "salvar em", currentValue: state.target, values: ["global", "projeto"] });
      }
      for (const res of BUILDER_RESOURCES) {
        items.push({ id: `mode:${res}`, label: `${res} — modo`, currentValue: state.modes[res], values: ["seguir", "personalizar", "desligar"] });
        for (const item of state.items[res]) {
          items.push({
            id: `item:${res}:${item.key}`,
            label: `  ${item.key}${item.known ? "" : " (desconhecido)"}${short(describe(res, item.key))}`,
            currentValue: item.checked ? "on" : "off",
            values: ["on", "off"],
          });
        }
      }
      return items;
    };

    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      const container = new Container();
      const header = new Text(
        theme.fg(
          "accent",
          theme.bold(
            `Profile: ${opts.name}  (escreve em ${opts.lockTarget ? opts.origin : state.target})\nseguir=não toca · personalizar=só marcados · desligar=[] · Esc fecha`,
          ),
        ),
      );
      container.addChild(header);
      const items = buildItems();
      const list = new SettingsList(items, Math.min(items.length + 2, 20), getSettingsListTheme(), (id, value) => {
        applyBuilderChange(state, id, value);
      }, () => done(undefined));
      container.addChild(list);
      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          list.handleInput?.(data);
          tui.requestRender();
        },
      };
    });

    const result = builderResult(state);
    const where = state.target;
    const save = await ctx.ui.confirm(`Salvar profile "${opts.name}"`, `Escrever em ${targetPath(where)}?`);
    if (!save) {
      ctx.ui.notify("Edição descartada — nada foi escrito.", "info");
      return;
    }
    const r = saveProfileToFile(targetPath(where), opts.name, result);
    if (!r.ok) {
      ctx.ui.notify(r.error, "error");
      return;
    }
    ctx.ui.notify(`Profile "${opts.name}" salvo em ${where}.`, "info");
    const activate = await ctx.ui.confirm(`Ativar "${opts.name}" agora?`, "Aplica com reload in-place (conversa preservada).");
    if (activate) await useProfile(ctx, opts.name);
  }

  async function newProfile(ctx: ProfileCmdCtx, loaded: LoadedConfig, argName: string): Promise<void> {
    let name = argName;
    if (!name) {
      const input = await ctx.ui.input("Novo profile", "ex: webdev");
      if (!input) return;
      name = input.trim().split(/\s+/)[0] ?? "";
    }
    const bad = isValidProfileName(name);
    if (bad) {
      ctx.ui.notify(bad, "error");
      return;
    }
    const exists = loaded.merged.map[name] !== undefined;
    if (exists) {
      const over = await ctx.ui.confirm(`Profile "${name}" já existe`, `Sobrescrever [${loaded.merged.origins[name]}]? (use /profile edit para ajustar)`);
      if (!over) return;
    }
    const stored = exists ? loaded.merged.map[name] : undefined;
    const origin = exists ? loaded.merged.origins[name] : "global";
    await openBuilder(ctx, loaded, { name, stored, origin, lockTarget: false });
  }

  async function editProfile(ctx: ProfileCmdCtx, loaded: LoadedConfig, argName: string): Promise<void> {
    let name = argName;
    if (!name) {
      const names = Object.keys(loaded.merged.map).sort();
      if (names.length === 0) {
        ctx.ui.notify("Nenhum profile definido — use /profile new.", "error");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("Informe o nome: /profile edit <nome>.", "error");
        return;
      }
      const picked = await ctx.ui.select("Edit profile", names);
      if (!picked) return;
      name = picked;
    }
    const stored = loaded.merged.map[name];
    if (!stored) {
      ctx.ui.notify(unknownProfileError(name, Object.keys(loaded.merged.map).sort()), "error");
      return;
    }
    await openBuilder(ctx, loaded, { name, stored, origin: loaded.merged.origins[name], lockTarget: true });
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

  /** Inventário listing-first: origem, nome invocável real, descrição, habilitado-no-ativo. */
  function inventoryText(
    loaded: LoadedConfig,
    toolsInv: ToolInventoryEntry[],
    commands: CommandInventoryEntry[],
    only?: string,
  ): string | null {
    const sections = ["tools", "skills", "prompts", "extensions"];
    if (only !== undefined && !sections.includes(only)) return null;
    const want = (s: string): boolean => only === undefined || only === s;
    const lines = [`Inventário (${versionLine()}) — copie os nomes para montar o profile:`];
    const short = (d: string | undefined): string => {
      if (!d) return "";
      const one = d.replace(/\s+/g, " ").trim();
      return one.length > 90 ? `${one.slice(0, 87)}…` : one;
    };
    const mark = (on: boolean): string => (on ? "✓" : "—");
    if (want("tools")) {
      lines.push("tools:");
      const descriptions = new Map(pi.getAllTools().map((t) => [t.name, t.description]));
      for (const t of toolsInv) {
        const owner = t.owner === null ? (t.builtin ? "builtin" : "sdk") : t.owner;
        const on = enforcement !== null && enforcement.toolsTouched && enforcement.finalTools.includes(t.name);
        const desc = short(descriptions.get(t.name));
        lines.push(`- ${t.name} — ${desc} [${owner}]${enforcement?.toolsTouched ? ` ${mark(on)}` : ""}`);
      }
    }
    if (want("skills") || want("prompts")) {
      const byName = new Map(commands.map((c) => [c.name, c]));
      const descs = new Map(pi.getCommands().map((c) => [c.name, c.description]));
      for (const kind of ["skills", "prompts"] as const) {
        if (!want(kind)) continue;
        const singular = kind === "skills" ? "skill" : "prompt";
        lines.push(`${kind}:`);
        const items = commands.filter((c) => c.source === singular);
        if (items.length === 0) lines.push("(nenhum)");
        for (const c of items) {
          const info = byName.get(c.name);
          const origin = info ? inventoryOrigin(info.sourceInfo, getAgentDir()) : "?";
          const bare = kind === "skills" ? normalizeSkillName(c.name) : c.name;
          const allowed =
            enforcement !== null &&
            (kind === "skills" ? enforcement.skillsTouched : enforcement.promptsTouched) &&
            (kind === "skills" ? enforcement.allowedSkills : enforcement.allowedPrompts).includes(bare);
          const touched = enforcement !== null && (kind === "skills" ? enforcement.skillsTouched : enforcement.promptsTouched);
          const desc = short(descs.get(c.name));
          lines.push(`- ${c.name} — ${desc} [${origin}]${touched ? ` ${mark(allowed)}` : ""}`);
        }
      }
    }
    if (want("extensions")) {
      lines.push("extensions (com tools/comandos detectados):");
      const owners = [...new Set(commands.filter((c) => c.source === "extension").map((c) => toolOwnerName(c.sourceInfo)).filter((o): o is string => o !== null))];
      for (const t of toolsInv) if (t.owner !== null && !owners.includes(t.owner)) owners.push(t.owner);
      owners.sort();
      if (owners.length === 0) lines.push("(nenhuma)");
      for (const o of owners) lines.push(`- ${o}`);
    }
    return lines.join("\n");
  }

  pi.registerCommand("profile", {
    description: "Profiles nomeados (list/show/use/new/edit/inventory)",
    getArgumentCompletions: (prefix: string) => {
      const space = prefix.indexOf(" ");
      if (space === -1) {
        const out = ["list", "show", "use", "new", "edit", "inventory", ...globalNamesForCompletion()]
          .filter((v) => v.startsWith(prefix))
          .map((v) => ({ value: v, label: v }));
        return out.length > 0 ? out : null;
      }
      const first = prefix.slice(0, space);
      const rest = prefix.slice(space + 1);
      if (first === "show" || first === "use" || first === "edit") {
        const names = globalNamesForCompletion().filter((n) => n.startsWith(rest));
        return names.length > 0 ? names.map((v) => ({ value: `${first} ${v}`, label: v })) : null;
      }
      if (first === "inventory") {
        const kinds = ["tools", "skills", "prompts", "extensions"].filter((k) => k.startsWith(rest));
        return kinds.length > 0 ? kinds.map((v) => ({ value: `inventory ${v}`, label: v })) : null;
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
      if (sub === "inventory") {
        const kind = target.split(/\s+/)[0] || undefined;
        const text = inventoryText(loaded, collectTools(), collectCommands(), kind);
        if (text === null) {
          ctx.ui.notify("Uso: /profile inventory [tools|skills|prompts|extensions]", "error");
          return;
        }
        ctx.ui.notify(text, "info");
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
      if (sub === "new" || sub === "edit") {
        // Builder é TUI-only (custom UI): falha rápido fora do TUI, antes de
        // qualquer diálogo (em RPC/print os dialogs bloqueariam sem resposta).
        if (!ctxp.hasUI || ctxp.mode !== "tui") {
          ctx.ui.notify("Builder de profile requer TUI — edite profiles:{} em settings.json (veja /profile inventory).", "error");
          return;
        }
        if (sub === "new") await newProfile(ctxp, loaded, target.split(/\s+/)[0] ?? "");
        else await editProfile(ctxp, loaded, target.split(/\s+/)[0] ?? "");
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
      ctx.ui.notify(
        `Uso: /profile · /profile list · /profile show <nome> · /profile use <nome|${NONE_LABEL}> · /profile new [nome] · /profile edit [nome] · /profile inventory [recurso]`,
        "error",
      );
    },
  });
}
