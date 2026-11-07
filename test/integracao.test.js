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

const bytesDe = (/** @type {mupdf.PDFDocument} */ doc) => doc.saveToBuffer("").asUint8Array().slice();
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

test("entrelinha apertada (0.82× a fonte): a redação não come a letra vizinha", () => {
  // Regressão: a banda antiga [baseline, +0.7] comia letra com entrelinha ≤ 0.85×.
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { entrelinha: 9 })), 2);
  const doc = abrir(r.dados);
  const texto = extrairTexto(doc);
  assert.match(texto, /A menina que passa danca/);
  assert.match(texto, /E o vento leva a saudade/);
  const tokens = extrairTokens(doc).map((t) => t.texto);
  for (const antigo of ["G", "D/F#", "Em", "C#m7(b5)", "Dº"]) assert.ok(!tokens.includes(antigo), `fantasma ${antigo}`);
  assert.equal(r.acordes, 12);
});

test("PDF digitalizado com OCR (texto invisível): erro claro, nada reinserido por cima da imagem", () => {
  assert.throws(() => transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { invisivel: true })), 2), /digitalizado/);
});

test("acordes colados: cada pedaço é reinserido na posição do original", () => {
  const linha = ["E   B7   AE"]; // B7: acorde forte (sem ele, "E A AE" poderia ser letra)
  const antes = extrairTokens(criarPdf(linha));
  const depois = extrairTokens(abrir(transporPdf(mupdf, bytesDe(criarPdf(linha)), 2).dados));
  const ae = antes.find((t) => t.texto === "AE");
  // os pedaços B e F# encostam (como A e E encostavam) e extraem como um token só
  const novo = depois.find((t) => t.texto === "BF#");
  assert.ok(ae && novo, `tokens: ${depois.map((t) => t.texto)}`);
  assert.ok(Math.abs(novo.x - ae.x) < 0.7 && Math.abs(novo.y - ae.y) < 0.7, "B no lugar do A colado");
  assert.ok(!depois.some((t) => t.texto === "AE"), "fantasma AE");
});

test("várias páginas reusam o mesmo objeto de fonte (sem duplicar por página)", () => {
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { paginas: 3 })), 2);
  const doc = abrir(r.dados);
  const nums = [0, 1, 2].map((i) => doc.loadPage(i).getObject().get("Resources").get("Font").get("TRq0").asIndirect());
  assert.equal(new Set(nums).size, 1, `objetos: ${nums}`);
  assert.equal(r.acordes, 36);
});

test("texto invisível minoritário (marca d'água oculta) não vira mensagem de PDF digitalizado", () => {
  const r = criarPdf(["Documento sem nenhum acorde.", "So texto comum aqui."], { posambulo: "BT 3 Tr /F1 11 Tf 50 100 Td (marca) Tj ET\n" });
  assert.throws(() => transporPdf(mupdf, bytesDe(r), 2), /^Error: Nenhum acorde detectado$/);
});
