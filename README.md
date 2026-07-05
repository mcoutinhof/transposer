# Transposer

Transpõe cifras em PDF direto no navegador: selecione um PDF textual de cifra
(formato clássico: linha de acordes sobre a letra), escolha quantos semitons
transpor (±11) e baixe o PDF editado — formatação intacta, nada sai da sua
máquina (100% client-side, sem backend).

## Uso

Abra a página publicada (GitHub Pages) ou sirva o diretório localmente:

    python3 -m http.server 8080   # → http://localhost:8080/

Limitações de propósito: só PDFs com texto real (nada de escaneado/OCR),
só o formato acorde-sobre-letra (sem `[A]` inline), grafia de saída com
sustenidos (exceto Bb).

## Desenvolvimento

Zero build: os arquivos são servidos como estão (MuPDF.js vem do CDN, pinado).

    npm install   # devDependencies: mupdf (testes) + tipos
    npm test      # node --test

Design: `docs/superpowers/specs/2026-07-04-transposer-design.md`.
Spike de validação: `test/spike/RESULTADO.md`.

## Deploy

`git push` com GitHub Pages servindo a raiz do branch `main`. Nada mais.

## Licença

AGPL-3.0 (o app usa [MuPDF.js](https://mupdf.readthedocs.io/), que é AGPL v3).
