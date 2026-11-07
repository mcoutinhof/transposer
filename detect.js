// @ts-check
// Classificação de linhas e montagem de substituições — módulo puro.
// Ordem normativa (spec §Detecção): grupos sobre tokens crus → stripping → match.
import { ehAcorde, ehNotaMinuscula, transporAcorde, transporNotaMinuscula } from "./transpose.js";

/** @typedef {{ texto: string }} TokenBase */
/**
 * Substituição: o token inteiro vira `textoNovo` (delimitadores reanexados inclusive).
 * @template {TokenBase} T
 * @typedef {{ token: T, textoNovo: string }} Sub
 */

// Ignoráveis incondicionais, avaliados sobre o núcleo já despido.
const RE_IGNORAVEL = /^(x\d{1,2}|\d{1,2}x|%|n\.c\.|[-.,]+)$/i;

/** Minúsculas, sem acento, sem pontuação final — para casar vocabulário. @param {string} s */
const normalizar = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.,;:!]+$/, "");

// Vocabulário sempre comparado já normalizado: "Violão", "VIOLAO" e "violão" casam "violao".
// Rótulos de seção, mesmo sem ':': na 1ª posição do trecho valem sozinhos ("Intro A E");
// em outra posição são condicionais como as instruções — "outro", "coro", "solo", "verso",
// "fim" também são palavras, e "Em coro"/"E outro" não podem virar linha de acordes.
const ROTULOS = new Set(["intro", "introducao", "solo", "ponte", "refrao", "pre-refrao", "prerefrao", "coro",
  "verso", "interludio", "instrumental", "final", "fim", "finalizacao", "outro", "coda", "riff", "bis",
  "chorus", "verse", "bridge", "pre-chorus"]);
// Instruções de execução, instrumentos e dinâmica: CONDICIONAIS (ver `precisaForte`) —
// várias são palavras comuns que, com um "A"/"E", formariam linha de letra ("A voz", "E no").
const INSTRUCOES = new Set([
  // repetição / estrutura
  "vez", "vezes", "no", "na", "apenas", "so", "todos", "repete", "repetir", "comp", "compasso", "compassos",
  "tom", "feminino", "masculino", "convencao", "virada", "levada", "parada", "pausa", "break", "brake",
  "stop", "fade", "loop", "click", "tutti", "unissono", "dobra",
  // instrumentos e vozes
  "voz", "vozes", "vocal", "vocais", "back", "coral", "homens", "mulheres", "violao", "guitarra", "guitar",
  "baixo", "bass", "bateria", "drums", "teclado", "teclados", "keys", "piano", "orgao", "organ", "church",
  "pad", "synth", "cordas", "strings", "sax", "flauta", "metais", "percussao", "palmas", "marcacao",
  // execução e dinâmica
  "dedilhado", "batida", "arpejo", "arpejado", "quartais", "lento", "rapido", "devagar", "suave", "forte",
  "crescendo", "rit", "ritardando", "rall", "acapella", "capella",
]);
/** Palavra (ou composto "Voz/Violão", "Pré-Refrão") toda feita de vocabulário? @param {Set<string>} vocab @param {string} palavra */
const noVocab = (vocab, palavra) => vocab.has(palavra) || palavra.split(/[/+&-]/).every((p) => p !== "" && vocab.has(p));
// Números, ordinais e compassos ("3 vezes", "1ª vez", "6/8") e tokens sem letra nem dígito
// ("_", "…", ">", setas): também condicionais.
const RE_NUMERO = /^\d+(?:[ªº°]|\/\d+)?$/;
const RE_SIMBOLO = /^[^\p{L}\p{N}]+$/u;
// Acordes que também são palavras do português: não servem de evidência de linha de acordes.
const RE_FRACO = /^(?:A|E|Em)[.,]*$/;
// Rótulos de linhas que NÃO são harmonia — transpor mudaria a afinação do instrumento.
const ROTULOS_NAO_TRANSPOR = new Set(["afinacao", "tuning"]);

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
 * Acordes colados sem espaço ("AE", "B7Em", "G#4G#", "D|C"): corta antes de toda raiz
 * maiúscula que não seja baixo (não precedida de '/') e em volta de '|'. O corte é
 * determinístico — nenhum átomo da gramática contém A–G maiúsculo. Devolve as faixas
 * [inicio, fim) de cada acorde, ou null se algum pedaço não for acorde. Limite de 3
 * pedaços: palavras em caixa alta só com A–G ("CADA", "FACE", "BEBE") têm 4+.
 * O token é reescrito INTEIRO ("B7Em" → "C#7F#m"), não pedaço a pedaço na posição de
 * cada um: colado não tem folga, e o primeiro pedaço alargando (B7 → C#7) cobriria o
 * segundo. Inteiro, o segundo só desliza para a direita — legível.
 * @param {string} s
 * @returns {{ inicio: number, fim: number }[] | null}
 */
function separarColados(s) {
  /** @type {{ inicio: number, fim: number }[]} */
  const partes = [];
  let inicio = 0;
  for (let i = 1; i <= s.length; i++) {
    const corta = i === s.length || s[i] === "|" || s[i - 1] === "|" || (/[A-G]/.test(s[i]) && s[i - 1] !== "/");
    if (!corta) continue;
    if (s.slice(inicio, i) !== "|") partes.push({ inicio, fim: i });
    inicio = i;
  }
  if (partes.length < 2 || partes.length > 3) return null;
  return partes.every((p) => ehAcorde(s.slice(p.inicio, p.fim))) ? partes : null;
}

/**
 * @template {TokenBase} T
 * @typedef {{ subs: Sub<T>[], acordes: number, temForte: boolean, precisaForte: boolean }} Analise
 */
const REJEITADO = /** @type {const} */ ("rejeitado");       // tem texto que não é acorde nem ignorável
const NAO_TRANSPOR = /** @type {const} */ ("nao-transpor"); // rótulo de afinação: a linha inteira fica intacta

/**
 * Analisa um trecho de linha (a linha toda, ou um compasso entre barras).
 * @template {TokenBase} T
 * @param {T[]} linha
 * @param {number} n
 * @returns {Analise<T> | typeof REJEITADO | typeof NAO_TRANSPOR}
 */
function analisarSegmento(linha, n) {
  // 1. Grupos primeiro, sobre os tokens crus: span balanceado de ()/[] com 1+ tokens.
  /** @type {({tipo: "token", indice: number} | {tipo: "grupo", inicio: number, fim: number, abre: string, fecha: string})[]} */
  const unidades = [];
  for (let i = 0; i < linha.length; ) {
    const texto = linha[i].texto;
    const abre = texto[0] === "(" ? "(" : texto[0] === "[" ? "[" : null;
    if (!abre) {
      if (!balanceado(texto)) return REJEITADO; // parêntese solto → trecho desclassificado, fica intacto
      unidades.push({ tipo: "token", indice: i });
      i++;
      continue;
    }
    const fecha = abre === "(" ? ")" : "]";
    let prof = 0, fim = -1;
    for (let j = i; j < linha.length && fim < 0; j++) {
      for (const ch of linha[j].texto) {
        if (ch === abre) prof++;
        else if (ch === fecha && --prof < 0) return REJEITADO;
      }
      if (prof === 0) fim = j; // fechou exatamente no fim do token j
    }
    if (fim < 0) return REJEITADO; // grupo nunca fecha → trecho intacto
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
  for (const un of unidades.slice(0, inicioUtil)) {
    if (un.tipo === "token" && ROTULOS_NAO_TRANSPOR.has(normalizar(linha[un.indice].texto))) return NAO_TRANSPOR;
  }

  // 3. Stripping + match sobre tokens despidos.
  /** @type {Sub<T>[]} */
  const subs = [];
  let acordes = 0, temForte = false, precisaForte = false;
  /** @param {T} token @param {string} novo */
  const trocar = (token, novo) => { if (novo !== token.texto) subs.push({ token, textoNovo: novo }); };
  for (const [k, u] of unidades.slice(inicioUtil).entries()) {
    if (u.tipo === "token") {
      const token = linha[u.indice];
      const d = despir(token.texto);
      const palavra = normalizar(d.nucleo);
      // Rótulo de seção na 1ª posição funciona como "Intro:" sem os dois-pontos ("Intro A E").
      if (d.nucleo === "" || RE_IGNORAVEL.test(d.nucleo) || (k === 0 && noVocab(ROTULOS, palavra))) continue;
      if (ehAcorde(d.nucleo)) {
        acordes++;
        temForte ||= !RE_FRACO.test(d.nucleo);
        trocar(token, d.prefixo + transporAcorde(d.nucleo, n) + d.sufixo);
        continue;
      }
      // Daqui para baixo, tudo é condicional: só vale se a linha tiver acorde forte.
      precisaForte = true;
      if (noVocab(INSTRUCOES, palavra) || noVocab(ROTULOS, palavra) || RE_NUMERO.test(d.nucleo) || RE_SIMBOLO.test(d.nucleo)) continue;
      if (ehNotaMinuscula(d.nucleo)) {
        trocar(token, d.prefixo + transporNotaMinuscula(d.nucleo, n) + d.sufixo);
        continue;
      }
      const partes = separarColados(d.nucleo);
      if (!partes) return REJEITADO; // não-acorde, não-ignorável → letra
      let novo = "", pos = 0;
      for (const p of partes) {
        novo += d.nucleo.slice(pos, p.inicio) + transporAcorde(d.nucleo.slice(p.inicio, p.fim), n);
        pos = p.fim;
      }
      trocar(token, d.prefixo + novo + d.nucleo.slice(pos) + d.sufixo);
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
        for (const x of comConteudo) {
          acordes++;
          temForte ||= !RE_FRACO.test(x.nucleo);
          trocar(x.token, x.prefixo + transporAcorde(x.nucleo, n) + x.sufixo);
        }
      }
    }
  }

  return { subs, acordes, temForte, precisaForte };
}

/**
 * Analisa uma linha; devolve as substituições, ou [] se a linha não é de acordes.
 * Linha com barras ("| C9 | C9 Solo | Tudo governa |") é avaliada POR COMPASSO: o
 * trecho com texto que não é acorde fica intacto, sem derrubar os outros. Como a
 * linha então mistura texto, passa a exigir acorde forte — uma linha de letra com
 * '|' nunca vira "acordes" só por um "A"/"E" solto.
 * @template {TokenBase} T
 * @param {T[]} linha
 * @param {number} n
 * @returns {Sub<T>[]}
 */
function analisarLinha(linha, n) {
  /** @type {T[][]} */
  const trechos = [[]];
  for (const t of linha) {
    if (t.texto.startsWith("|") && trechos[trechos.length - 1].length) trechos.push([]);
    trechos[trechos.length - 1].push(t);
    if (t.texto.endsWith("|")) trechos.push([]);
  }
  /** @type {Sub<T>[]} */
  const subs = [];
  let acordes = 0, temForte = false, precisaForte = false;
  for (const trecho of trechos.filter((x) => x.length)) {
    const r = analisarSegmento(trecho, n);
    if (r === NAO_TRANSPOR) return [];
    if (r === REJEITADO) { precisaForte = true; continue; }
    subs.push(...r.subs);
    acordes += r.acordes;
    temForte ||= r.temForte;
    precisaForte ||= r.precisaForte;
  }
  // Linha de acordes = ≥1 acorde avulso e, se algo foi descartado ou usou ignorável
  // condicional, ≥1 acorde forte.
  if (acordes === 0 || (precisaForte && !temForte)) return [];
  return subs;
}

/**
 * Detecta linhas de acordes e monta as substituições (apenas tokens cujo texto muda).
 * Metadados extras dos tokens (quads, origem, fonte…) passam intactos em `token`.
 * @template {TokenBase} T
 * @param {T[][]} linhas
 * @param {number} n — semitons, inteiro ≠ 0 em [-11, 11]
 * @returns {{ substituicoes: Sub<T>[], linhasAfetadas: number }}
 */
export function detectarSubstituicoes(linhas, n) {
  /** @type {Sub<T>[]} */
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
