// @ts-check
// Gramática do acorde e transposição — módulo puro, zero dependências.
// Regras normativas: spec §Detecção (gramática) e §Transposição (mapa de saída).

const RE_NOTA = "[A-G](?:#|b)?";
// Alternativas multi-letra antes das de 1 letra (maj antes de m, etc.).
// Dígito único de propósito: sob o `*` externo, [0-9] aceita exatamente a mesma
// linguagem que [0-9]{1,2} — e a forma {1,2} é ambígua, causando backtracking
// exponencial em tokens como "C777…7z" (PDF é entrada arbitrária do usuário).
// `/` seguido de número/alteração é extensão, não baixo: G6/9, A7/9, Bm7/5-, C7/b9
// (o baixo é sempre nota MAIÚSCULA, então não há ambiguidade).
const RE_ATOMO = "(?:maj|min|dim|aug|sus|add|m|M|\\+|-|º|°|ø|#|b|[0-9]|\\(|\\)|,|\\.|\\/(?=[0-9#b+-]))";
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

/** Nota avulsa minúscula (baixo caminhante, notas de passagem): f#, g#, bb, c, g. */
const RE_NOTA_MINUSCULA = /^(?:[a-g][#b]|[bcdfg])$/; // "a"/"e" nus de fora: são palavras do português

/** @param {string} token */
export function ehNotaMinuscula(token) {
  return RE_NOTA_MINUSCULA.test(token);
}

/**
 * Transpõe nota avulsa minúscula preservando a caixa: f# +1 → g, g +2 → a, g# +2 → bb.
 * @param {string} nota @param {number} n
 */
export function transporNotaMinuscula(nota, n) {
  const t = transporNota(nota[0].toUpperCase() + nota.slice(1), n);
  return t[0].toLowerCase() + t.slice(1);
}
