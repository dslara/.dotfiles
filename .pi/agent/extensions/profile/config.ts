// Lógica pura de profiles (issues 08+09+11). Só builtins do node: testável com node direto.
// Decisões-fonte: issues/02-config-merge-trust.md, issues/03-profile-semantics.md,
// issues/04-tools-addressing.md. Formatos validados contra runtime via sonda -e.

import { dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Shape do profile v1 (spec §3.1). Todos os campos opcionais. */
export interface Profile {
  description?: string;
  extends?: string;
  tools?: string[];
  skills?: string[];
  prompts?: string[];
  extensions?: string[];
}

/** Perfil resolvido: extends já aplicado, chave `extends` removida. */
export type ResolvedProfile = Omit<Profile, "extends">;

export type ProfileOrigin = "global" | "projeto";

export interface MergedProfiles {
  /** Mapa final pós-merge (projeto substitui global por nome, perfil atômico). */
  map: Record<string, Profile>;
  origins: Record<string, ProfileOrigin>;
}

/**
 * Merge global→projeto no nível `profiles`.
 * Mesmo nome = entrada de projeto substitui a global por inteiro (sem deep-merge).
 * Projeto untrusted = `.pi/settings.json` invisível, só global vale.
 */
export function mergeProfiles(
  globalProfiles: Record<string, Profile>,
  projectProfiles: Record<string, Profile>,
  trusted: boolean,
): MergedProfiles {
  const map: Record<string, Profile> = { ...globalProfiles };
  const origins: Record<string, ProfileOrigin> = {};
  for (const name of Object.keys(globalProfiles)) origins[name] = "global";
  if (trusted) {
    for (const [name, profile] of Object.entries(projectProfiles)) {
      map[name] = profile;
      origins[name] = "projeto";
    }
  }
  return { map, origins };
}

export type ResolveResult =
  | { ok: true; profile: ResolvedProfile }
  | { ok: false; message: string };

/** Sufixo de fallback: só em paths de ativação (startup/use), nunca no `show`. */
export const FALLBACK_SUFFIX = "Fallback: sem profile (Pi como hoje).";

export function activationError(message: string): string {
  return `${message} ${FALLBACK_SUFFIX}`;
}

/** Texto da spec para profile inexistente no `use`. */
export function unknownProfileError(name: string, available: string[]): string {
  return `Erro: profile inexistente "${name}". Disponíveis: ${available.join(", ") || "(nenhum)"}.`;
}

/** `{}` = no-op + warning (spec §3.2). */
export function isEmptyProfile(p: Profile): boolean {
  return (
    p.description === undefined &&
    p.extends === undefined &&
    p.tools === undefined &&
    p.skills === undefined &&
    p.prompts === undefined &&
    p.extensions === undefined
  );
}

export function emptyProfileWarning(): string {
  return "Warning: profile vazio (nada declarado) — equivale a sem profile";
}

/**
 * Resolve `extends` sobre o mapa final pós-merge (DFS + detecção de ciclo).
 * Filho substitui o pai por campo inteiro; campo omitido no filho herda do pai
 * (única exceção ao "omitido = não toca"). Erro = fallback sem-profile.
 */
export function resolveProfile(map: Record<string, Profile>, name: string): ResolveResult {
  return resolveChain(map, name, []);
}

function resolveChain(map: Record<string, Profile>, name: string, seen: string[]): ResolveResult {
  if (seen.includes(name)) {
    const chain = [...seen, name].join(" → ");
    return { ok: false, message: `Erro: ciclo: ${chain}.` };
  }
  const raw = map[name];
  if (!raw) {
    if (seen.length === 0) return { ok: false, message: unknownProfileError(name, Object.keys(map)) };
    const chain = [...seen, name].join(" → ");
    return {
      ok: false,
      message: `Erro: profile inexistente na cadeia: ${chain}.`,
    };
  }
  if (!raw.extends) {
    const { extends: _dropped, ...rest } = raw;
    return { ok: true, profile: rest };
  }
  const base = resolveChain(map, raw.extends, [...seen, name]);
  if (!base.ok) return base;
  const { extends: _dropped, ...child } = raw;
  return { ok: true, profile: { ...base.profile, ...child } };
}

export interface StartupSelection {
  /** `--profile` (flag já lida). String vazia = ausente. */
  flag?: string;
  /** Última escolha explícita da sessão (`profile-state`); null = `(none)` explícito. */
  restored?: string | null;
  /** Houve entry `profile-state` na sessão? Sem entry, valem os defaults. */
  restoredPresent: boolean;
  /** `defaultProfile` de projeto — o chamador só passa se trusted. */
  projectDefault?: string;
  globalDefault?: string;
}

/**
 * Precedência de ativação no startup:
 * `--profile` > escolha explícita da sessão > default de projeto (trusted) > default global > nenhum.
 * (Ticket 08; a escolha da sessão cobre o `use` + reload in-place.)
 */
export function selectStartup(sel: StartupSelection): { want: string | null } {
  if (sel.flag) return { want: sel.flag };
  if (sel.restoredPresent) return { want: sel.restored ?? null };
  if (sel.projectDefault) return { want: sel.projectDefault };
  if (sel.globalDefault) return { want: sel.globalDefault };
  return { want: null };
}

/** Compat: mesmo major.minor = ok (patch livre). Mismatch = warning, nunca trava o boot. */
export function isCompatiblePiVersion(running: string, compat: string): boolean {
  const [rMaj, rMin] = running.split(".");
  const [cMaj, cMin] = compat.split(".");
  return rMaj === cMaj && rMin === cMin;
}

/** Linha de versão exibida no seletor e no list (spec §6). */
export function formatVersionLine(extVersion: string, piCompat: string): string {
  return `ext v${extVersion} · Pi ${piCompat}`;
}

export interface InventoryProvenance {
  source: string;
  path: string;
  scope?: string;
  origin?: string;
}

/* ===== Builder TUI (issue 11) ===== */

export type BuilderResource = "tools" | "skills" | "prompts" | "extensions";
export const BUILDER_RESOURCES: BuilderResource[] = ["tools", "skills", "prompts", "extensions"];

/** seguir = campo omitido; personalizar = allowlist dos checados; desligar = []. */
export type ResourceMode = "seguir" | "personalizar" | "desligar";

export interface BuilderItem {
  key: string;
  checked: boolean;
  known: boolean;
}

export interface BuilderState {
  name: string;
  description: string;
  extends?: string;
  target: "global" | "projeto";
  modes: Record<BuilderResource, ResourceMode>;
  items: Record<BuilderResource, BuilderItem[]>;
}

export function isValidProfileName(name: string): string | null {
  if (!name) return 'Nome vazio — informe um nome (ex: "webdev").';
  if (/\s/.test(name)) return "Nome com espaço — use um token único (ex: webdev-strict).";
  if (name === "(none)") return 'Nome reservado — "(none)" limpa o profile, não pode ser um profile.';
  return null;
}

/** Donos de extensão detectáveis (tools + comandos; fora sintéticos). Para o builder e o show. */
export function knownExtensionOwners(
  tools: Array<{ owner: string | null }>,
  commands: Array<{ source: string; sourceInfo: ToolSourceInfo }>,
): string[] {
  const seen = new Set<string>();
  for (const t of tools) if (t.owner !== null) seen.add(t.owner);
  for (const c of commands) {
    if (c.source !== "extension") continue;
    const o = toolOwnerName(c.sourceInfo);
    if (o !== null) seen.add(o);
  }
  return [...seen].sort();
}

function modeOf(values: string[] | undefined): ResourceMode {
  if (values === undefined) return "seguir";
  if (values.length === 0) return "desligar";
  return "personalizar";
}

/**
 * Estado inicial do builder: novo (tudo seguir) ou edição do armazenado
 * (reflete omitido/[]/lista; desconhecidos entram checados para não perder dado).
 */
export function builderInitial(
  name: string,
  stored: Profile | undefined,
  inventory: Record<BuilderResource, string[]>,
  target: "global" | "projeto",
): BuilderState {
  const modes = {} as Record<BuilderResource, ResourceMode>;
  const items = {} as Record<BuilderResource, BuilderItem[]>;
  for (const res of BUILDER_RESOURCES) {
    const values = stored?.[res];
    modes[res] = modeOf(values);
    const norm = res === "skills" ? normalizeSkillName : (s: string) => s;
    const known = new Set((inventory[res] ?? []).map(norm));
    const listed = (values ?? []).map(norm);
    const rows: BuilderItem[] = (inventory[res] ?? []).map((raw) => ({
      key: norm(raw),
      checked: values === undefined ? true : listed.includes(norm(raw)),
      known: true,
    }));
    for (const v of listed) {
      if (!known.has(v)) rows.push({ key: v, checked: true, known: false });
    }
    items[res] = rows;
  }
  return { name, description: stored?.description ?? "", extends: stored?.extends, target, modes, items };
}

/** Aplica uma mudança da lista (id `mode:<res>` | `item:<res>:<key>` | `__target`). */
export function applyBuilderChange(state: BuilderState, id: string, value: string): void {
  if (id === "__target") {
    if (value === "global" || value === "projeto") state.target = value;
    return;
  }
  if (id.startsWith("mode:")) {
    const res = id.slice("mode:".length) as BuilderResource;
    if (BUILDER_RESOURCES.includes(res) && (value === "seguir" || value === "personalizar" || value === "desligar")) {
      state.modes[res] = value;
    }
    return;
  }
  if (id.startsWith("item:")) {
    const rest = id.slice("item:".length);
    const sep = rest.indexOf(":");
    if (sep === -1) return;
    const res = rest.slice(0, sep) as BuilderResource;
    const key = rest.slice(sep + 1);
    const item = BUILDER_RESOURCES.includes(res) ? state.items[res].find((i) => i.key === key) : undefined;
    if (item && (value === "on" || value === "off")) item.checked = value === "on";
  }
}

/** Estado → Profile (seguir omite; desligar zera; personalizar = checados, com desconhecidos). */
export function builderResult(state: BuilderState): Profile {
  const out: Profile = {};
  if (state.description) out.description = state.description;
  if (state.extends) out.extends = state.extends;
  for (const res of BUILDER_RESOURCES) {
    const mode = state.modes[res];
    if (mode === "seguir") continue;
    if (mode === "desligar") {
      out[res] = [];
      continue;
    }
    out[res] = state.items[res].filter((i) => i.checked).map((i) => i.key);
  }
  return out;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Escrita read-modify-write de um profile no settings (cria arquivo se ausente).
 * JSON inválido ou erro de IO = erro sem clobber.
 */
export function saveProfileToFile(filePath: string, name: string, profile: Profile): SaveResult {
  let disk: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return { ok: false, error: `JSON inválido em ${filePath} — edite manualmente.` };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `${filePath} não é um objeto — edite manualmente.` };
    }
    disk = parsed as Record<string, unknown>;
  }
  const profiles =
    typeof disk.profiles === "object" && disk.profiles !== null && !Array.isArray(disk.profiles)
      ? (disk.profiles as Record<string, unknown>)
      : {};
  profiles[name] = JSON.parse(JSON.stringify(profile)) as unknown;
  disk.profiles = profiles;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(disk, null, 2)}\n`, "utf-8");
  } catch (err) {
    return { ok: false, error: `Falha ao escrever ${filePath}: ${err}.` };
  }
  return { ok: true };
}

/**
 * Origem legível para o inventário listing-first: projeto / global /
 * package X / builtin / sdk / cli. Global = dentro do agentDir do usuário.
 */
export function inventoryOrigin(info: InventoryProvenance, agentDir: string): string {
  if (info.scope === "project") return "projeto";
  if (info.origin === "package") return `package ${info.source}`;
  if (info.source === "builtin") return "builtin";
  if (info.source === "sdk") return "sdk";
  if (info.source === "cli") return "cli";
  const norm = (p: string) => p.replace(/[\\/]+$/, "");
  const dir = norm(agentDir);
  const path = norm(info.path);
  if (path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`)) return "global";
  return info.source || "?";
}

/* ===== Enforcement (issue 09) ===== */

/** Proveniência mínima para mapear a extensão dona (ver `pi.getAllTools()`). */
export interface ToolSourceInfo {
  source: string;
  path: string;
  origin?: string;
  baseDir?: string;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function dirName(p: string): string {
  const noBase = p.slice(0, p.length - baseName(p).length);
  return baseName(noBase.replace(/[\\/]+$/, ""));
}

/**
 * Nome da extensão dona de uma tool/comando, no vocabulário do profile:
 * package → nome do diretório do pacote; arquivo → sem sufixo (`deploy.ts`→`deploy`);
 * `index.ts` → diretório pai. Built-in/sdk = null (sem dono, passa o gate).
 */
export function toolOwnerName(info: ToolSourceInfo): string | null {
  if (info.source === "builtin" || info.source === "sdk") return null;
  if (info.origin === "package" && info.baseDir) return baseName(info.baseDir) || null;
  const stem = baseName(info.path).replace(/\.[^.]*$/, "");
  // Paths sintéticos (<builtin:…>, <inline:…>) não são extensões.
  if (!stem || stem.startsWith("<")) return null;
  if (stem === "index") return dirName(info.path) || null;
  return stem;
}

/** Nome de skill no vocabulário do profile: sem o prefixo `skill:`. */
export function normalizeSkillName(s: string): string {
  return s.startsWith("skill:") ? s.slice("skill:".length) : s;
}

/** Flags CLI de tools que sobrepõem o profile (lidas de `process.argv`). */
export interface CliToolFlags {
  tools?: string[];
  excludeTools?: string[];
  noTools?: boolean;
  noBuiltinTools?: boolean;
}

const CLI_LIST_FLAGS: Record<string, "tools" | "excludeTools"> = {
  "--tools": "tools",
  "-t": "tools",
  "--exclude-tools": "excludeTools",
  "-xt": "excludeTools",
};
const CLI_BOOL_FLAGS: Record<string, "noTools" | "noBuiltinTools"> = {
  "--no-tools": "noTools",
  "-nt": "noTools",
  "--no-builtin-tools": "noBuiltinTools",
  "-nbt": "noBuiltinTools",
};

/** Parse tolerante de argv (formas `--flag v`, `--flag=v`, curtas; `--` encerra; repetida = última vence). */
export function parseCliToolFlags(argv: string[]): CliToolFlags {
  const out: CliToolFlags = {};
  const args = argv.slice();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") break;
    const eq = a.indexOf("=");
    const key = eq === -1 ? a : a.slice(0, eq);
    const listKey = CLI_LIST_FLAGS[key];
    if (listKey) {
      const value = eq === -1 ? (args[i + 1] !== undefined && !args[i + 1].startsWith("-") ? args[++i] : undefined) : a.slice(eq + 1);
      if (value !== undefined) out[listKey] = value ? value.split(",").filter(Boolean) : [];
      continue;
    }
    const boolKey = CLI_BOOL_FLAGS[key];
    if (boolKey) out[boolKey] = true;
  }
  return out;
}

export interface ToolInventoryEntry {
  name: string;
  owner: string | null;
  builtin: boolean;
}

export interface ToolPlan {
  /** false = campo omitido, não toca (vale defaultTools/CLI do Pi). */
  touched: boolean;
  finalTools: string[];
  warnings: string[];
}

/**
 * Allowlist final de tools: valida → gate da extensão → overlay do CLI.
 * `allowedExtensions === undefined` = campo omitido = sem gate.
 */
export function planTools(opts: {
  profileTools: string[] | undefined;
  tools: ToolInventoryEntry[];
  allowedExtensions?: string[];
  cli?: CliToolFlags;
}): ToolPlan {
  if (opts.profileTools === undefined) return { touched: false, finalTools: [], warnings: [] };
  const warnings: string[] = [];
  const cli = opts.cli ?? {};
  // --tools/--no-tools restringem o próprio load: o inventário vem incompleto
  // (sonda: getAllTools() retorna só o CLI). Sem ele, impossível distinguir
  // nome desconhecido de tool oculta pelo CLI — validação suprimida, CLI manda.
  const inventoryComplete = cli.tools === undefined && !cli.noTools;
  const known = new Set(opts.tools.map((t) => t.name));
  const valid = opts.profileTools.filter((n) => known.has(n));
  const unknown = opts.profileTools.filter((n) => !known.has(n));
  if (unknown.length > 0 && inventoryComplete) warnings.push(`Warning: Unknown tools: ${unknown.join(", ")} (ignorado)`);

  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  let gated = valid;
  if (opts.allowedExtensions !== undefined) {
    const allow = new Set(opts.allowedExtensions);
    gated = [];
    for (const n of valid) {
      const owner = byName.get(n)?.owner ?? null;
      if (owner !== null && !allow.has(owner)) {
        warnings.push(`Warning: ${n} ignorada — extensão dona desabilitada`);
        continue;
      }
      gated.push(n);
    }
  }

  if (cli.noTools) {
    warnings.push("Warning: CLI --no-tools sobrepõe o profile (todas as tools desligadas).");
    return { touched: true, finalTools: [], warnings };
  }
  if (cli.tools !== undefined) {
    warnings.push(`Warning: CLI --tools sobrepõe o profile (${cli.tools.join(", ")}).`);
    return { touched: true, finalTools: [...cli.tools], warnings };
  }
  let final = gated;
  if (cli.noBuiltinTools) {
    final = final.filter((n) => !(byName.get(n)?.builtin ?? false));
    warnings.push("Warning: CLI --no-builtin-tools sobrepõe o profile (built-ins removidas).");
  }
  if (cli.excludeTools !== undefined && cli.excludeTools.length > 0) {
    const drop = new Set(cli.excludeTools);
    final = final.filter((n) => !drop.has(n));
    warnings.push(`Warning: CLI --exclude-tools filtra o profile (${cli.excludeTools.join(", ")}).`);
  }
  return { touched: true, finalTools: final, warnings };
}

export interface FieldPlan {
  /** false = campo omitido, não toca. */
  touched: boolean;
  allowed: string[];
  unknown: string[];
}

/** Allowlist de skills/prompts/extensions (nomes exatos do inventário). */
export function planField(opts: {
  values: string[] | undefined;
  inventory: string[];
  field: "skills" | "prompts" | "extensions";
}): FieldPlan {
  if (opts.values === undefined) return { touched: false, allowed: [], unknown: [] };
  const norm = opts.field === "skills" ? normalizeSkillName : (s: string) => s;
  const known = new Set(opts.inventory.map(norm));
  const allowed = opts.values.map(norm).filter((n) => known.has(n));
  const unknown = opts.values.filter((n) => !known.has(norm(n)));
  return { touched: true, allowed, unknown };
}

export function unknownFieldWarning(field: "skills" | "prompts" | "extensions", names: string[]): string {
  return `Warning: Unknown ${field}: ${names.join(", ")} (ignorado)`;
}

export function nonBlockableExtensionsWarning(names: string[]): string {
  return names.length === 1
    ? `Warning: comandos da extensão ${names[0]} seguem invocáveis (sem API de bloqueio)`
    : `Warning: comandos das extensões ${names.join(", ")} seguem invocáveis (sem API de bloqueio)`;
}

/**
 * Remove do systemPrompt os blocos `<skill><name>X</name>…</skill>` fora da allowlist.
 * Sem seção `<available_skills>` = inalterado. Cirúrgico: só o bloco exato do nome.
 */
export function filterSkillMentions(systemPrompt: string, allowed: string[]): string {
  const open = systemPrompt.indexOf("<available_skills>");
  const close = systemPrompt.indexOf("</available_skills>");
  if (open === -1 || close === -1 || close < open) return systemPrompt;
  const allow = new Set(allowed);
  const head = systemPrompt.slice(0, open);
  const section = systemPrompt.slice(open, close + "</available_skills>".length);
  const tail = systemPrompt.slice(close + "</available_skills>".length);
  // Comparação por callback (sem montar regex com o nome): à prova de caracteres especiais.
  const pruned = section.replace(/<skill>\s*<name>([\s\S]*?)<\/name>[\s\S]*?<\/skill>/g, (block, rawName) => {
    const name = String(rawName).trim();
    return allow.has(name) ? block : "";
  });
  return head + pruned + tail;
}
