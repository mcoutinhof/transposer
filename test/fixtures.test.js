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
