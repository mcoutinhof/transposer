# Transposer — Design

**Data:** 2026-07-04 · **Status:** aprovado para planejamento

App web que transpõe cifras em PDF: recebe um PDF textual, detecta os acordes, transpõe ±n semitons e devolve o PDF editado in-place, com formatação/template 100% intactos. Pesquisa de biblioteca em `RESEARCH.md` (decisão: MuPDF.js).

## Objetivo

O usuário seleciona um PDF de cifra, escolhe quantos semitons transpor, clica **Transpor** e baixa o PDF resultante. Nada mais.

## Não-objetivos

- PDFs escaneados/imagem (sem OCR). Se não há texto, o app avisa e não gera arquivo.
- Preview, edição manual, detecção de tom da música, opção de grafia ♯/♭.
- Acordes inline na letra (ex.: `[A]` no meio da frase). Só o formato clássico: linha de acordes sobre linha de letra.
- Backend, build step, framework, PWA/service worker.

## Stack e deploy

- **Arquivos estáticos puros** — deploy = `git push` para GitHub Pages. Sem build, sem toolchain em produção.
- **JavaScript vanilla, ES modules nativos.** Sem TypeScript, sem bundler.
- **Tipagem via JSDoc + `// @ts-check`:** cada arquivo declara tipos em comentários (`@param`, `@returns`, `@typedef` — ex.: o objeto de substituição do `detect.js`). O editor checa tudo via language server do TS, sem build; o browser lê os `.js` como estão. Como o language server não resolve imports por URL (e o erro TS2307 resultante não é silenciável por cast), o `worker.js` carrega o CDN via `import()` dinâmico com `// @ts-ignore` na linha do import e cast JSDoc — `/** @type {typeof import("mupdf")} */` — para tipar o resultado com os tipos da devDependency `mupdf` (mesma versão); um `jsconfig.json` na raiz (checkJs) liga tudo.
- **MuPDF.js via CDN, versão pinada** (ex.: `https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf.js`). O `.wasm` (~10 MB) é resolvido relativo ao módulo e vem do mesmo CDN; cacheado após o primeiro load.
- MuPDF roda num **Web Worker** (`type: "module"`) para a UI nunca travar.

```
index.html      ← UI mínima
app.js          ← lógica da página
worker.js       ← cola MuPDF (abre, extrai, redige, reinsere, salva)
transpose.js    ← puro: gramática do acorde + transposição
detect.js       ← puro: classificação de linhas/tokens e montagem das substituições (usa transpose.js)
test/           ← dev-only (node --test); não afeta o deploy
package.json    ← dev-only (mupdf como devDependency p/ testes, mesma versão do CDN)
jsconfig.json   ← dev-only (checkJs; tipos no editor)
```

`transpose.js` e `detect.js` são puros (zero dependências, zero MuPDF) — testáveis em Node e legíveis isoladamente.

## Detecção

Fonte de dados: `StructuredText.walk()` por página — cada caractere com origem, quad, fonte e tamanho, agrupado em linhas pelo próprio MuPDF.

**Tokenização:** linha dividida por whitespace, processada nesta **ordem única**:
1. **Grupos primeiro**, sobre os tokens crus: spans balanceados de `()`/`[]` (1 ou mais tokens) são reconhecidos antes de qualquer stripping.
2. **Stripping:** cada token é despido dos delimitadores de borda (`|` e os `()`/`[]` de grupo nas extremidades) — `(`/`)` só valem como ÁTOMO quando internos ao token, após a raiz (`A7(9)`).
3. **Match** da gramática e dos ignoráveis, sempre sobre os tokens despidos.

Todo delimitador despido é **reanexado verbatim** ao montar `textoNovo`, em todos os casos (`|Em|`→`|F#m|`, `(D7)`→`(E7)`).

**Gramática do acorde** (token inteiro precisa casar):

```
RAIZ   = [A-G](#|b)?
ATOMO  = m|maj|min|dim|aug|sus|add|M|\+|-|º|°|ø|#|b|[0-9]{1,2}|\(|\)|,|\.
BAIXO  = /[A-G](#|b)?
ACORDE = ^ RAIZ ATOMO* BAIXO? $
```

Cobre o vocabulário brasileiro: `Em`, `C#m7(b5)`, `G/B`, `A7M(9)`, `Dº`, `E4`, `Gsus4`, `Bb`, `Am7b5`. Rejeita palavras: `Ao`, `Dado`, `Bora`, `Fé` (letras fora do charset de átomos).

**Tokens e grupos ignoráveis** (não são acorde, mas não desqualificam a linha):
- **Rótulo-prefixo:** se um token termina em `:`, ele e todos os anteriores são ignoráveis (`Intro:`, `Primeira parte:`).
- **Grupos entre `()`/`[]`** (reconhecidos primeiro, sobre tokens crus — ver Tokenização): **ignoráveis por padrão**, com 1 ou mais tokens (`(Solo)`, `(2x)`, `(repete 2x)`, `[Verso 2]`) — **exceto** se o conteúdo interno, já despido, for todo acorde (`(D7)`, `(G D/F# Em)`): aí os acordes são transpostos normalmente, delimitadores preservados. Parênteses desbalanceados desclassificam a linha (fica intacta).
- `x2`/`2x`, `%`, `|`, `N.C.`, pontuação pura (`-`, `.`, `..`, `...`).

**Classificação:** uma linha é **linha de acordes** se tem ≥1 token ACORDE e zero tokens que não sejam ACORDE nem ignoráveis. Isso elimina o falso positivo central do português ("A"/"E" como artigo/conjunção na letra): linhas de letra sempre têm palavras que não casam.

Interface do `detect.js`: recebe as linhas tokenizadas e `n`, importa `transpose.js` (ambos puros) e devolve a lista de substituições `{página, quad, origem, fonte, tamanho, cor, textoOriginal, textoNovo}` — apenas tokens cujo texto muda.

## Transposição

- Transpõe **só a raiz e o baixo** de cada acorde; sufixo copiado verbatim.
- Aritmética módulo 12 sobre o mapa de saída fixo: `C C# D D# E F F# G G# A Bb B` (sustenidos sempre, exceto **Bb** no lugar de A#). Entrada aceita `#` e `b` em qualquer nota; enarmônicos raros mapeiam pelo som: `Cb`=B, `Fb`=E, `E#`=F, `B#`=C.
- n ∈ [−11, +11]; n = 0 não processa (botão desabilitado).

## Edição do PDF (redact + reinsert)

Por página, em três fases — coordenadas são coletadas **antes** de qualquer mutação:

1. **Coletar:** walk do texto estruturado → detect → lista de substituições com quads/origens.
2. **Apagar:** uma anotação de redação por token (retângulo = união dos quads dos caracteres, levemente encolhido na vertical para não tocar linhas vizinhas), depois **um único** `applyRedactions(false, REDACT_IMAGE_NONE, REDACT_LINE_ART_NONE, REDACT_TEXT_REMOVE)` — **parâmetros explícitos, nunca os defaults**: o default de `imageMethod` fura pixels de imagens sob o retângulo, o de `lineArtMethod` remove vetores cobertos (sublinhados, separadores), e o default de `blackBoxes` é `true` — confiar nele pintaria caixas pretas sobre os acordes. A redação do MuPDF remove exatamente os glifos do content stream sem deslocar o entorno.
3. **Reinserir:** cada acorde transposto desenhado na **origem original**, mesmo tamanho e cor, via `addSimpleFont` + append de operadores de texto (`BT … rg … Tf … Tm … Tj … ET`) no content stream — o mecanismo base (`addSimpleFont` + `BT…Tj…ET`) segue o exemplo oficial `page-insert-text.ts` (o pacote `mupdf` core não tem API mais alta — `insertText` pertencia ao wrapper `mupdfjs`, descontinuado), mas o posicionamento via `Tm`/`getTransform()` e a serialização hex são construção nossa (o exemplo usa `Td` e literal `(…)`, insuficientes para os nossos casos), e a **combinação** redact+reinsert também não tem exemplo oficial — é exatamente o que o spike valida. Cinco detalhes obrigatórios:
   - **Estado gráfico:** operadores anexados ao fim do stream herdam o estado residual da página — neutralizar em duas frentes. (1) **CTM:** prefixar `q` no início do `/Contents` original e emitir `Q` antes da reinserção, restaurando o default user space (um `cm` desbalanceado do gerador deixa CTM ≠ identidade, e `q…Q` local não a zera — CTM é concatenativa). (2) **Estado de texto:** envolver a inserção em `q … Q` próprio e resetar `0 Tc 0 Tw 100 Tz 0 Ts 0 Tr` antes do `BT` (um `Tr 3` residual deixaria o acorde invisível).
   - **Serialização do `Tj`:** nunca concatenar o texto cru num literal `(…)` — parêntese desbalanceado (ex.: token `(G` de grupo preservado) corrompe o stream, e `º`/`°`/`ø` serializados em UTF-8 viram glifos errados em fonte simples. Mapear caractere a caractere para bytes WinAnsi e emitir como hex string `<…> Tj`.
   - **Cor:** na 1.27.0 o walk entrega **sempre RGB de 3 componentes** normalizado 0–1 (o runtime desempacota o inteiro sRGB do caractere; o union `Color` de 1/3/4 componentes do `.d.ts` é enganoso) — emitir direto `r g b rg`. Sem operador de cor, o texto sai preto. Reforça o pin de versão: a assinatura do `onChar` muda entre minors (a 1.28 adiciona um parâmetro `bidi` ao final; o formato da cor é o mesmo).
   - **Coordenadas:** o walk devolve origens no espaço MuPDF (topo-esquerda, Y para baixo); o content stream usa o espaço do PDF (base-esquerda, Y para cima). Matriz de texto `Tm` = `page.getTransform()` (documentada como a transform MuPDF→PDF user space, aplicação **direta**, não inversa) composta com a origem do walk — cobre flip de Y, `/Rotate` e CropBox de uma vez. Atenção: flip puro é a própria inversa, então erro de direção só se manifesta em página com `/Rotate` — a direção é validada empiricamente no spike.
   - **Recurso de fonte:** o `PDFObject` devolvido por `addSimpleFont` precisa ser registrado em `/Resources/Font` da página sob um nome **novo, sem colisão** (enumerar os existentes e gerar um livre) — reusar um nome como `/F1` sobrescreveria a fonte de texto intacto do resto da página. `/Resources` é **herdável** na árvore `/Pages`: enumerar via `getInheritable`, e se o dicionário for herdado (compartilhado entre páginas), criar um `/Resources` próprio da página antes de adicionar a fonte — nunca escrever no dicionário compartilhado.

   Como as posições no PDF são absolutas, não existe reflow; um acorde que alarga (A→Bb) ocupa a folga entre acordes.

**Salvar:** full save com `garbage` + `compress` (redação exige remoção real dos bytes; incremental save manteria o texto antigo no arquivo). Download como `nome (+3).pdf` / `nome (-2).pdf`.

## Fontes

Sem paranoia (decisão do usuário: fallback resolve). **A v1 usa sempre fonte built-in**, casada por características do original — `isMono() → Courier`, `isSerif() → Times`, senão `Helvetica`, + variante bold/italic (`new Font("Courier-Bold")` etc., base-14, zero bytes extras no bundle). Como todos os acordes da página são reescritos, o resultado é internamente uniforme; e o alinhamento acorde-sobre-sílaba sobrevive sempre, porque a origem x de cada acorde não muda.

**Reuso da fonte embutida fica fora da v1.** Motivo técnico: o gate óbvio ("tenta e captura exceção") é insound — `addSimpleFont` aceita a fonte de um span CID/Type0 sem lançar e monta silenciosamente um recurso de fonte simples inválido; excluir compostas com segurança exigiria inspecionar os dicts de fonte da página. Se o spike mostrar que a built-in destoa demais do original, o reuso volta como melhoria futura, com dois requisitos: exclusão explícita de fontes compostas (nunca por try/catch) e decisão tudo-ou-nada por fonte (nunca por token), preservando a uniformidade.

## UI

Uma tela: input de arquivo (com drag-drop), stepper de semitons (−11…+11, default 0), botão **Transpor** (desabilitado sem arquivo ou com n=0), linha de status (`Processando página i/n…`, erros). Ao concluir, download automático e resumo na linha de status — `N acordes transpostos em M linhas` — o sinal mínimo para o usuário desconfiar de resultado parcial (linhas não reconhecidas ficam intactas em silêncio). Sem preview.

## Erros e casos-limite

| Caso | Comportamento |
|---|---|
| PDF sem texto (escaneado) ou zero acordes detectados | Mensagem "Nenhum acorde detectado"; não gera arquivo |
| PDF criptografado | Mensagem clara pedindo PDF sem senha |
| Assinatura digital | Invalidada por qualquer edição — sem mitigação (inerente) |
| Acordes colados (`A-D` sem espaço) | Limitação conhecida: linha não classificada, fica intacta |
| Linha só com acorde + anotação (`A (2x)`) | Classificada como acordes — risco de falso positivo aceito (raro) |
| Acorde alargado sem folga (vizinho a 1 só espaço) | Texto novo pode encostar/sobrepor o vizinho — aceito na v1, sem reposicionamento |
| Linha de letra com palavra única `A`/`E` (quebra poética) | Classificada como acordes e transposta — falso positivo aceito (raro) |

## Testes (dev-only, sem afetar deploy)

- **Unit (`node --test`):** `transpose.js` e `detect.js` — mesa de casos com acordes brasileiros reais e linhas armadilha ("A menina", "E o vento…", "Intro: E A9 B").
- **Integração (Node):** mupdf via devDependency (mesma versão do CDN). Fixtures gerados programaticamente + amostras reais. Verificar: extração de texto do resultado tem os acordes transpostos; letra intacta; origens dentro de tolerância.
- **Spike de validação (antes de qualquer UI):** redact+reinsert num PDF real (ex.: CifraClub). Checar: glifo faltante/tofu, largura do texto novo, aparência da fonte built-in vs. original, extração de texto pós-edição (`/ToUnicode`), fontes CID/Identity-H, redação comendo linha vizinha, line-art/imagem de fundo sob o acorde sobrevivendo intactos, posicionamento do acorde reinserido (matriz via `getTransform()`; páginas com `/Rotate`), texto reinserido visível e sem deslocamento por estado residual (texto e CTM). Antes de tudo, smoke test de ambiente (5 min): worker `type: "module"` numa página estática importando o `mupdf.js` do jsdelivr e abrindo um PDF trivial — o cenário CDN+worker não aparece na doc oficial.

## Riscos e plano B

- **Risco principal:** artefatos do redact+reinsert (glifos vizinhos apagados, fonte visivelmente diferente no fallback, CID sem `/ToUnicode` impedindo leitura do texto). O spike valida isso primeiro.
- **Plano B (não construir agora):** reescrita direta do content stream (parse de `Tj`/`TJ`, re-encode na fonte original). Só se o spike reprovar o caminho principal em PDFs reais.

## Licença

MuPDF.js é AGPL v3 → o repositório será **AGPL-3.0** (open source). Alternativa futura, se necessário: licença comercial Artifex.
