// @ts-nocheck — script de diagnóstico (mesmo critério do test/spike, fora do checkJs)
// Validação em lote em PDFs reais: node test/validar-lote.mjs <dir> [limite]
// Validação dupla nos PDFs: (A) letra preservada; (B) sem acorde-fantasma
// (todo acorde que muda é removido da sua posição original e não reaparece lá).
import * as mupdf from "mupdf";
import { readFileSync, readdirSync } from "node:fs";
import { transporPdf } from "../worker.js";
import { detectarSubstituicoes } from "../detect.js";

const DIR = process.argv[2];
const LIM = process.argv[3] ? Number(process.argv[3]) : Infinity;
const N = 2;
const K = (x, y, p) => `${p}:${Math.round(x)}:${Math.round(y)}`;

// linhas com tokens {texto, x, y} por página
function paginas(doc) {
  const out = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const linhas = []; let toks = [], atual = null;
    const fT = () => { if (atual && atual.texto) toks.push(atual); atual = null; };
    const fL = () => { fT(); if (toks.length) linhas.push(toks); toks = []; };
    doc.loadPage(p).toStructuredText("").walk({
      beginLine() { fL(); },
      onChar(c, o) { if (c.trim() === "") { fT(); return; } if (!atual) atual = { texto: "", x: o[0], y: o[1], p }; atual.texto += c; },
      endLine() { fL(); },
    });
    fL(); out.push(linhas);
  }
  return out;
}
const add = (m, t) => m.set(t, (m.get(t) || 0) + 1);

const arquivos = readdirSync(DIR).filter((f) => /\.pdf$/i.test(f)).slice(0, LIM);
let okLetra = 0, okFant = 0, erro = 0; const probLetra = [], probFant = [];
for (const nome of arquivos) {
  const bytes = new Uint8Array(readFileSync(DIR + "/" + nome));
  let r; try { r = transporPdf(mupdf, bytes.slice(), N); }
  catch (e) { erro++; continue; }
  const a = paginas(mupdf.Document.openDocument(bytes.slice(), "application/pdf"));
  const d = paginas(mupdf.Document.openDocument(r.dados, "application/pdf"));

  // (A) letra: tokens de linha não-acorde devem sobreviver (multiset)
  const letra = new Map(), tudo = new Map();
  for (const pg of a) for (const l of pg)
    if (detectarSubstituicoes([l], N).substituicoes.length === 0) for (const t of l) add(letra, t.texto);
  for (const pg of d) for (const l of pg) for (const t of l) add(tudo, t.texto);
  let perda = 0; for (const [t, c] of letra) if ((tudo.get(t) || 0) < c) perda++;
  if (perda === 0) okLetra++; else probLetra.push([nome, perda]);

  // (B) fantasma: onde um acorde MUDOU, o texto ANTIGO não pode reaparecer na mesma posição
  const posDepois = new Map(); // K -> Set de textos naquela posição
  for (const pg of d) for (const l of pg) for (const t of l) {
    const k = K(t.x, t.y, t.p); if (!posDepois.has(k)) posDepois.set(k, new Set()); posDepois.get(k).add(t.texto);
  }
  let fant = 0;
  for (const pg of a) for (const l of pg) {
    const subs = detectarSubstituicoes([l], N).substituicoes;
    for (const s of subs) {
      const tk = s.token; const k = K(tk.x, tk.y, tk.p);
      const nEsperado = s.textoNovo;
      const set = posDepois.get(k) || new Set();
      // fantasma se o antigo continua lá E o novo não aparece
      if (set.has(tk.texto) && tk.texto !== nEsperado) fant++;
    }
  }
  if (fant === 0) okFant++; else probFant.push([nome, fant]);
}
console.log(`Arquivos: ${arquivos.length} | erro: ${erro}`);
console.log(`  (A) letra preservada: ${okLetra}/${arquivos.length - erro}`);
console.log(`  (B) sem fantasma:     ${okFant}/${arquivos.length - erro}`);
if (probLetra.length) console.log("  LETRA:", probLetra.slice(0, 8).map(([n, c]) => `${n}(${c})`).join(", "));
if (probFant.length) console.log("  FANTASMA:", probFant.slice(0, 8).map(([n, c]) => `${n}(${c})`).join(", "));
