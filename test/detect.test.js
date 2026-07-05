// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { detectarSubstituicoes } from "../detect.js";

/** Monta uma linha de tokens a partir de string (split por whitespace, como o worker faz). @param {string} s */
const L = (s) => s.split(/\s+/).filter(Boolean).map((texto) => ({ texto }));
/** Roda uma linha só e devolve pares [textoOriginal, textoNovo]. @param {string} s @param {number} n */
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
