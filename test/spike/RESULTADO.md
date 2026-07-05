# Spike redact+reinsert — RESULTADO

**Decisão: GO** — a mecânica de redact + reinsert do MuPDF.js preserva a
formatação em todos os cenários sintéticos. Prosseguir para as Tasks 4–7.

## Checklist (fixture `simples`, n=+2)

| # | Item | Veredito | Evidência |
|---|---|---|---|
| 1 | Posicionamento (x/baseline idênticos) | PASSOU | `A E/G# F#m` exatamente sobre `G D/F# Em` em `simples-{antes,depois}-p1.png` |
| 2 | Tofu/glifo (inclui `º`) | PASSOU | `Dº→Eº` reinserido limpo (byte WinAnsi 0xBA via hex string); nenhum `?`/tofu |
| 3 | Largura (`G→A`, `Bb→C`) | PASSOU | sem sobreposição no vizinho |
| 4 | Fonte (Courier sobre Courier) | PASSOU | indistinguível na comparação |
| 5 | Linha vizinha intacta | PASSOU | "menina que passa danca" / "o vento leva a saudade" 100% intactas (o `A→B`/`E→F#` inicial é a detecção INGÊNUA do spike transpondo artigo/conjunção — a detect.js real não fará isso) |
| 6 | Line-art | PASSOU | linha horizontal sob "Intro:" inteira, largura cheia |
| 7 | Cor | PASSOU | texto novo preto como o original |

## Fixtures adversariais (n=+2)

| Fixture | Veredito | Evidência |
|---|---|---|
| `estado` (`cm`/`Tr`/`Tc` residuais) | PASSOU | acordes visíveis e no lugar apesar do `3 Tr` (texto invisível) e `cm` residuais — par `q`-prefixado/`Q` + reset de estado de texto funcionam (`estado-depois-p1.png`) |
| `rotate90` (`/Rotate 90`) | PASSOU | acordes na posição/orientação certas na página rodada **e** linhas de letra vizinhas 100% intactas — encolhimento direcional do `retanguloDe` (entrelinha no eixo X) impede a redação de comer a vizinha (`rotate90-depois-p1.png`) |
| PDF real (CifraClub) | PENDENTE | nenhum arquivo em `test/fixtures/real/`; os sintéticos cobrem a mecânica. Rodar o spike num PDF real (fontes CID/Identity-H, `/ToUnicode`, imagens de fundo) antes do release — pedir ao usuário |

## Divergências de API encontradas

Nenhuma. O código do spike rodou verbatim contra `mupdf@1.27.0`, confirmando os
formatos assumidos no plano:
- `onChar(c, origin, font, size, quad, color)` — `origin`/`quad` são arrays; `color` é RGB de 3 componentes 0–1.
- `beginLine(bbox, wmode, direction)` — `direction` é a direção de leitura no espaço MuPDF.
- `page.getTransform()` — MuPDF→PDF, aplicação direta (o `matrizTexto` direcional cobre normal/rotate/pré-rotacionado).
- `addStream(buf, null)` — 2 argumentos.
- `applyRedactions(false, REDACT_IMAGE_NONE, REDACT_LINE_ART_NONE, REDACT_TEXT_REMOVE)` — parâmetros explícitos preservam imagens/line-art.

A Task 6 (`worker.js`) reutiliza estes formatos sem alteração.
