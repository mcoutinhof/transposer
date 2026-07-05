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
