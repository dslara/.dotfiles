// Lógica pura de profiles (issues 08+09). Sem imports do Pi: testável com node direto.
// Decisões-fonte: issues/02-config-merge-trust.md, issues/03-profile-semantics.md,
// issues/04-tools-addressing.md. Formatos validados contra runtime via sonda -e.

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
  if (!stem || (stem.startsWith("<") && stem.endsWith(">"))) return null;
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
  const known = new Set(opts.tools.map((t) => t.name));
  const valid = opts.profileTools.filter((n) => known.has(n));
  const unknown = opts.profileTools.filter((n) => !known.has(n));
  if (unknown.length > 0) warnings.push(`Warning: Unknown tools: ${unknown.join(", ")} (ignorado)`);

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

  const cli = opts.cli ?? {};
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
