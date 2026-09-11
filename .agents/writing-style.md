# Writing style, sem slop

Usado ao editar textos, via pointer no AGENTS.md.

Edite textos para remover padrões de IA e dar voz humana.

## Processo

1. Procure pelos padrões abaixo.
2. Reescreva. Preserve o significado, mantenha o tom pretendido.
3. Adicione alma (veja a próxima seção).
4. Faça autoauditoria: "O que faz isso parecer obviamente gerado por IA?" Corrija os sinais restantes.

## Adicionando alma

Remover padrões é metade do trabalho. Escrita estéril e sem voz é igualmente óbvia.

- **Tenha opiniões.** Reaja aos fatos em vez de listar prós e contras de forma neutra.
- **Varie o ritmo.** Frases curtas. Depois frases mais longas que levam seu tempo. Misture.
- **Reconheça a complexidade.** "Impressionante, mas também meio inquietante" é melhor que "impressionante".
- **Use "eu" quando couber.** Primeira pessoa não é antiprofissional.
- **Deixe um pouco de bagunça entrar.** Estrutura perfeita parece feita por máquina.
- **Seja específico.** Não "isso é preocupante", mas "há algo inquietante em agentes trabalhando às 3h da manhã".

## Padrões para detectar e corrigir

### Conteúdo

1. **Bajulação (puffery).** "pivotal moment", "testament to", "evolving landscape", "setting the stage for", "indelible mark", "deeply rooted". Corte a bajulação, diga o que aconteceu.

3. **Frases superficiais com -ing.** "highlighting...", "ensuring...", "reflecting...", "showcasing...", "fostering...". Apague ou expanda com fontes reais.
4. **Linguagem promocional.** "nestled", "vibrant", "breathtaking", "groundbreaking", "renowned", "stunning", "must-visit". Use descrições neutras.
5. **Atribuições vagas.** "Experts believe", "Industry reports suggest", "Some critics argue". Nomeie a fonte ou apague.
6. **Desafios formulaicos.** "Despite challenges... continues to thrive." Troque por fatos específicos.

### Linguagem

7. **Vocabulário de IA.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, landscape (abstrato), pivotal, showcase, tapestry (abstrato), testament, underscore, vibrant. Troque por palavras simples.
8. **Formas rebuscadas de dizer "é".** "serves as", "stands as", "boasts", "features". Apenas diga "is" ou "has".
9. **"Not just X, but Y."** Diga o ponto diretamente.
10. **Regra dos três.** Forçar ideias em grupos de três. Use o número natural.
11. **Rodízio de sinônimos.** Protagonist, main character, central figure, hero no mesmo parágrafo. Escolha um e repita.
12. **Intervalos falsos.** "from X to Y" onde X e Y não estão em uma escala significativa. Liste os temas diretamente.

### Estilo

13. **Excesso de travessão (em dash).** Evite travessões por completo. Use apenas pontos ou vírgulas (sem parênteses, sem en dashes, sem hífen como substituto de dash). Travessão é um sinal de IA, e trocar por parênteses só troca um sinal por outro. Se uma ideia precisa de separação, termine a frase ou use vírgula.
14. **Excesso de dois-pontos.** Dois-pontos valem antes de lista ou exemplo. Não como conector no meio da frase. "If you're coming from traditional automation: instead of registering event handlers, you describe conditions" não ganha nada com os dois-pontos. Reescreva para o ponto se sustentar sozinho. "Describing when the scheduler should fire works best as plain English." Mesmo significado, sem muleta de pontuação.
15. **Excesso de negrito.** Não coloque em negrito todo nome próprio ou sigla.
16. **Listas com cabeçalho inline.** O sinal é um rótulo em negrito com dois-pontos que repete a linha: "**Performance:** Performance improved...". Converta para prosa. Um lead em negrito que termina em ponto, nomeia o item e é seguido de detalhe genuinamente novo ("**Schema in TypeScript.** Tables live in one file.") está ok, não é sinal.
17. **Títulos em title case.** Use sentence case.
18. **Emojis decorativos.** Remova de títulos e bullets.
19. **Aspas curvas.** Troque por aspas retas.

### Artefatos de comunicação

20. **Frases de chatbot.** "I hope this helps!", "Let me know if...", "Of course!", "Certainly!", "Found the smoking gun!" Remova.
21. **Avisos de corte (cutoff disclaimers).** "While specific details are limited..." Encontre fontes ou remova.
22. **Tom bajulador.** "Great question! You're absolutely right!" Responda diretamente.

### Enchimento (filler)

23. **Frases de enchimento.** "In order to" vira "To". "Due to the fact that" vira "Because". "It is important to note that" é apagado.
24. **Hedge excessivo.** "could potentially possibly be argued that it might" vira "may".
25. **Conclusões genéricas.** "The future looks bright." Diga planos ou fatos específicos.

### Jargão

26. **Substantivos metafóricos abstratos.** Substrate, wedge, vector, locus, vantage, nexus, primitive (como substantivo), harness (como metáfora), surface (como em "API surface"), bedrock, scaffolding (como metáfora), modality, paradigm, gold-plating, ratchet (como metáfora), evacuate (para mover código), endgame, north star, flywheel. Soam técnicos, mas quase sempre há uma palavra concreta mais simples. "Substrate" vira "base". "Wedge in" vira "add". "Vector" vira "way" ou "method". "Gold-plating" vira "more than the job needs". "Ratchet" vira o nome real do mecanismo ou "a limit that only tightens". "Evacuate" vira "move out". "Endgame" vira "the last phase". Escolha a palavra concreta.

### Fala direta

27. **Diga o que faz, não como parece.** "the database stays close at hand", "SQL you can read", "types that follow your schema" nomeiam uma sensação. A correção nomeia o mecanismo ou um número: "`.toSQL()` returns the exact string sent to the database", "a column rename fails the build". Pergunte o que a frase manda o leitor fazer ou saber, e escreva isso. Se não der para reescrever como instrução concreta, fato ou número, corte. Checagem extra: se a frase poderia aparecer inalterada na doc de outro projeto, ela não diz nada sobre este. Corte.
28. **Encurte ou quebre frases densas.** Se o leitor precisa voltar para entender uma frase, quebre em duas ou corte cláusulas. Uma ideia por frase.
29. **Voz ativa.** Prefira. Capture "is/are/was/were + past participle" e nomeie o ator: "queries are validated" vira "the compiler validates queries", "the file is parsed by the loader" vira "the loader parses the file". Passiva só vale quando o ator é desconhecido ou genuinamente não importa.
30. **Corte advérbios, ou use um verbo mais forte.** "runs quickly" vira "is fast" ou o número. "significantly improves" vira o delta medido. Advérbio sustentando verbo fraco significa que o verbo está errado.
31. **Prefira a palavra simples.** "utilize" vira "use", "leverage" vira "use", "facilitate" vira "help", "numerous" vira "many", "in the event that" vira "if". O sinônimo mais chique raramente é mais claro.
