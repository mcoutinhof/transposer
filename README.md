# Transposer — mude o tom de cifras em PDF

**Use aqui: https://mcoutinhof.github.io/transposer/**

O Transposer sobe ou abaixa o tom de uma cifra em PDF (do hinário, da apostila
do louvor, do Cifra Club) e devolve o **mesmo PDF** com os acordes trocados e a
letra e a formatação iguais. Tudo roda no navegador: o arquivo não é enviado a
nenhum servidor.

## Como mudar o tom de uma cifra em PDF sem perder a formatação

1. Abra o site e escolha o PDF da cifra.
2. Toque em − (abaixar) ou + (subir): cada toque é meio tom, até 3 tons.
3. Toque em "Mudar o tom". O PDF novo é baixado com o nome `música (+2).pdf`.

## Funciona com qualquer PDF?

Com PDF de texto no formato de acordes sobre a letra. Não funciona com PDF
escaneado ou foto, com acordes entre colchetes no meio da letra (`[A]`) nem com
cifra em Dó-Ré-Mi. Os acordes novos saem com sustenido (C#, D#, F#, G#), exceto
Bb. Linhas de capotraste e de afinação ficam como estão.

## Rodar localmente

Sirva o diretório:

    python3 -m http.server 8080   # → http://localhost:8080/

Validação em lote (letra preservada + sem acorde-fantasma) num diretório de PDFs:

    node test/validar-lote.mjs <dir>

## Desenvolvimento

Zero build: os arquivos são servidos como estão (MuPDF.js vem do CDN, pinado).

    npm install   # devDependencies: mupdf (testes) + tipos
    npm test      # node --test

Fontes dos acordes (Open Sans e Liberation Mono reduzidas): `fontes/`, geradas por
`ferramentas/gerar-fontes.sh`.

Design: `docs/superpowers/specs/2026-07-04-transposer-design.md`.
Spike de validação: `test/spike/RESULTADO.md`.

## Deploy

`git push` com GitHub Pages servindo a raiz do branch `main`. Nada mais.

## Licença

AGPL-3.0 (o app usa [MuPDF.js](https://mupdf.readthedocs.io/), que é AGPL v3).
