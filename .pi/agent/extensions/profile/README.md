# pi-profile — profiles nomeados para o Pi

Camada opt-in sobre o comportamento atual: um profile nomeado (ex: `webdev`)
controla **tools, skills, prompts e extensões**. **Sem profile ativo = Pi como hoje.**

## Install

Só global (time compartilha via `.pi/settings.json`, não via código):

```bash
mkdir -p ~/.pi/agent/extensions
cp -r profile ~/.pi/agent/extensions/profile/
```

Update = recopiar o diretório. Sem npm, sem deps (`só APIs do Pi`).
Versão no `package.json` + linha `ext vX · Pi <compat>` no seletor e no `list`;
mismatch de compat com o Pi = warning, nunca trava o boot.

## Formato (`settings.json`, global + projeto)

```jsonc
// ~/.pi/agent/settings.json
{
  "defaultProfile": "webdev",
  "profiles": {
    "webdev": {
      "description": "Web dev sem deploy",
      "tools": ["read", "bash", "grep"],
      "skills": ["code-review"]
    },
    "webdev-strict": {
      "description": "webdev sem shell",
      "extends": "webdev",
      "tools": ["read", "grep"]
    }
  }
}
// .pi/settings.json (lido SOMENTE se o projeto é trusted)
{
  "defaultProfile": "projeto-x",
  "profiles": {
    "projeto-x": { "description": "default do projeto", "tools": ["read"] }
  }
}
```

Shape (`Profile`): `description?`, `extends?` (um pai), `tools?`, `skills?`,
`prompts?`, `extensions?` — todos opcionais, nomes exatos do inventário
(veja `/profile inventory` para copiar; case-sensitive, sem globs).

Semântica por campo:

- **Omitido = não toca** (herda o Pi atual). **`[]` = desliga o recurso.**
  **`{}` = no-op + warning.**
- Recurso listado = **allowlist estrita** naquele recurso.
- `extends` resolve depois do merge: filho substitui por campo inteiro;
  campo omitido herda do pai. Quebrado/cíclico = erro + fallback sem-profile.
- Merge global→projeto: por nome, **projeto substitui o global por inteiro
  (perfil atômico)** — arrays nunca concatenam.
- `defaultProfile` (sibling de `profiles`): projeto substitui global.
  Ativação: `--profile` > escolha da sessão > default de projeto (trusted) >
  default global > nenhum.

Exemplos:

```json
"review": { "description": "Revisão: só leitura", "tools": ["read", "grep", "find", "ls"] },
"locked": { "description": "Nada executa", "tools": [], "skills": [], "prompts": [], "extensions": [] }
```

## Comandos

- `/profile` — seletor interativo (`(none)` = limpar, volta ao Pi como hoje)
- `/profile list` — nomes + descrição + origem (global/projeto) + ativo
- `/profile show <nome>` — perfil **resolvido** + dono das tools + warnings que
  a ativação emitiria; nunca aplica nada
- `/profile use <nome| (none)>` — valida → aplica → reload in-place
  (mesma sessão/arquivo, conversa 100% preservada)
- `/profile inventory [tools|skills|prompts|extensions]` — tudo disponível para
  montar o profile: nome invocável real, descrição, origem, habilitado-no-ativo
- `--profile <nome>` — flag CLI, vence defaults; inexistente = warning + fallback
- Tool `profile_use` — o LLM troca via `sendUserMessage("/profile use x")`;
  obedece ao profile vigente como qualquer tool

Marcador triplo da troca: `profile:<nome>` no footer + `profile-state` na sessão
+ carimbo `profile-mark` no transcript.

## Precedência e gates

1. CLI (`--tools` allowlist final / `--no-tools` zera / `--no-builtin-tools` só
   customs / `--exclude-tools` filtra por cima) — sempre vence, com aviso.
2. `tools` do profile (quando presente, substitui `defaultTools`; omitido =
   `defaultTools` projeto>global vale) e defaults do Pi (`grep`/`find`/`ls` off).
3. Gate da extensão: tool listada cuja dona está fora do profile é ignorada com
   warning; listar a extensão sozinha não ativa nada (sem ativação implícita).

Erro (impede ativação, fallback sem-profile): profile inexistente no `use`,
`extends` inexistente/cíclico. Warning (aplica os válidos): nome desconhecido
(`Unknown tools/skills/prompts: …`), órfã, profile `{}`, comandos de extensão
desabilitada que seguem invocáveis (sem API de bloqueio no Pi).

Mais em [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
