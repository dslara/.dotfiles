// Lógica pura de profiles (issue 08). Sem imports do Pi: testável com node direto.
// Decisões-fonte: issues/02-config-merge-trust.md, issues/03-profile-semantics.md.
// Enforcement das allowlists é issue 09 — aqui só merge, extends, seleção e textos.

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
