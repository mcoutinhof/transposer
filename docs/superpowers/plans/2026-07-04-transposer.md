# Transposer — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App web 100% client-side que transpõe cifras em PDF textual: detecta acordes, transpõe ±n semitons e edita o PDF in-place (redact + reinsert via MuPDF.js) sem quebrar a formatação.

**Architecture:** Arquivos estáticos puros (GitHub Pages, zero build). `transpose.js` e `detect.js` são módulos puros testáveis em Node; `worker.js` é a cola MuPDF (roda num Web Worker módulo, carrega `mupdf` do CDN por `import()` dinâmico, e exporta `transporPdf` para os testes de integração em Node usarem a devDependency); `app.js`/`index.html` são a UI mínima. O spike de validação do redact+reinsert vem **antes** de qualquer UI.

**Tech Stack:** JavaScript vanilla (ES modules nativos), JSDoc + `// @ts-check`, MuPDF.js 1.27.0 (CDN jsdelivr + devDependency), `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-04-transposer-design.md` — o implementador DEVE ler o spec inteiro antes de começar; as seções "Edição do PDF" e "Detecção" são normativas.

## Global Constraints

- **Zero build:** nada de bundler, framework, TypeScript, backend, PWA/service worker. Deploy = `git push`.
- **MuPDF pinado:** CDN `https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf.js`; devDependency `"mupdf": "1.27.0"` (exata, sem `^`). Nunca subir de versão sem revalidar (a assinatura do `onChar` muda entre minors).
- **Redação sempre com parâmetros explícitos:** `applyRedactions(false, PDFPage.REDACT_IMAGE_NONE, PDFPage.REDACT_LINE_ART_NONE, PDFPage.REDACT_TEXT_REMOVE)` — nunca os defaults (pintam caixas pretas, furam imagens, apagam vetores).
- **Save sempre full:** `saveToBuffer("garbage,compress")` — nunca incremental (manteria o texto antigo no arquivo).
- **Transposição:** mapa de saída fixo `C C# D D# E F F# G G# A Bb B`; n ∈ [−11, +11]; n=0 não processa (botão desabilitado).
- **Copy da UI (pt-BR, literal do spec):** status `Processando página i/n…`; sucesso `N acordes transpostos em M linhas`; erro `Nenhum acorde detectado`; download `nome (+3).pdf` / `nome (-2).pdf`.
- **Nomenclatura:** identificadores e comentários em português (seguindo o vocabulário do spec: `textoNovo`, `origem`, `substituicoes`…). Todo `.js` de produção começa com `// @ts-check`.
- **Licença:** AGPL-3.0 (imposta pelo MuPDF.js).
- **Ordem inegociável:** Tasks 1→3 (ambiente, fixtures, spike) antes de qualquer código de produto. Se o spike reprovar (gate na Task 3), PARAR e reportar ao usuário — o plano B (reescrita direta de content stream) é decisão dele, não deste plano.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `index.html` | UI mínima (uma tela) |
| `app.js` | Lógica da página: arquivo, stepper, worker, download |
| `worker.js` | Cola MuPDF: `transporPdf` (abre→walk→detect→redige→reinsere→salva) + protocolo de mensagens |
| `transpose.js` | Puro: gramática do acorde + transposição |
| `detect.js` | Puro: classificação de linhas/tokens + substituições (usa `transpose.js`) |
| `test/transpose.test.js` | Unit da gramática/transposição |
| `test/detect.test.js` | Unit da classificação |
| `test/integracao.test.js` | Pipeline completo em Node (mupdf devDependency) |
| `test/util.mjs` | Helpers de extração de texto/tokens de um PDF |
| `test/fixtures/gerar.mjs` | Gerador programático de PDFs de teste (também é lib exportável) |
| `test/spike/smoke.html` + `smoke-worker.js` | Smoke test CDN+worker no browser |
| `test/spike/spike.mjs` | Spike redact+reinsert (código descartável, mecânica real) |
| `test/spike/RESULTADO.md` | Checklist preenchido do spike + decisão GO/NO-GO |
| `package.json`, `jsconfig.json`, `.gitignore`, `.nojekyll`, `LICENSE`, `README.md` | Suporte dev-only / repo |

---

### Task 1: Scaffolding + smoke test de ambiente (CDN + worker)

O cenário CDN+worker não aparece na doc oficial do MuPDF.js — validá-lo antes de tudo (5 min de spike de ambiente, exigido pelo spec §Testes).

**Files:**
- Create: `package.json`, `jsconfig.json`, `.gitignore`, `.nojekyll`, `LICENSE`, `README.md`
- Create: `test/spike/smoke.html`, `test/spike/smoke-worker.js`

**Interfaces:**
- Produces: ambiente Node com `mupdf@1.27.0` instalado; prova de que um worker `type: "module"` importa o mupdf do jsdelivr e instancia um documento.

- [ ] **Step 1: Arquivos de configuração**

`package.json`:
```json
{
  "name": "transposer",
  "private": true,
  "type": "module",
  "license": "AGPL-3.0-only",
  "scripts": {
    "test": "node --test \"test/*.test.js\""
  },
  "devDependencies": {
    "mupdf": "1.27.0",
    "@types/node": "22.10.2"
  }
}
```

`jsconfig.json`:
```json
{
  "compilerOptions": {
    "checkJs": true,
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "lib": ["es2022", "dom", "dom.iterable"]
  },
  "exclude": ["node_modules"]
}
```

`.gitignore`:
```
node_modules/
test/fixtures/gerados/
test/fixtures/real/
test/spike/saida/
```

`.nojekyll`: arquivo vazio (desliga o Jekyll no GitHub Pages).

Nota sobre o script de teste: o glob é expandido pelo próprio Node (manter as aspas). `node --test test/` não funciona no Node atual (trata `test/` como módulo), e `node --test` sem argumentos pegaria os padrões default `**/test/**` — executando o spike e o gerador de fixtures como se fossem testes.

- [ ] **Step 2: Instalar devDependencies**

Run: `npm install`
Expected: `added N packages` sem erros; `node_modules/mupdf/package.json` mostra `"version": "1.27.0"`.

- [ ] **Step 3: LICENSE (AGPL-3.0)**

Run: `curl -fsSL -o LICENSE https://www.gnu.org/licenses/agpl-3.0.txt`
Expected: `head -1 LICENSE` → `                    GNU AFFERO GENERAL PUBLIC LICENSE`

- [ ] **Step 4: README stub**

`README.md`:
```markdown
# Transposer

Transpõe cifras em PDF direto no navegador: selecione um PDF textual de cifra,
escolha quantos semitons transpor e baixe o PDF editado — formatação intacta,
nada sai da sua máquina.

Em construção. Design em `docs/superpowers/specs/2026-07-04-transposer-design.md`.

## Licença

AGPL-3.0 (o app usa [MuPDF.js](https://mupdf.readthedocs.io/), que é AGPL v3).
```

- [ ] **Step 5: Smoke test — arquivos**

`test/spike/smoke.html` (sem `@ts-check`; arquivo descartável):
```html
<!DOCTYPE html>
<html lang="pt-BR">
<meta charset="utf-8">
<title>Smoke — MuPDF CDN + worker</title>
<pre id="log">carregando worker…</pre>
<script type="module">
  const log = (m) => (document.getElementById("log").textContent += "\n" + m);
  const w = new Worker("./smoke-worker.js", { type: "module" });
  w.onmessage = (ev) => log(ev.data);
  w.onerror = (ev) => log("ERRO: " + ev.message);
</script>
</html>
```

`test/spike/smoke-worker.js`:
```js
const URL_MUPDF = "https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf.js";
const mupdf = await import(URL_MUPDF);
const doc = new mupdf.PDFDocument();
const pagina = doc.addPage([0, 0, 595, 842], 0, doc.newDictionary(), "");
doc.insertPage(-1, pagina);
postMessage(`OK: ${doc.countPages()} página(s), WASM inicializado`);
```

- [ ] **Step 6: Servir e verificar no browser**

Run (em background): `python3 -m http.server 8080`
Abrir `http://localhost:8080/test/spike/smoke.html` (via Playwright ou manualmente).
Expected: a página exibe `OK: 1 página(s), WASM inicializado`. Primeiro load demora (~10 MB de WASM do CDN); reload é instantâneo (cache).
Se falhar aqui (CORS, MIME do worker, WASM), PARAR: é problema de ambiente/CDN, reportar antes de prosseguir.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json jsconfig.json .gitignore .nojekyll LICENSE README.md test/spike/
git commit -m "chore: scaffolding + smoke test CDN+worker do MuPDF.js"
```

---

### Task 2: Gerador de fixtures PDF

PDFs de teste gerados programaticamente com a devDependency — cobrem os cenários do spike e dos testes de integração sem depender de arquivos binários no repo.

**Files:**
- Create: `test/fixtures/gerar.mjs`
- Create: `test/util.mjs`
- Test: `test/fixtures.test.js`

**Interfaces:**
- Produces (de `test/fixtures/gerar.mjs`):
  - `criarPdf(linhas: string[], opcoes?: {rotate?: 0|90|180|270, posambulo?: string, linhaArte?: boolean}): mupdf.PDFDocument` — 1 página A4, Courier 11, entrelinha 12 (apertada de propósito, para o teste de redação-comendo-vizinho), começando em (50, 780). `linhaArte: true` desenha uma linha horizontal `50 774 m 545 774 l S` sob a primeira linha de texto. `posambulo` é anexado ao fim do content stream (estado residual adversarial).
  - `salvar(doc, caminho: string, opcoes?: string): void` — `saveToBuffer` + write; `opcoes` repassado (ex.: criptografia).
  - `LINHAS_CIFRA: string[]` — a cifra-padrão dos testes (ver Step 3).
  - CLI: `node test/fixtures/gerar.mjs` grava todos os fixtures em `test/fixtures/gerados/`.
- Produces (de `test/util.mjs`):
  - `extrairTexto(doc: mupdf.PDFDocument): string` — texto de todas as páginas, linhas separadas por `\n`.
  - `extrairTokens(doc: mupdf.PDFDocument): {texto: string, x: number, y: number, pagina: number}[]` — tokens (split por whitespace) com a origem do primeiro caractere.

- [ ] **Step 1: Teste que falha**

`test/fixtures.test.js`:
```js
// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { criarPdf, LINHAS_CIFRA } from "./fixtures/gerar.mjs";
import { extrairTexto, extrairTokens } from "./util.mjs";

test("fixture simples contém cifra e armadilhas", () => {
  const doc = criarPdf(LINHAS_CIFRA);
  const texto = extrairTexto(doc);
  assert.match(texto, /D\/F#/);
  assert.match(texto, /A menina que passa/);
  assert.match(texto, /C#m7\(b5\)/);
});

test("extrairTokens devolve origens crescentes em x na mesma linha", () => {
  const doc = criarPdf(["G   D/F#   Em"]);
  const tokens = extrairTokens(doc);
  assert.equal(tokens.length, 3);
  assert.deepEqual(tokens.map((t) => t.texto), ["G", "D/F#", "Em"]);
  assert.ok(tokens[0].x < tokens[1].x && tokens[1].x < tokens[2].x);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/fixtures.test.js`
Expected: FAIL — `Cannot find module .../gerar.mjs`

- [ ] **Step 3: Implementar `gerar.mjs`**

```js
// @ts-check
// Gerador de PDFs de teste. Também é lib: os testes importam criarPdf/salvar.
import * as mupdf from "mupdf";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Cifra-padrão: acordes reais + linhas-armadilha do spec. */
export const LINHAS_CIFRA = [
  "Intro: G  D/F#  Em",
  "",
  "G          D/F#         Em",
  "A menina que passa danca",
  "C#m7(b5)   Bb   Dº   (D7)",
  "E o vento leva a saudade",
  "|Em|  A7(9)  (repete 2x)",
];

/**
 * Literal PDF: escapa \ ( ) e serializa não-ASCII como octal Latin-1 (º=\272).
 * Necessário porque addStream codifica strings JS em UTF-8 — um `º` cru viraria
 * os bytes 0xC2 0xBA e extrairia como "Âº" em fonte WinAnsi.
 * @param {string} s
 */
const lit = (s) => "(" + [...s].map((ch) => {
  if (ch === "\\" || ch === "(" || ch === ")") return "\\" + ch;
  const c = /** @type {number} */ (ch.codePointAt(0));
  if (c >= 0x20 && c <= 0x7e) return ch;
  return "\\" + c.toString(8).padStart(3, "0");
}).join("") + ")";

/**
 * @param {string[]} linhas
 * @param {{rotate?: import("mupdf").Rotate, posambulo?: string, linhaArte?: boolean}} [opcoes]
 * @returns {mupdf.PDFDocument}
 */
export function criarPdf(linhas, { rotate = 0, posambulo = "", linhaArte = false } = {}) {
  const doc = new mupdf.PDFDocument();
  const fonte = doc.addSimpleFont(new mupdf.Font("Courier"), "Latin");
  const fontes = doc.newDictionary();
  fontes.put("F1", fonte);
  const recursos = doc.newDictionary();
  recursos.put("Font", fontes);
  let corpo = linhaArte ? "0.5 w 50 774 m 545 774 l S\n" : "";
  corpo += "BT /F1 11 Tf 12 TL 50 780 Td\n";
  for (const l of linhas) corpo += lit(l) + " Tj T*\n";
  corpo += "ET\n" + posambulo;
  const pagina = doc.addPage([0, 0, 595, 842], rotate, recursos, corpo);
  doc.insertPage(-1, pagina);
  return doc;
}

/**
 * @param {mupdf.PDFDocument} doc
 * @param {string} caminho
 * @param {string} [opcoes] opções do saveToBuffer (ex.: criptografia)
 */
export function salvar(doc, caminho, opcoes = "") {
  writeFileSync(caminho, doc.saveToBuffer(opcoes).asUint8Array());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL("./gerados/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  salvar(criarPdf(LINHAS_CIFRA, { linhaArte: true }), dir + "simples.pdf");
  salvar(criarPdf(LINHAS_CIFRA, { rotate: 90 }), dir + "rotate90.pdf");
  salvar(criarPdf(LINHAS_CIFRA, { posambulo: "0.75 0 0 0.75 30 30 cm 3 Tr 2 Tc\n" }), dir + "estado.pdf");
  salvar(criarPdf(LINHAS_CIFRA), dir + "senha.pdf",
    "encrypt=aes-128,user-password=teste,owner-password=teste");
  salvar(criarPdf(["Documento sem nenhum acorde.", "So texto comum aqui."]), dir + "semacordes.pdf");
  console.log("fixtures gravados em", dir);
}
```

`test/util.mjs`:
```js
// @ts-check
// Extração de texto/tokens via StructuredText.walk — mesmo mecanismo que o worker usa.
import * as mupdf from "mupdf";

/**
 * Percorre todas as páginas e devolve as linhas de texto.
 * @param {mupdf.PDFDocument} doc
 * @returns {string}
 */
export function extrairTexto(doc) {
  /** @type {string[]} */
  const linhas = [];
  for (let i = 0; i < doc.countPages(); i++) {
    let atual = "";
    doc.loadPage(i).toStructuredText().walk({
      beginLine() { atual = ""; },
      onChar(c) { atual += c; },
      endLine() { linhas.push(atual); },
    });
  }
  return linhas.join("\n");
}

/**
 * Tokens (split por whitespace) com a origem do primeiro caractere.
 * @param {mupdf.PDFDocument} doc
 * @returns {{texto: string, x: number, y: number, pagina: number}[]}
 */
export function extrairTokens(doc) {
  /** @type {{texto: string, x: number, y: number, pagina: number}[]} */
  const tokens = [];
  for (let i = 0; i < doc.countPages(); i++) {
    /** @type {{texto: string, x: number, y: number, pagina: number} | null} */
    let atual = null;
    const fechar = () => { if (atual && atual.texto) tokens.push(atual); atual = null; };
    doc.loadPage(i).toStructuredText().walk({
      onChar(c, origem) {
        if (c.trim() === "") { fechar(); return; }
        if (!atual) atual = { texto: "", x: origem[0], y: origem[1], pagina: i };
        atual.texto += c;
      },
      endLine: fechar,
    });
    fechar();
  }
  return tokens;
}
```

Assinatura do `onChar` na 1.27.0: `(c: string, origin: Point, font: Font, size: number, quad: Quad, color: number[])`, com `Point = [x, y]` e `Quad = [ulx,uly,urx,ury,llx,lly,lrx,lry]` (arrays, não objetos). Conferir no primeiro run — se o formato divergir, ajustar o acesso e registrar a divergência (a Task 6 usa o mesmo acesso).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/fixtures.test.js`
Expected: PASS (2 testes). Se `onChar` falhar por formato de `origin`, ajustar o acesso conforme a nota acima e re-rodar.

- [ ] **Step 5: Gerar os fixtures e inspecionar**

Run: `node test/fixtures/gerar.mjs && ls test/fixtures/gerados/`
Expected: `simples.pdf rotate90.pdf estado.pdf senha.pdf semacordes.pdf`

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/gerar.mjs test/util.mjs test/fixtures.test.js
git commit -m "test: gerador de fixtures PDF + extração de texto/tokens"
```

---

### Task 3: Spike de validação — redact + reinsert

O risco principal do projeto inteiro. Código descartável, mas a **mecânica de PDF é a real** (as mesmas técnicas serão reescritas limpas no `worker.js` na Task 6). Detecção aqui é um regex ingênuo por token — o spike valida PDF, não detecção. Sem TDD: o deliverable é o checklist preenchido em `RESULTADO.md` com evidência visual (PNGs renderizados).

**Files:**
- Create: `test/spike/spike.mjs`
- Create: `test/spike/RESULTADO.md`

**Interfaces:**
- Consumes: `criarPdf`/`salvar`/`LINHAS_CIFRA` de `test/fixtures/gerar.mjs`, `extrairTexto`/`extrairTokens` de `test/util.mjs`, fixtures em `test/fixtures/gerados/`.
- Produces: decisão GO/NO-GO documentada; conhecimento validado (formato de `origin`/`quad`/`color` do walk, direção do `getTransform`, comportamento do `applyRedactions`) que a Task 6 reutiliza.

- [ ] **Step 1: Escrever `test/spike/spike.mjs`**

```js
// Spike redact+reinsert — descartável. Uso: node test/spike/spike.mjs <entrada.pdf> <n> <prefixo-saida>
import * as mupdf from "mupdf";
import { mkdirSync, writeFileSync } from "node:fs";

// ——— detecção ingênua (só para o spike; a real é a detect.js da Task 5) ———
const RE_ACORDE = /^[A-G](?:#|b)?(?:maj|min|dim|aug|sus|add|m|M|\+|-|º|°|ø|#|b|[0-9]|\(|\)|,|\.)*(?:\/[A-G](?:#|b)?)?$/;
const SAIDA = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function transporNota(nota, n) {
  let i = BASE[nota[0]] + (nota[1] === "#" ? 1 : nota[1] === "b" ? -1 : 0);
  return SAIDA[(((i + n) % 12) + 12) % 12];
}
function transporAcorde(acorde, n) {
  return acorde.replace(/^([A-G](?:#|b)?)/, (m) => transporNota(m, n))
               .replace(/\/([A-G](?:#|b)?)$/, (m, g) => "/" + transporNota(g, n));
}

// ——— coleta (antes de QUALQUER mutação da página) ———
// Formatos a conferir no 1º run: origin {x,y} ou [x,y]; quad = 8 números; color = [r,g,b] 0–1.
function coletarTokens(pagina) {
  const tokens = [];
  let atual = null;
  let direcao = [1, 0]; // direção de leitura da linha atual (espaço MuPDF), do beginLine
  const fechar = () => { if (atual && atual.texto) tokens.push(atual); atual = null; };
  pagina.toStructuredText().walk({
    beginLine(bbox, wmode, dir) { fechar(); direcao = dir; },
    onChar(c, origem, fonte, tamanho, quad, cor) {
      if (c.trim() === "") { fechar(); return; }
      if (!atual) {
        atual = {
          texto: "", origem: { x: origem[0], y: origem[1] }, direcao,
          quads: [], tamanho, cor,
          fonte: { mono: fonte.isMono(), serifa: fonte.isSerif(), negrito: fonte.isBold(), italico: fonte.isItalic() },
        };
      }
      atual.texto += c;
      atual.quads.push(quad);
    },
    endLine: fechar,
  });
  fechar();
  return tokens;
}

// ——— redação ———
// Quads e rects de anotação estão ambos no espaço MuPDF (fitz) — sem conversão.
// Encolhe no eixo da ENTRELINHA (perpendicular à direção da linha): linha
// horizontal separa-se da vizinha em Y; em página /Rotate 90/270 (texto reto
// no PDF space), em X — encolher no eixo errado deixa a redação comer a vizinha.
function retanguloDe(quads, direcao, encolhe = 0.1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of quads) {
    x0 = Math.min(x0, q[0], q[2], q[4], q[6]); x1 = Math.max(x1, q[0], q[2], q[4], q[6]);
    y0 = Math.min(y0, q[1], q[3], q[5], q[7]); y1 = Math.max(y1, q[1], q[3], q[5], q[7]);
  }
  if (Math.abs(direcao[0]) >= Math.abs(direcao[1])) {
    const dy = (y1 - y0) * encolhe;
    return [x0, y0 + dy, x1, y1 - dy];
  }
  const dx = (x1 - x0) * encolhe;
  return [x0 + dx, y0, x1 - dx, y1];
}
function apagarTokens(pagina, substituicoes) {
  for (const s of substituicoes) {
    const a = pagina.createAnnotation("Redact");
    a.setRect(retanguloDe(s.quads, s.direcao));
  }
  // Parâmetros SEMPRE explícitos — os defaults pintam caixas pretas, furam imagens e apagam vetores.
  pagina.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE,
    mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
}

// ——— reinserção ———
const fmt = (v) => v.toFixed(4).replace(/\.?0+$/, "");

// Tm que reproduz a colocação original: eixo do texto → M(direção da linha do
// walk), eixo vertical do glifo → M(up), origem → M(origem), com M =
// page.getTransform() (MuPDF→PDF, aplicação direta) e up = [dir.y, -dir.x]
// (perpendicular à esquerda da leitura, no espaço MuPDF y-baixo). Validado nos
// 3 cenários: página normal → [1,0,0,1,x,H−y]; /Rotate 90 com texto reto no
// PDF space → translação pura; /Rotate 90 com texto pré-rotacionado → [0,1,−1,0,e,f].
function matrizTexto(M, origem, dir) {
  const up = [dir[1], -dir[0]];
  const lin = (v) => [v[0] * M[0] + v[1] * M[2], v[0] * M[1] + v[1] * M[3]];
  const [a, b] = lin(dir), [c, d] = lin(up);
  return [a, b, c, d,
    origem.x * M[0] + origem.y * M[2] + M[4],
    origem.x * M[1] + origem.y * M[3] + M[5]];
}

// Nunca literal (…): parêntese desbalanceado corrompe o stream; º/°/ø em UTF-8 viram glifo errado.
// WinAnsi ≈ Latin-1 fora de 0x80–0x9F; charset de acordes cabe inteiro.
function paraHexWinAnsi(texto) {
  let hex = "";
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    const b = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : 0x3f; // '?' p/ fora do WinAnsi
    hex += b.toString(16).padStart(2, "0");
  }
  return "<" + hex + ">";
}

function nomeFonteBase14({ mono, serifa, negrito, italico }) {
  if (serifa && !mono) {
    return negrito && italico ? "Times-BoldItalic" : negrito ? "Times-Bold" : italico ? "Times-Italic" : "Times-Roman";
  }
  const base = mono ? "Courier" : "Helvetica";
  return base + (negrito && italico ? "-BoldOblique" : negrito ? "-Bold" : italico ? "-Oblique" : "");
}

// /Resources é herdável e pode ser compartilhado entre páginas: copiar SEMPRE
// (cópia rasa) para um dicionário próprio da página antes de mexer — nunca
// escrever no herdado/compartilhado. Idem para /Resources/Font.
function prepararFontes(doc, paginaObj) {
  const copiar = (orig) => {
    const d = doc.newDictionary();
    if (orig && !orig.isNull()) orig.forEach((v, k) => d.put(k, v));
    return d;
  };
  const recursos = copiar(paginaObj.getInheritable("Resources"));
  const fontes = copiar(recursos.get("Font"));
  recursos.put("Font", fontes);
  paginaObj.put("Resources", recursos);
  return fontes;
}
function registrarFonte(doc, fontes, nomeBase14) {
  let i = 0, nome;
  do { nome = "TRq" + i++; } while (fontes.get(nome) && !fontes.get(nome).isNull());
  fontes.put(nome, doc.addSimpleFont(new mupdf.Font(nomeBase14), "Latin"));
  return nome;
}

// Estado gráfico: 'q' prefixado ao /Contents original + 'Q' antes da reinserção
// neutraliza CTM residual (um 'cm' desbalanceado do gerador); cada inserção tem
// q…Q próprio + reset de estado de texto (um '3 Tr' residual deixaria o acorde invisível).
function reinserir(doc, pagina, substituicoes) {
  const paginaObj = pagina.getObject();
  const fontes = prepararFontes(doc, paginaObj);
  const nomes = new Map(); // nomeBase14 → nome do recurso na página
  const M = pagina.getTransform();
  let codigo = "Q\n";
  for (const s of substituicoes) {
    const base14 = nomeFonteBase14(s.fonte);
    if (!nomes.has(base14)) nomes.set(base14, registrarFonte(doc, fontes, base14));
    const [r, g, b] = s.cor; // na 1.27.0 o walk entrega sempre RGB 3 componentes 0–1
    codigo += "q 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr BT\n"
      + `${fmt(r)} ${fmt(g)} ${fmt(b)} rg\n`
      + `/${nomes.get(base14)} ${fmt(s.tamanho)} Tf\n`
      + matrizTexto(M, s.origem, s.direcao).map(fmt).join(" ") + " Tm\n"
      + paraHexWinAnsi(s.textoNovo) + " Tj\nET Q\n";
  }
  const arr = doc.newArray();
  arr.push(doc.addStream("q\n", null));
  const atual = paginaObj.get("Contents");
  if (atual.isArray()) atual.forEach((v) => arr.push(v));
  else if (!atual.isNull()) arr.push(atual);
  arr.push(doc.addStream(codigo, null));
  paginaObj.put("Contents", arr);
}

// ——— pipeline + render ———
function renderizar(doc, prefixo) {
  for (let i = 0; i < doc.countPages(); i++) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB);
    writeFileSync(`${prefixo}-p${i + 1}.png`, pix.asPNG());
  }
}

const [entrada, nArg, prefixo] = process.argv.slice(2);
const n = Number(nArg);
mkdirSync("test/spike/saida", { recursive: true });
const doc = mupdf.Document.openDocument(new Uint8Array((await import("node:fs")).readFileSync(entrada)), "application/pdf");
renderizar(doc, prefixo + "-antes");
for (let i = 0; i < doc.countPages(); i++) {
  const pagina = doc.loadPage(i);
  const tokens = coletarTokens(pagina);            // 1. coletar (antes de mutar)
  const subs = tokens
    .filter((t) => RE_ACORDE.test(t.texto))
    .map((t) => ({ ...t, textoNovo: transporAcorde(t.texto, n) }))
    .filter((t) => t.textoNovo !== t.texto);
  console.log(`página ${i + 1}: ${subs.length} substituições:`, subs.map((s) => `${s.texto}→${s.textoNovo}`).join(" "));
  if (!subs.length) continue;
  apagarTokens(pagina, subs);                      // 2. apagar
  reinserir(doc, pagina, subs);                    // 3. reinserir
}
writeFileSync(prefixo + ".pdf", doc.saveToBuffer("garbage,compress").asUint8Array());
const depois = mupdf.Document.openDocument(new Uint8Array((await import("node:fs")).readFileSync(prefixo + ".pdf")), "application/pdf");
renderizar(depois, prefixo + "-depois");
console.log("extração pós-edição:\n" + (await import("../util.mjs")).extrairTexto(depois));
```

(Detecção ingênua transpõe palavras soltas tipo "A" na letra — esperado e irrelevante: o spike valida a mecânica de PDF, não a classificação.)

- [ ] **Step 2: Rodar no fixture simples**

Run: `node test/fixtures/gerar.mjs && node test/spike/spike.mjs test/fixtures/gerados/simples.pdf 2 test/spike/saida/simples`
Expected: log com substituições (`G→A D/F#→E/G# Em→F#m C#m7(b5)→D#m7(b5) Bb→C Dº→Eº …`); PNGs antes/depois gravados; extração pós-edição mostra os acordes transpostos.
Se a API divergir do escrito (`origin`/`quad`/`getTransform`/`addStream`/`forEach`), ajustar o spike até rodar — anotar TODA divergência no RESULTADO.md (a Task 6 depende dessas correções).

- [ ] **Step 3: Inspeção visual (obrigatória, imagem a imagem)**

Ler os PNGs `simples-antes-p1.png` e `simples-depois-p1.png` lado a lado e conferir, item a item do checklist do spec §Testes:
1. **Posicionamento:** acordes transpostos na mesma posição (x idêntico, baseline idêntica) — sem deslocamento vertical/horizontal.
2. **Tofu/glifo:** nenhum `?`, tofu ou glifo trocado — a cifra-padrão inclui `Dº`; conferir o `º` reinserido (byte WinAnsi 0xBA via hex string).
3. **Largura:** `G→A` e `Bb→C` sem sobreposição no vizinho; folga consumida naturalmente.
4. **Fonte:** Courier reinserido sobre página Courier — indistinguível.
5. **Linha vizinha:** as linhas de letra ("A menina…", "E o vento…") 100% intactas — a redação não comeu nada acima/abaixo.
6. **Line-art:** a linha horizontal do `linhaArte` continua inteira sob os acordes.
7. **Cor:** texto novo preto como o original.

- [ ] **Step 4: Fixtures adversariais**

Run:
```bash
node test/spike/spike.mjs test/fixtures/gerados/estado.pdf 2 test/spike/saida/estado
node test/spike/spike.mjs test/fixtures/gerados/rotate90.pdf 2 test/spike/saida/rotate90
```
Inspecionar os PNGs:
- `estado`: texto reinserido visível e no lugar apesar do `cm`/`Tr`/`Tc` residuais no fim do stream original (valida o par `q`-prefixado/`Q` e o reset de estado de texto).
- `rotate90`: acordes na posição e orientação certas na página rodada, **e** linhas de letra vizinhas 100% intactas — em página rodada a entrelinha corre no eixo X, e é o encolhimento direcional do `retanguloDe` que impede a redação de comer a vizinha. O `matrizTexto` direcional cobre os 3 cenários de rotação por construção; aqui é a confirmação ponta a ponta.

- [ ] **Step 5: PDF real**

Se houver um PDF real de cifra (ex.: exportado do CifraClub) em `test/fixtures/real/`, rodar o spike nele (n=2) e inspecionar: aparência da built-in vs. fonte original, fontes CID/Identity-H (redação funciona? extração pós-edição legível — `/ToUnicode`?), imagens/fundo intactos. Se NÃO houver, pedir ao usuário; se indisponível, registrar como pendência no RESULTADO.md e seguir (os sintéticos cobrem a mecânica).

- [ ] **Step 6: RESULTADO.md + decisão**

Escrever `test/spike/RESULTADO.md`: tabela com cada item do checklist (1–7 do Step 3 + estado + rotate90 + real) e veredito PASSOU/FALHOU/PENDENTE com uma linha de evidência; divergências de API encontradas; decisão final **GO** (redact+reinsert aprovado → Tasks 4–7) ou **NO-GO** (PARAR o plano e reportar ao usuário — plano B é decisão dele).

- [ ] **Step 7: Commit**

```bash
git add test/spike/spike.mjs test/spike/RESULTADO.md
git commit -m "spike: valida redact+reinsert do MuPDF.js (GO/NO-GO documentado)"
```

---

### Task 4: `transpose.js` — gramática + transposição

Módulo puro (zero dependências). Gramática e regras vêm literais do spec §Detecção/§Transposição.

**Files:**
- Create: `transpose.js`
- Test: `test/transpose.test.js`

**Interfaces:**
- Produces:
  - `ehAcorde(token: string): boolean` — o token inteiro casa a gramática `RAIZ ATOMO* BAIXO?`.
  - `transporNota(nota: string, n: number): string` — nota (`A`–`G` + `#`/`b` opcional) → mapa de saída.
  - `transporAcorde(acorde: string, n: number): string` — transpõe raiz e baixo, sufixo verbatim; devolve o próprio token se não casar a gramática.

- [ ] **Step 1: Teste que falha**

`test/transpose.test.js`:
```js
// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { ehAcorde, transporAcorde, transporNota } from "../transpose.js";

test("gramática aceita o vocabulário brasileiro", () => {
  for (const t of ["Em", "C#m7(b5)", "G/B", "A7M(9)", "Dº", "E4", "Gsus4", "Bb", "Am7b5",
                   "A", "F#m7", "C7(9,13)", "Ddim", "Eaug", "Badd9", "D°", "Cø", "E7+", "G-", "A."]) {
    assert.ok(ehAcorde(t), `deveria aceitar ${t}`);
  }
});

test("gramática rejeita palavras", () => {
  for (const t of ["Ao", "Dado", "Bora", "Fé", "menina", "vento", "Intro:", "2x", "%", "|", "N.C.",
                   "H7", "a", "em", "(D7)", ""]) {
    assert.ok(!ehAcorde(t), `deveria rejeitar ${t}`);
  }
  // regressão: sequência longa de dígitos não pode travar o regex (se travar, a suíte pendura aqui)
  assert.ok(!ehAcorde("C" + "7".repeat(60) + "z"));
});

test("transposição de notas usa o mapa de saída (sustenidos, exceto Bb)", () => {
  assert.equal(transporNota("A", 1), "Bb");
  assert.equal(transporNota("A", 2), "B");
  assert.equal(transporNota("G", 1), "G#");
  assert.equal(transporNota("B", 1), "C");
  assert.equal(transporNota("C", -1), "B");
  assert.equal(transporNota("D", -11), "D#");
  assert.equal(transporNota("E", 11), "D#");
});

test("enarmônicos raros de entrada mapeiam pelo som", () => {
  assert.equal(transporNota("Cb", 1), "C");   // Cb = B
  assert.equal(transporNota("Fb", 1), "F");   // Fb = E
  assert.equal(transporNota("E#", 1), "F#");  // E# = F
  assert.equal(transporNota("B#", -1), "B");  // B# = C
  assert.equal(transporNota("A#", 1), "B");
  assert.equal(transporNota("Db", 2), "D#");
});

test("transpõe raiz e baixo; sufixo verbatim", () => {
  assert.equal(transporAcorde("Em", 1), "Fm");
  assert.equal(transporAcorde("C#m7(b5)", 1), "Dm7(b5)");
  assert.equal(transporAcorde("G/B", 2), "A/C#");
  assert.equal(transporAcorde("A7M(9)", -1), "G#7M(9)");
  assert.equal(transporAcorde("Dº", 3), "Fº");
  assert.equal(transporAcorde("Bb", 2), "C");
  assert.equal(transporAcorde("Am7b5", -2), "Gm7b5");
  assert.equal(transporAcorde("D/F#", 2), "E/G#");
  assert.equal(transporAcorde("Gsus4", 2), "Asus4");
});

test("token que não casa a gramática volta intacto", () => {
  assert.equal(transporAcorde("menina", 3), "menina");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/transpose.test.js`
Expected: FAIL — `Cannot find module .../transpose.js`

- [ ] **Step 3: Implementar `transpose.js`**

```js
// @ts-check
// Gramática do acorde e transposição — módulo puro, zero dependências.
// Regras normativas: spec §Detecção (gramática) e §Transposição (mapa de saída).

const RE_NOTA = "[A-G](?:#|b)?";
// Alternativas multi-letra antes das de 1 letra (maj antes de m, etc.).
// Dígito único de propósito: sob o `*` externo, [0-9] aceita exatamente a mesma
// linguagem que [0-9]{1,2} — e a forma {1,2} é ambígua, causando backtracking
// exponencial em tokens como "C777…7z" (PDF é entrada arbitrária do usuário).
const RE_ATOMO = "(?:maj|min|dim|aug|sus|add|m|M|\\+|-|º|°|ø|#|b|[0-9]|\\(|\\)|,|\\.)";
const RE_ACORDE = new RegExp(`^(${RE_NOTA})(${RE_ATOMO}*)(/${RE_NOTA})?$`);

/** Mapa de saída fixo: sustenidos sempre, exceto Bb. */
const SAIDA = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * O token inteiro é um acorde? (`RAIZ ATOMO* BAIXO?`)
 * @param {string} token
 */
export function ehAcorde(token) {
  return RE_ACORDE.test(token);
}

/**
 * Transpõe uma nota n semitons para o mapa de saída.
 * Enarmônicos de entrada (Cb, Fb, E#, B#, A#…) resolvem pela aritmética.
 * @param {string} nota — `[A-G](#|b)?`
 * @param {number} n — semitons, inteiro
 */
export function transporNota(nota, n) {
  const letra = /** @type {keyof typeof BASE} */ (nota[0]);
  const indice = BASE[letra] + (nota[1] === "#" ? 1 : nota[1] === "b" ? -1 : 0);
  return SAIDA[(((indice + n) % 12) + 12) % 12];
}

/**
 * Transpõe raiz e baixo do acorde; sufixo copiado verbatim.
 * Token que não casa a gramática volta intacto.
 * @param {string} acorde
 * @param {number} n — semitons, inteiro ≠ 0 em [-11, 11]
 */
export function transporAcorde(acorde, n) {
  const m = RE_ACORDE.exec(acorde);
  if (!m) return acorde;
  const [, raiz, sufixo = "", baixo] = m;
  const novoBaixo = baixo ? "/" + transporNota(baixo.slice(1), n) : "";
  return transporNota(raiz, n) + sufixo + novoBaixo;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/transpose.test.js`
Expected: PASS (6 testes). Nota: a raiz é gulosa — `Bb` casa como raiz `Bb`, nunca como `B`+átomo `b` (o quantificador de `RE_NOTA` garante isso; o caso `transporAcorde("Bb", 2) === "C"` do teste prova).

- [ ] **Step 5: Commit**

```bash
git add transpose.js test/transpose.test.js
git commit -m "feat: gramática de acordes e transposição (módulo puro)"
```

---

### Task 5: `detect.js` — classificação de linhas e substituições

Módulo puro. Implementa a ordem única do spec §Detecção: (1) grupos sobre tokens crus, (2) stripping de delimitadores de borda, (3) match sobre tokens despidos. Delimitadores reanexados verbatim no `textoNovo`.

**Files:**
- Create: `detect.js`
- Test: `test/detect.test.js`

**Interfaces:**
- Consumes: `ehAcorde(token)`, `transporAcorde(acorde, n)` de `./transpose.js`.
- Produces:
  - `detectarSubstituicoes(linhas, n)` onde `linhas: T[][]` (T extende `{texto: string}`; metadados extras passam intactos) e `n: número inteiro ≠ 0 em [-11, 11]`. Retorna `{ substituicoes: { token: T, textoNovo: string }[], linhasAfetadas: number }` — apenas tokens cujo texto muda; `textoNovo` é o texto **completo** do token (delimitadores reanexados).

- [ ] **Step 1: Teste que falha**

`test/detect.test.js`:
```js
// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { detectarSubstituicoes } from "../detect.js";

/** Monta uma linha de tokens a partir de string (split por whitespace, como o worker faz). */
const L = (s) => s.split(/\s+/).filter(Boolean).map((texto) => ({ texto }));
/** Roda uma linha só e devolve pares [textoOriginal, textoNovo]. */
const subs = (s, n) => detectarSubstituicoes([L(s)], n).substituicoes.map((x) => [x.token.texto, x.textoNovo]);

test("linha de acordes clássica", () => {
  assert.deepEqual(subs("G   D/F#   Em", 2), [["G", "A"], ["D/F#", "E/G#"], ["Em", "F#m"]]);
});

test("linhas de letra ficam intactas (artigo A / conjunção E)", () => {
  assert.deepEqual(subs("A menina que passa danca", 2), []);
  assert.deepEqual(subs("E o vento leva a saudade", 2), []);
});

test("rótulo-prefixo é ignorável", () => {
  assert.deepEqual(subs("Intro: E A9 B", 1), [["E", "F"], ["A9", "Bb9"], ["B", "C"]]);
  assert.deepEqual(subs("Primeira parte: G", 2), [["G", "A"]]);
  // ':' dentro de grupo não é rótulo — grupos são reconhecidos primeiro (ordem do spec)
  assert.deepEqual(subs("[Refrão: 2x] G D Em", 2), [["G", "A"], ["D", "E"], ["Em", "F#m"]]);
});

test("delimitador | despido e reanexado verbatim", () => {
  assert.deepEqual(subs("|Em|  A7(9)", 1), [["|Em|", "|Fm|"], ["A7(9)", "Bb7(9)"]]);
});

test("grupo todo-acorde transpõe preservando delimitadores", () => {
  assert.deepEqual(subs("(D7)", 2), [["(D7)", "(E7)"]]);
  assert.deepEqual(subs("(G D/F# Em)", 2), [["(G", "(A"], ["D/F#", "E/G#"], ["Em)", "F#m)"]]);
  assert.deepEqual(subs("[Bm]", 1), [["[Bm]", "[Cm]"]]);
});

test("grupo com não-acorde é ignorável por inteiro", () => {
  assert.deepEqual(subs("Em (repete 2x)", 1), [["Em", "Fm"]]);
  assert.deepEqual(subs("A (2x)", 1), [["A", "Bb"]]); // falso positivo aceito pelo spec
  assert.deepEqual(subs("(Solo)", 1), []);            // só grupo ignorável → 0 acordes
  assert.deepEqual(subs("(G 2x)", 1), []);            // misto → grupo inteiro ignorável
});

test("parênteses desbalanceados desclassificam a linha", () => {
  assert.deepEqual(subs("(G D", 2), []);
  assert.deepEqual(subs("G D)", 2), []);
});

test("ignoráveis avulsos não desqualificam nem viram acorde", () => {
  assert.deepEqual(subs("N.C. G x2 % | - ...", 2), [["G", "A"]]);
  assert.deepEqual(subs("x2 % | - ...", 2), []); // zero acordes → não é linha de acordes
});

test("contadores: só linhas com substituição contam", () => {
  const r = detectarSubstituicoes([L("G D"), L("A menina"), L("Em")], 2);
  assert.equal(r.substituicoes.length, 3);
  assert.equal(r.linhasAfetadas, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/detect.test.js`
Expected: FAIL — `Cannot find module .../detect.js`

- [ ] **Step 3: Implementar `detect.js`**

```js
// @ts-check
// Classificação de linhas e montagem de substituições — módulo puro.
// Ordem normativa (spec §Detecção): grupos sobre tokens crus → stripping → match.
import { ehAcorde, transporAcorde } from "./transpose.js";

/** @typedef {{ texto: string }} TokenBase */

// Ignoráveis, avaliados sobre o núcleo já despido.
const RE_IGNORAVEL = /^(x\d{1,2}|\d{1,2}x|%|n\.c\.|[-.,]+)$/i;

/**
 * Despe `|` das bordas, devolvendo as partes para reanexar verbatim.
 * @param {string} texto
 */
function despir(texto) {
  let a = 0, b = texto.length;
  while (a < b && texto[a] === "|") a++;
  while (b > a && texto[b - 1] === "|") b--;
  return { prefixo: texto.slice(0, a), nucleo: texto.slice(a, b), sufixo: texto.slice(b) };
}

/** Parênteses e colchetes internos do token fecham na ordem e terminam zerados? @param {string} texto */
function balanceado(texto) {
  for (const [abre, fecha] of [["(", ")"], ["[", "]"]]) {
    let prof = 0;
    for (const ch of texto) {
      if (ch === abre) prof++;
      else if (ch === fecha && --prof < 0) return false;
    }
    if (prof !== 0) return false;
  }
  return true;
}

/**
 * Analisa uma linha; devolve as substituições, ou [] se a linha não é de acordes.
 * @template {TokenBase} T
 * @param {T[]} linha
 * @param {number} n
 * @returns {{ token: T, textoNovo: string }[]}
 */
function analisarLinha(linha, n) {
  // 1. Grupos primeiro, sobre os tokens crus: span balanceado de ()/[] com 1+ tokens.
  /** @type {({tipo: "token", indice: number} | {tipo: "grupo", inicio: number, fim: number, abre: string, fecha: string})[]} */
  const unidades = [];
  for (let i = 0; i < linha.length; ) {
    const texto = linha[i].texto;
    const abre = texto[0] === "(" ? "(" : texto[0] === "[" ? "[" : null;
    if (!abre) {
      if (!balanceado(texto)) return []; // parêntese solto → linha desclassificada, fica intacta
      unidades.push({ tipo: "token", indice: i });
      i++;
      continue;
    }
    const fecha = abre === "(" ? ")" : "]";
    let prof = 0, fim = -1;
    for (let j = i; j < linha.length && fim < 0; j++) {
      for (const ch of linha[j].texto) {
        if (ch === abre) prof++;
        else if (ch === fecha && --prof < 0) return [];
      }
      if (prof === 0) fim = j; // fechou exatamente no fim do token j
    }
    if (fim < 0) return []; // grupo nunca fecha → linha intacta
    unidades.push({ tipo: "grupo", inicio: i, fim, abre, fecha });
    i = fim + 1;
  }

  // 2. Rótulo-prefixo, sobre as unidades: o último token avulso terminado em ':'
  // torna ele e todas as unidades anteriores (grupos inclusive) ignoráveis.
  // Depois dos grupos, como manda a ordem única do spec — um ':' DENTRO de um
  // grupo (ex.: "[Refrão: 2x]") não é rótulo.
  let inicioUtil = 0;
  for (let u = unidades.length - 1; u >= 0; u--) {
    const un = unidades[u];
    if (un.tipo === "token" && linha[un.indice].texto.endsWith(":")) { inicioUtil = u + 1; break; }
  }

  // 3. Stripping + match sobre tokens despidos.
  /** @type {{ token: T, prefixo: string, nucleo: string, sufixo: string }[]} */
  const acordes = [];
  for (const u of unidades.slice(inicioUtil)) {
    if (u.tipo === "token") {
      const d = despir(linha[u.indice].texto);
      if (d.nucleo === "" || RE_IGNORAVEL.test(d.nucleo)) continue;
      if (!ehAcorde(d.nucleo)) return []; // não-acorde, não-ignorável → linha de letra
      acordes.push({ token: linha[u.indice], ...d });
    } else {
      // Grupo: despe os delimitadores do grupo nas bordas. Ignorável por padrão
      // ((Solo), (2x), [Verso 2]) — exceto se todo o conteúdo interno for acorde.
      /** @type {{ token: T, prefixo: string, nucleo: string, sufixo: string }[]} */
      const internos = [];
      for (let k = u.inicio; k <= u.fim; k++) {
        let texto = linha[k].texto, prefixo = "", sufixo = "";
        if (k === u.inicio && texto.startsWith(u.abre)) { prefixo = u.abre; texto = texto.slice(1); }
        if (k === u.fim && texto.endsWith(u.fecha)) { sufixo = u.fecha; texto = texto.slice(0, -1); }
        const d = despir(texto);
        internos.push({ token: linha[k], prefixo: prefixo + d.prefixo, nucleo: d.nucleo, sufixo: d.sufixo + sufixo });
      }
      const comConteudo = internos.filter((x) => x.nucleo !== "");
      if (comConteudo.length > 0 && comConteudo.every((x) => ehAcorde(x.nucleo))) {
        acordes.push(...comConteudo);
      }
    }
  }

  // 4. Linha de acordes = ≥1 acorde e zero não-ignoráveis (o return do passo 3 garante).
  if (acordes.length === 0) return [];
  /** @type {{ token: T, textoNovo: string }[]} */
  const substituicoes = [];
  for (const a of acordes) {
    const novo = transporAcorde(a.nucleo, n);
    if (novo !== a.nucleo) substituicoes.push({ token: a.token, textoNovo: a.prefixo + novo + a.sufixo });
  }
  return substituicoes;
}

/**
 * Detecta linhas de acordes e monta as substituições (apenas tokens cujo texto muda).
 * Metadados extras dos tokens (quads, origem, fonte…) passam intactos em `token`.
 * @template {TokenBase} T
 * @param {T[][]} linhas
 * @param {number} n — semitons, inteiro ≠ 0 em [-11, 11]
 * @returns {{ substituicoes: { token: T, textoNovo: string }[], linhasAfetadas: number }}
 */
export function detectarSubstituicoes(linhas, n) {
  /** @type {{ token: T, textoNovo: string }[]} */
  const substituicoes = [];
  let linhasAfetadas = 0;
  for (const linha of linhas) {
    const subs = analisarLinha(linha, n);
    if (subs.length === 0) continue;
    linhasAfetadas++;
    substituicoes.push(...subs);
  }
  return { substituicoes, linhasAfetadas };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/detect.test.js test/transpose.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add detect.js test/detect.test.js
git commit -m "feat: classificação de linhas de acordes e substituições (módulo puro)"
```

---

### Task 6: `worker.js` — pipeline PDF completo + testes de integração

Versão de produção da mecânica validada no spike (coletar → detect → redigir → reinserir → salvar), agora usando `detect.js` de verdade. O arquivo exporta `transporPdf` (testável em Node com a devDependency) e registra o protocolo de mensagens só quando roda como worker de verdade. **Antes de escrever: ler `test/spike/RESULTADO.md` e aplicar toda divergência de API registrada lá** (formato de `origin`/`quad`, assinatura de `addStream`, etc.).

**Files:**
- Create: `worker.js`
- Test: `test/integracao.test.js`

**Interfaces:**
- Consumes: `detectarSubstituicoes(linhas, n)` de `./detect.js`; `criarPdf`/`salvar`/`LINHAS_CIFRA` e `extrairTexto`/`extrairTokens` dos testes.
- Produces:
  - `transporPdf(mupdf: typeof import("mupdf"), dados: ArrayBuffer|Uint8Array, n: number, aoProgredir?: (pagina: number, total: number) => void): { dados: Uint8Array, acordes: number, linhas: number }` — lança `Error` com mensagem pt-BR (`Nenhum acorde detectado`, senha, arquivo inválido).
  - Protocolo do worker: recebe `{ dados: ArrayBuffer, n: number }`; emite `{ tipo: "progresso", pagina, total }`, `{ tipo: "ok", dados: Uint8Array, acordes, linhas }` (com transfer) ou `{ tipo: "erro", mensagem }`.

- [ ] **Step 1: Teste que falha**

`test/integracao.test.js`:
```js
// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import * as mupdf from "mupdf";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transporPdf } from "../worker.js";
import { criarPdf, salvar, LINHAS_CIFRA } from "./fixtures/gerar.mjs";
import { extrairTexto, extrairTokens } from "./util.mjs";

const bytesDe = (doc) => doc.saveToBuffer("").asUint8Array().slice();
const abrir = (/** @type {Uint8Array} */ bytes) =>
  /** @type {mupdf.PDFDocument} */ (mupdf.Document.openDocument(bytes, "application/pdf"));

test("transpõe +2 preservando a letra, com contadores certos", () => {
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA)), 2);
  const doc = abrir(r.dados);
  const tokens = extrairTokens(doc).map((t) => t.texto);
  for (const esperado of ["A", "E/G#", "F#m", "D#m7(b5)", "C", "Eº", "(E7)", "|F#m|", "B7(9)"]) {
    assert.ok(tokens.includes(esperado), `falta ${esperado} em ${tokens}`);
  }
  assert.ok(!tokens.includes("G"), "acorde antigo G ainda presente");
  const texto = extrairTexto(doc);
  assert.match(texto, /A menina que passa danca/);
  assert.match(texto, /E o vento leva a saudade/);
  // 3 (Intro) + 3 (linha G D/F# Em) + 4 (C#m7(b5) Bb Dº (D7)) + 2 (|Em| A7(9)) = 12 acordes, 4 linhas
  assert.equal(r.acordes, 12);
  assert.equal(r.linhas, 4);
});

test("origens preservadas dentro da tolerância", () => {
  const antes = extrairTokens(criarPdf(["G   D/F#   Em"]));
  const r = transporPdf(mupdf, bytesDe(criarPdf(["G   D/F#   Em"])), 2);
  const depois = extrairTokens(abrir(r.dados));
  const em = antes.find((t) => t.texto === "Em");
  const fsm = depois.find((t) => t.texto === "F#m");
  assert.ok(em && fsm, "tokens não encontrados");
  assert.ok(Math.abs(em.x - fsm.x) < 0.7, `desvio x: ${em.x} → ${fsm.x}`);
  assert.ok(Math.abs(em.y - fsm.y) < 0.7, `desvio y: ${em.y} → ${fsm.y}`);
});

test("página com /Rotate 90: transpõe e preserva a letra (redação não come a linha vizinha)", () => {
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { rotate: 90 })), 2);
  const doc = abrir(r.dados);
  const texto = extrairTexto(doc);
  assert.match(texto, /A menina que passa danca/);
  assert.match(texto, /E o vento leva a saudade/);
  assert.ok(extrairTokens(doc).map((t) => t.texto).includes("F#m"));
  assert.equal(r.acordes, 12);
});

test("zero acordes → erro 'Nenhum acorde detectado'", () => {
  const semAcordes = criarPdf(["Documento sem nenhum acorde.", "So texto comum aqui."]);
  assert.throws(() => transporPdf(mupdf, bytesDe(semAcordes), 2), /Nenhum acorde detectado/);
});

test("PDF com senha → erro claro", () => {
  const caminho = join(mkdtempSync(join(tmpdir(), "transposer-")), "senha.pdf");
  salvar(criarPdf(LINHAS_CIFRA), caminho, "encrypt=aes-128,user-password=teste,owner-password=teste");
  assert.throws(() => transporPdf(mupdf, new Uint8Array(readFileSync(caminho)), 2), /senha/);
});

test("progresso é reportado por página", () => {
  /** @type {number[][]} */
  const chamadas = [];
  transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA)), 2, (pagina, total) => chamadas.push([pagina, total]));
  assert.deepEqual(chamadas, [[1, 1]]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/integracao.test.js`
Expected: FAIL — `Cannot find module .../worker.js`

- [ ] **Step 3: Implementar `worker.js`**

```js
// @ts-check
// Cola MuPDF: abre → coleta (walk) → detecta → redige → reinsere → salva.
// Exporta transporPdf para os testes Node; o protocolo de worker registra-se
// sozinho quando o arquivo roda num Web Worker de verdade.
import { detectarSubstituicoes } from "./detect.js";

/** @typedef {typeof import("mupdf")} Mupdf */
/**
 * @typedef {{ texto: string, origem: {x: number, y: number}, direcao: number[],
 *   quads: number[][], tamanho: number, cor: number[],
 *   fonte: {mono: boolean, serifa: boolean, negrito: boolean, italico: boolean} }} Token
 */
/** @typedef {Token & { textoNovo: string }} Substituicao */

/**
 * Transpõe todos os acordes do PDF em n semitons, in-place.
 * @param {Mupdf} mupdf
 * @param {ArrayBuffer | Uint8Array} dados
 * @param {number} n — inteiro ≠ 0 em [-11, 11]
 * @param {(pagina: number, total: number) => void} [aoProgredir]
 * @returns {{ dados: Uint8Array, acordes: number, linhas: number }}
 */
export function transporPdf(mupdf, dados, n, aoProgredir = () => {}) {
  /** @type {import("mupdf").Document} */
  let doc;
  try {
    doc = mupdf.Document.openDocument(dados, "application/pdf");
  } catch {
    throw new Error("Não foi possível abrir o arquivo como PDF.");
  }
  if (doc.needsPassword()) throw new Error("Este PDF é protegido por senha — envie uma versão sem senha.");
  if (!(doc instanceof mupdf.PDFDocument)) throw new Error("Não foi possível abrir o arquivo como PDF.");

  const total = doc.countPages();
  let acordes = 0, linhasAfetadas = 0;
  for (let i = 0; i < total; i++) {
    aoProgredir(i + 1, total);
    const pagina = doc.loadPage(i);
    const linhas = coletarLinhas(pagina); // coordenadas coletadas ANTES de qualquer mutação
    const r = detectarSubstituicoes(linhas, n);
    if (r.substituicoes.length === 0) continue;
    const subs = r.substituicoes.map((s) => ({ ...s.token, textoNovo: s.textoNovo }));
    apagarTokens(mupdf, pagina, subs);
    reinserir(mupdf, doc, pagina, subs);
    acordes += subs.length;
    linhasAfetadas += r.linhasAfetadas;
  }
  if (acordes === 0) throw new Error("Nenhum acorde detectado");

  // .slice(): asUint8Array é uma view do heap WASM — copiar antes de transferir.
  const bytes = doc.saveToBuffer("garbage,compress").asUint8Array().slice();
  return { dados: bytes, acordes, linhas: linhasAfetadas };
}

/**
 * Linhas de tokens da página, com origem/quads/fonte/tamanho/cor por token.
 * @param {import("mupdf").PDFPage} pagina
 * @returns {Token[][]}
 */
function coletarLinhas(pagina) {
  /** @type {Token[][]} */
  const linhas = [];
  /** @type {Token[]} */
  let linha = [];
  /** @type {Token | null} */
  let atual = null;
  /** @type {number[]} direção de leitura da linha atual (espaço MuPDF), do beginLine */
  let direcao = [1, 0];
  const fecharToken = () => { if (atual && atual.texto) linha.push(atual); atual = null; };
  const fecharLinha = () => { fecharToken(); if (linha.length) linhas.push(linha); linha = []; };
  pagina.toStructuredText().walk({
    beginLine(bbox, wmode, dir) { fecharLinha(); direcao = dir; },
    onChar(c, origem, fonte, tamanho, quad, cor) {
      if (c.trim() === "") { fecharToken(); return; }
      if (!atual) {
        atual = {
          texto: "",
          origem: { x: origem[0], y: origem[1] }, direcao,
          quads: [], tamanho, cor, // na 1.27.0 cor = RGB 3 componentes 0–1, sempre
          fonte: { mono: fonte.isMono(), serifa: fonte.isSerif(), negrito: fonte.isBold(), italico: fonte.isItalic() },
        };
      }
      atual.texto += c;
      atual.quads.push(quad);
    },
    endLine: fecharLinha,
  });
  fecharLinha();
  return linhas;
}

/**
 * Retângulo-união dos quads, encolhido no eixo da ENTRELINHA (perpendicular à
 * direção da linha) para não tocar linhas vizinhas: linha horizontal separa-se
 * em Y; em página /Rotate 90/270 com texto reto no PDF space, em X.
 * Quads e rects de anotação estão ambos no espaço MuPDF — sem conversão.
 * @param {number[][]} quads @param {number[]} direcao
 * @returns {[number, number, number, number]}
 */
function retanguloDe(quads, direcao, encolhe = 0.1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of quads) {
    x0 = Math.min(x0, q[0], q[2], q[4], q[6]); x1 = Math.max(x1, q[0], q[2], q[4], q[6]);
    y0 = Math.min(y0, q[1], q[3], q[5], q[7]); y1 = Math.max(y1, q[1], q[3], q[5], q[7]);
  }
  if (Math.abs(direcao[0]) >= Math.abs(direcao[1])) {
    const dy = (y1 - y0) * encolhe;
    return [x0, y0 + dy, x1, y1 - dy];
  }
  const dx = (x1 - x0) * encolhe;
  return [x0 + dx, y0, x1 - dx, y1];
}

/**
 * Uma anotação de redação por token + UM applyRedactions com parâmetros explícitos
 * (os defaults pintam caixas pretas, furam imagens e apagam line-art).
 * @param {Mupdf} mupdf @param {import("mupdf").PDFPage} pagina @param {Substituicao[]} subs
 */
function apagarTokens(mupdf, pagina, subs) {
  for (const s of subs) pagina.createAnnotation("Redact").setRect(retanguloDe(s.quads, s.direcao));
  pagina.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE,
    mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
}

const fmt = (/** @type {number} */ v) => v.toFixed(4).replace(/\.?0+$/, "");

/**
 * Tm que reproduz a colocação original: eixo do texto → M(direção da linha do
 * walk), eixo vertical do glifo → M(up), origem → M(origem), com M =
 * page.getTransform() (MuPDF→PDF, aplicação direta) e up = [dir.y, −dir.x]
 * (perpendicular à esquerda da leitura, espaço MuPDF y-baixo). Cobre página
 * normal ([1,0,0,1,x,H−y]), /Rotate com texto reto (translação pura) e /Rotate
 * com texto pré-rotacionado (rotação herdada) — confirmar no spike (RESULTADO.md).
 * @param {number[]} M @param {{x: number, y: number}} origem @param {number[]} dir
 */
function matrizTexto(M, origem, dir) {
  const up = [dir[1], -dir[0]];
  const lin = (/** @type {number[]} */ v) => [v[0] * M[0] + v[1] * M[2], v[0] * M[1] + v[1] * M[3]];
  const [a, b] = lin(dir), [c, d] = lin(up);
  return [a, b, c, d,
    origem.x * M[0] + origem.y * M[2] + M[4],
    origem.x * M[1] + origem.y * M[3] + M[5]];
}

/**
 * Nunca literal (…): parêntese desbalanceado corrompe o stream; º/°/ø em UTF-8
 * viram glifo errado. WinAnsi ≈ Latin-1 fora de 0x80–0x9F; '?' para o resto.
 * @param {string} texto
 */
function paraHexWinAnsi(texto) {
  let hex = "";
  for (const ch of texto) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    const b = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : 0x3f;
    hex += b.toString(16).padStart(2, "0");
  }
  return "<" + hex + ">";
}

/** @param {Token["fonte"]} f */
function nomeFonteBase14({ mono, serifa, negrito, italico }) {
  if (serifa && !mono) {
    return negrito && italico ? "Times-BoldItalic" : negrito ? "Times-Bold" : italico ? "Times-Italic" : "Times-Roman";
  }
  const base = mono ? "Courier" : "Helvetica";
  return base + (negrito && italico ? "-BoldOblique" : negrito ? "-Bold" : italico ? "-Oblique" : "");
}

/**
 * /Resources é herdável e pode ser compartilhado entre páginas: copiar SEMPRE
 * (cópia rasa) para dicionários próprios da página antes de mexer. Idem /Font.
 * @param {import("mupdf").PDFDocument} doc @param {import("mupdf").PDFObject} paginaObj
 */
function prepararFontes(doc, paginaObj) {
  const copiar = (/** @type {import("mupdf").PDFObject | null} */ orig) => {
    const d = doc.newDictionary();
    if (orig && !orig.isNull()) orig.forEach((v, k) => d.put(k, v));
    return d;
  };
  const recursos = copiar(paginaObj.getInheritable("Resources"));
  const fontes = copiar(recursos.get("Font"));
  recursos.put("Font", fontes);
  paginaObj.put("Resources", recursos);
  return fontes;
}

/**
 * Reinsere os acordes transpostos: 'q' prefixado ao /Contents original + 'Q'
 * inicial neutralizam CTM residual; cada inserção tem q…Q próprio + reset de
 * estado de texto (0 Tc 0 Tw 100 Tz 0 Ts 0 Tr) antes do BT.
 * @param {Mupdf} mupdf @param {import("mupdf").PDFDocument} doc
 * @param {import("mupdf").PDFPage} pagina @param {Substituicao[]} subs
 */
function reinserir(mupdf, doc, pagina, subs) {
  const paginaObj = pagina.getObject();
  const fontes = prepararFontes(doc, paginaObj);
  /** @type {Map<string, string>} */
  const nomes = new Map(); // nome base-14 → nome do recurso na página
  const registrar = (/** @type {string} */ base14) => {
    let i = 0, nome = "TRq0";
    while (fontes.get(nome) && !fontes.get(nome).isNull()) nome = "TRq" + ++i;
    fontes.put(nome, doc.addSimpleFont(new mupdf.Font(base14), "Latin"));
    return nome;
  };
  const M = pagina.getTransform();
  let codigo = "Q\n";
  for (const s of subs) {
    const base14 = nomeFonteBase14(s.fonte);
    let nome = nomes.get(base14);
    if (!nome) { nome = registrar(base14); nomes.set(base14, nome); }
    const [r, g, b] = s.cor;
    codigo += "q 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr BT\n"
      + `${fmt(r)} ${fmt(g)} ${fmt(b)} rg\n`
      + `/${nome} ${fmt(s.tamanho)} Tf\n`
      + matrizTexto(M, s.origem, s.direcao).map(fmt).join(" ") + " Tm\n"
      + paraHexWinAnsi(s.textoNovo) + " Tj\nET Q\n";
  }
  const arr = doc.newArray();
  arr.push(doc.addStream("q\n", null));
  const atual = paginaObj.get("Contents");
  if (atual.isArray()) atual.forEach((v) => arr.push(v));
  else if (!atual.isNull()) arr.push(atual);
  arr.push(doc.addStream(codigo, null));
  paginaObj.put("Contents", arr);
}

// ——— protocolo do worker (só quando rodando num Web Worker de verdade) ———
// Globals de worker via cast: o lib "webworker" do TS conflita com "dom" no
// jsconfig, e em Node (testes) esses globals nem existem.
const ctx = /** @type {any} */ (globalThis);
if (typeof ctx.WorkerGlobalScope !== "undefined" && globalThis instanceof ctx.WorkerGlobalScope) {
  const URL_MUPDF = "https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf.js";
  /** @type {Promise<Mupdf> | null} */
  let carregando = null;
  // import() com URL em variável: o language server não tenta resolver; o cast dá os tipos da devDependency.
  const carregarMupdf = () => (carregando ??= /** @type {Promise<Mupdf>} */ (import(URL_MUPDF)));

  ctx.onmessage = async (/** @type {MessageEvent} */ ev) => {
    const { dados, n } = ev.data;
    try {
      const mupdf = await carregarMupdf();
      const r = transporPdf(mupdf, dados, n,
        (pagina, total) => ctx.postMessage({ tipo: "progresso", pagina, total }));
      ctx.postMessage({ tipo: "ok", dados: r.dados, acordes: r.acordes, linhas: r.linhas }, [r.dados.buffer]);
    } catch (e) {
      ctx.postMessage({ tipo: "erro", mensagem: e instanceof Error ? e.message : String(e) });
    }
  };
}
```

Se o spike registrou divergências (assinatura de `addStream`, formato de `origin`/`quad`…), o código acima DEVE incorporá-las — o RESULTADO.md manda.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — todos os testes (fixtures, transpose, detect, integração).

- [ ] **Step 5: Verificação visual de regressão**

Run: `node test/fixtures/gerar.mjs && mkdir -p test/spike/saida && node -e "
import('mupdf').then(async (mupdf) => {
  const { transporPdf } = await import('./worker.js');
  const { readFileSync, writeFileSync } = await import('node:fs');
  const r = transporPdf(mupdf, new Uint8Array(readFileSync('test/fixtures/gerados/simples.pdf')), 2);
  const doc = mupdf.Document.openDocument(r.dados, 'application/pdf');
  writeFileSync('test/spike/saida/producao-p1.png',
    doc.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB).asPNG());
});"`
Ler `test/spike/saida/producao-p1.png` e conferir: acordes transpostos no lugar, letra intacta, line-art intacta — mesmo padrão de qualidade do spike, agora com a detecção real (letra "A menina…" NÃO transposta, ao contrário do spike).

- [ ] **Step 6: Commit**

```bash
git add worker.js test/integracao.test.js
git commit -m "feat: pipeline redact+reinsert no worker + testes de integração"
```

---

### Task 7: UI (`index.html` + `app.js`) + verificação ponta-a-ponta

Uma tela, sem preview: arquivo (com drag-drop), stepper de semitons, botão Transpor, linha de status, download automático.

**Files:**
- Create: `index.html`, `app.js`
- Modify: `README.md` (versão final)

**Interfaces:**
- Consumes: protocolo do worker da Task 6 — envia `{ dados: ArrayBuffer, n: number }` (com transfer), recebe `{ tipo: "progresso" | "ok" | "erro", … }`.

- [ ] **Step 1: `index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transposer — transpõe cifras em PDF</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 26rem; margin: 4rem auto; padding: 0 1rem; display: grid; gap: 1rem; }
  h1 { text-align: center; margin: 0; }
  #area { border: 2px dashed #999; border-radius: 8px; padding: 2rem 1rem; text-align: center; cursor: pointer; }
  #area.arrastando { border-color: #06c; background: #eef6ff; }
  #controles { display: flex; gap: 1rem; align-items: center; justify-content: center; }
  #semitons { width: 5rem; font-size: 1.2rem; text-align: center; }
  button { font-size: 1.1rem; padding: 0.5rem 2rem; }
  #status { min-height: 1.5rem; text-align: center; margin: 0; }
  #status.erro { color: #b00020; }
</style>
</head>
<body>
  <h1>Transposer</h1>
  <div id="area">
    <input type="file" id="arquivo" accept="application/pdf" hidden>
    <span id="rotulo">Arraste um PDF de cifra aqui ou clique para escolher</span>
  </div>
  <div id="controles">
    <label for="semitons">Semitons:</label>
    <input type="number" id="semitons" min="-11" max="11" step="1" value="0">
    <button id="transpor" disabled>Transpor</button>
  </div>
  <p id="status"></p>
  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `app.js`**

```js
// @ts-check
// Lógica da página: seleção de arquivo, semitons, worker, download.
const ROTULO_PADRAO = "Arraste um PDF de cifra aqui ou clique para escolher";

const entrada = /** @type {HTMLInputElement} */ (document.getElementById("arquivo"));
const area = /** @type {HTMLElement} */ (document.getElementById("area"));
const rotulo = /** @type {HTMLElement} */ (document.getElementById("rotulo"));
const semitons = /** @type {HTMLInputElement} */ (document.getElementById("semitons"));
const botao = /** @type {HTMLButtonElement} */ (document.getElementById("transpor"));
const status = /** @type {HTMLElement} */ (document.getElementById("status"));

const worker = new Worker("./worker.js", { type: "module" });

/** @type {File | null} */
let arquivo = null;
/** @type {{ nome: string, n: number } | null} — captura no clique; usuário pode mexer na UI durante o processamento */
let emCurso = null;

function lerN() {
  const v = Number(semitons.value);
  return Number.isInteger(v) && v >= -11 && v <= 11 ? v : 0;
}
function atualizar() {
  botao.disabled = emCurso !== null || !arquivo || lerN() === 0;
}
function avisar(/** @type {string} */ mensagem, ehErro = false) {
  status.textContent = mensagem;
  status.classList.toggle("erro", ehErro);
}
function escolher(/** @type {File | undefined} */ f) {
  const ehPdf = !!f && (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  arquivo = ehPdf && f ? f : null;
  rotulo.textContent = arquivo ? arquivo.name : ROTULO_PADRAO;
  avisar(f && !ehPdf ? "Escolha um arquivo PDF." : "", !!f && !ehPdf);
  atualizar();
}

area.addEventListener("click", () => entrada.click());
entrada.addEventListener("change", () => escolher(entrada.files?.[0]));
area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("arrastando"); });
area.addEventListener("dragleave", () => area.classList.remove("arrastando"));
area.addEventListener("drop", (e) => {
  e.preventDefault();
  area.classList.remove("arrastando");
  escolher(e.dataTransfer?.files?.[0]);
});
semitons.addEventListener("input", atualizar);

botao.addEventListener("click", async () => {
  if (!arquivo || lerN() === 0 || emCurso) return;
  emCurso = { nome: arquivo.name, n: lerN() };
  atualizar();
  avisar("Carregando…");
  const dados = await arquivo.arrayBuffer();
  worker.postMessage({ dados, n: emCurso.n }, [dados]);
});

worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.tipo === "progresso") {
    avisar(`Processando página ${m.pagina}/${m.total}…`);
    return;
  }
  const contexto = emCurso;
  emCurso = null;
  atualizar();
  if (m.tipo === "erro") { avisar(m.mensagem, true); return; }
  const blob = new Blob([m.dados], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const base = (contexto?.nome ?? "cifra.pdf").replace(/\.pdf$/i, "");
  const n = contexto?.n ?? 0;
  a.download = `${base} (${n > 0 ? "+" : ""}${n}).pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
  avisar(`${m.acordes} acordes transpostos em ${m.linhas} linhas`);
};
worker.onerror = () => {
  emCurso = null;
  atualizar();
  avisar("Erro inesperado no processamento.", true);
};
```

- [ ] **Step 3: Verificação ponta-a-ponta no browser**

Run (em background, se já não estiver rodando): `python3 -m http.server 8080`
Com Playwright (ou manualmente) em `http://localhost:8080/`:
1. Página carrega; botão **Transpor** desabilitado.
2. Selecionar `test/fixtures/gerados/simples.pdf` via input; botão continua desabilitado (n=0).
3. Semitons = 2; botão habilita. Clicar.
4. Status passa por `Processando página 1/1…` e termina em `12 acordes transpostos em 4 linhas`; download `simples (+2).pdf` disparado.
5. Selecionar `test/fixtures/gerados/senha.pdf` → status vermelho pedindo PDF sem senha.
6. Selecionar `test/fixtures/gerados/semacordes.pdf` → status `Nenhum acorde detectado`, sem download.
7. Semitons = −2 com `simples.pdf` → download `simples (-2).pdf`.

Abrir o PDF baixado (n=+2) e conferir visualmente os acordes transpostos e a letra intacta.

- [ ] **Step 4: README final**

`README.md` (substituir o stub):
```markdown
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
```

- [ ] **Step 5: Suíte completa + commit**

Run: `npm test`
Expected: PASS (todos).

```bash
git add index.html app.js README.md
git commit -m "feat: UI mínima (arquivo, semitons, transpor, download)"
```

---

## Fora de escopo (não fazer)

Preview, OCR, acordes inline `[A]`, detecção de tom, opção ♯/♭, reuso de fonte embutida (v2, com exclusão explícita de fontes compostas), reposicionamento de acordes alargados, PWA/service worker, plano B (reescrita direta de content stream — só com NO-GO do spike **e** decisão do usuário).

## Sequência e gates

1. **Task 1** → gate: smoke CDN+worker passa no browser.
2. **Task 2** → fixtures verdes.
3. **Task 3 (spike)** → gate: RESULTADO.md com **GO**. NO-GO = parar o plano e reportar.
4. **Tasks 4–5** (puros, TDD) → `npm test` verde.
5. **Task 6** (worker) → integração verde + PNG de regressão inspecionado.
6. **Task 7** (UI) → E2E no browser + README.

