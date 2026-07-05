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
