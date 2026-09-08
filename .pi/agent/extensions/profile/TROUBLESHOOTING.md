# Troubleshooting — pi-profile

## Projeto ignorado = trust

**Sintoma:** profiles/`defaultProfile` do `.pi/settings.json` não aparecem no
`/profile list` (só global), ou o default do projeto não aplica.

**Causa quase certa:** projeto **untrusted** — `.pi/settings.json` fica invisível
e só o global vale. Se o default global aponta para nome só-de-projeto, dá erro
de "profile inexistente" + fallback (nunca silencioso).

**Checar/fixar:**

- `/trust` salva a decisão, mas **exige restart** (não recarrega a sessão).
- `--approve`/`-a` confia por uma run (bom para testar).
- Sem decisão salva + não-interativo (`-p`, RPC): `ask`≈`never` ignoram o
  projeto; só `always` (ou `--approve`) confia.
- `.pi` vazio não pede trust; `AGENTS.md` carrega sempre (profile nunca gateia
  context files).
- A extensão nunca lê `.pi/settings.json` sem trust — é por desenho.

## Sobreposição = CLI

**Sintoma:** `Warning: CLI --tools sobrepõe o profile (…)` (ou `--no-tools`,
`--no-builtin-tools`, `--exclude-tools`) e o profile "não pega" nas tools.

**Causa:** flags CLI **sempre vencem** o profile (como vencem preset e
`defaultTools`). A extensão reaplica o CLI por cima do profile e avisa — nunca
silencioso.

**Fixar:** tire a flag da linha de comando, ou aceite que o CLI manda. Sem flag,
`tools` do profile substitui `defaultTools`; campo omitido = `defaultTools`
projeto>global continua valendo.

## `extends` = cadeia no erro

**Sintomas:**

- `Erro: profile inexistente na cadeia: a → b → ???` — `extends` aponta para
  nome que não existe no mapa final (pós-merge). Confira o nome (case-sensitive)
  e se ele não sumiu por trust (só existe no projeto, projeto untrusted).
- `Erro: ciclo: a → b → a.` — herança circular. Quebre o ciclo tirando um
  `extends`.
- `Erro: profile inexistente "x". Disponíveis: a, b.` — nome errado no `use`,
  na flag ou no `defaultProfile`.

Todos = fallback sem-profile (Pi como hoje) + mensagem; nada trava o boot.
`/profile show <nome>` exibe o erro sem aplicar — use para depurar.

## Warnings comuns (aplicam os válidos)

- `Unknown tools/skills/prompts: n (ignorado)` — nome fora do inventário
  (typo, recurso não-instalado, ou sumiu por trust). Rode
  `/profile inventory` e copie o nome invocável real (vale `:1`/`:2`).
- `<tool> ignorada — extensão dona desabilitada` — a tool é de uma extensão
  fora de `extensions:` do profile. Liste a dona (nome em `/profile inventory`)
  ou tire a tool.
- `comandos da extensão <e> seguem invocáveis` — limitação do Pi (sem API de
  bloqueio de comandos; `input` tem bypass). Tools/guidelines dela continuam
  vetados; só o `/comando` passa.
- `profile vazio (nada declarado)` — `{}` equivale a sem-profile. Descrição
  sozinha também não filtra nada.
- `defaultProfile … ignorado` / `campo … ignorado` — tipo errado no JSON
  (ex: `tools: "read"` em vez de `["read"]`); JSON inválido ignora o arquivo
  com warning e segue sem travar.

## Pegadinhas

- Array **substitui, nunca concatena** (merge projeto e `extends`): profile de
  projeto com o mesmo nome zera os campos que ele não declara.
- `skills: []` desliga; campo omitido não toca. `SKILL.md` segue legível via
  `read` — o bloqueio é de comando+prompt, não de arquivo.
- Colisão de comando vira `:1`/`:2` — enderece o nome real do inventário.

## Builder (`/profile new|edit`)

- Requer TUI (`custom` UI não existe em print/RPC/não-interativo) — fora dela,
  monte via JSON com `/profile inventory` + `show` para validar.
- `personalizar` com tudo marcado gera **lista explícita**, que congela o
  profile contra mudanças futuras do Pi; `seguir` (omitido) acompanha.
  Para "tudo como hoje", prefira `seguir`.
- O builder não edita `extends` (preserva o existente; novo sai sem) — herança
  vai no JSON. Nomes fora do inventário aparecem como `(desconhecido)` e são
  preservados ao salvar.
- Salvar no projeto exige projeto trusted; global sempre pode.
