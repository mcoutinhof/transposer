// @ts-check
// Gerador de PDFs de teste. Também é lib: os testes importam criarPdf/salvar.
import * as mupdf from "mupdf";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Cifra-padrão: acordes reais + linhas-armadilha do spec. */
export const LINHAS_CIFRA = [
  "Intro: G  D/F#  Em",
  "",
  "G          D/F#         Em",
  "A menina que passa danca",
  "C#m7(b5)   Bb   Dº   (D7)",
  "E o vento leva a saudade",
  "|Em|  A7(9)  (repete 2x)",
];

/**
 * Literal PDF: escapa \ ( ) e serializa não-ASCII como octal Latin-1 (º=\272).
 * Necessário porque addStream codifica strings JS em UTF-8 — um `º` cru viraria
 * os bytes 0xC2 0xBA e extrairia como "Âº" em fonte WinAnsi.
 * @param {string} s
 */
const lit = (s) => "(" + [...s].map((ch) => {
  if (ch === "\\" || ch === "(" || ch === ")") return "\\" + ch;
  const c = /** @type {number} */ (ch.codePointAt(0));
  if (c >= 0x20 && c <= 0x7e) return ch;
  return "\\" + c.toString(8).padStart(3, "0");
}).join("") + ")";

/**
 * @param {string[]} linhas
 * @param {{rotate?: import("mupdf").Rotate, posambulo?: string, linhaArte?: boolean}} [opcoes]
 * @returns {mupdf.PDFDocument}
 */
export function criarPdf(linhas, { rotate = 0, posambulo = "", linhaArte = false } = {}) {
  const doc = new mupdf.PDFDocument();
  const fonte = doc.addSimpleFont(new mupdf.Font("Courier"), "Latin");
  const fontes = doc.newDictionary();
  fontes.put("F1", fonte);
  const recursos = doc.newDictionary();
  recursos.put("Font", fontes);
  let corpo = linhaArte ? "0.5 w 50 774 m 545 774 l S\n" : "";
  corpo += "BT /F1 11 Tf 12 TL 50 780 Td\n";
  for (const l of linhas) corpo += lit(l) + " Tj T*\n";
  corpo += "ET\n" + posambulo;
  const pagina = doc.addPage([0, 0, 595, 842], rotate, recursos, corpo);
  doc.insertPage(-1, pagina);
  return doc;
}

/**
 * @param {mupdf.PDFDocument} doc
 * @param {string} caminho
 * @param {string} [opcoes] opções do saveToBuffer (ex.: criptografia)
 */
export function salvar(doc, caminho, opcoes = "") {
  writeFileSync(caminho, doc.saveToBuffer(opcoes).asUint8Array());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL("./gerados/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  salvar(criarPdf(LINHAS_CIFRA, { linhaArte: true }), dir + "simples.pdf");
  salvar(criarPdf(LINHAS_CIFRA, { rotate: 90 }), dir + "rotate90.pdf");
  salvar(criarPdf(LINHAS_CIFRA, { posambulo: "0.75 0 0 0.75 30 30 cm 3 Tr 2 Tc\n" }), dir + "estado.pdf");
  salvar(criarPdf(LINHAS_CIFRA), dir + "senha.pdf",
    "encrypt=aes-128,user-password=teste,owner-password=teste");
  salvar(criarPdf(["Documento sem nenhum acorde.", "So texto comum aqui."]), dir + "semacordes.pdf");
  console.log("fixtures gravados em", dir);
}
