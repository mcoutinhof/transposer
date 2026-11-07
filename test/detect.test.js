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

test("acordes colados: token reescrito inteiro, cada pedaço transposto (regressão: hino-232 'AE')", () => {
  assert.deepEqual(subs("E A E/B B7 E AE", 2).at(-1), ["AE", "BF#"]);
  assert.deepEqual(subs("G D B7Em", 2).at(-1), ["B7Em", "C#7F#m"]);
  assert.deepEqual(subs("Em7 D|C", 2).at(-1), ["D|C", "E|D"]);       // barra interna preservada
  assert.deepEqual(subs("G D/F# DA", 2).at(-1), ["DA", "EB"]);       // baixo D/F# não é cortado
  assert.deepEqual(subs("G D/F# DA", 2)[1], ["D/F#", "E/G#"]);
  // caixa alta só com A–G: 4+ pedaços não é colagem; e sem acorde forte não vale
  assert.deepEqual(subs("G D CADA", 2), []);
  assert.deepEqual(subs("A DE", 2), []);
});

test("rótulos de seção e instruções em qualquer posição, sem ':' e em qualquer caixa/acento", () => {
  assert.deepEqual(subs("Intro G D", 2), [["G", "A"], ["D", "E"]]);
  assert.deepEqual(subs("| C9 | C9 - - Dm7 - - | Solo |", 2).length, 3);
  for (const v of ["Violão", "violao", "VIOLAO", "VIOLÃO", "Voz/Violão"]) {
    assert.deepEqual(subs(`| A9 D9/A | ${v}`, 2), [["A9", "B9"], ["D9/A", "E9/B"]], v);
  }
  assert.deepEqual(subs("D9 stop", 2), [["D9", "E9"]]);
  assert.deepEqual(subs("G A F#m 3 vezes", 2).length, 3);
  assert.deepEqual(subs("Gsus G 1ª vez", 2).length, 2);
  assert.deepEqual(subs("D A Bm _ G A", 2).length, 5);
});

test("ignoráveis condicionais exigem acorde forte (A/E/Em sozinhos são palavras)", () => {
  assert.deepEqual(subs("A voz", 2), []);
  assert.deepEqual(subs("E no", 2), []);
  assert.deepEqual(subs("Em 3", 2), []);
  assert.deepEqual(subs("E …", 2), []);
  // rótulos que também são palavras: só valem sozinhos na 1ª posição
  assert.deepEqual(subs("Em coro", 2), []);
  assert.deepEqual(subs("E outro", 2), []);
  assert.deepEqual(subs("Intro A E", 2), [["A", "B"], ["E", "F#"]]);
  assert.deepEqual(subs("G D Solo", 2), [["G", "A"], ["D", "E"]]);
});

test("notas avulsas minúsculas só numa linha com acorde forte", () => {
  assert.deepEqual(subs("C9 g# f# D#", 2), [["C9", "D9"], ["g#", "bb"], ["f#", "g#"], ["D#", "F"]]);
  assert.deepEqual(subs("E f#", 2), []);
});

test("linha de afinação não é harmonia: fica intacta", () => {
  assert.deepEqual(subs("Afinação: E A D G B E", 2), []);
  assert.deepEqual(subs("AFINACAO: D A D G B E", 2), []);
});

test("linha com barras é avaliada por compasso: o trecho de texto fica, o resto transpõe", () => {
  assert.deepEqual(subs("Tudo governa | C#m G#m | B |", 2), [["C#m", "D#m"], ["G#m", "Bbm"], ["B", "C#"]]);
  assert.deepEqual(subs("A2(7M) | A2(7M | B/A |", 2), [["A2(7M)", "B2(7M)"], ["B/A", "C#/B"]]);
  // letra com '|' e só A/E: continua letra
  assert.deepEqual(subs("A casa | E o jardim", 2), []);
  assert.deepEqual(subs("Era uma vez | A", 2), []);
});

test("casos reais relatados: instruções misturadas a compassos", () => {
  assert.deepEqual(subs("C9 Em7 D | D ORGÃO CHURCH", 2), [["C9", "D9"], ["Em7", "F#m7"], ["D", "E"], ["D", "E"]]);
  assert.deepEqual(subs("F#/B B | B Break 2 comp", 2), [["F#/B", "G#/C#"], ["B", "C#"], ["B", "C#"]]);
});
