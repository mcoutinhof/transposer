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
