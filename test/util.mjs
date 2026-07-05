// @ts-check
// Extração de texto/tokens via StructuredText.walk — mesmo mecanismo que o worker usa.
import * as mupdf from "mupdf";

/**
 * Percorre todas as páginas e devolve as linhas de texto.
 * @param {mupdf.PDFDocument} doc
 * @returns {string}
 */
export function extrairTexto(doc) {
  /** @type {string[]} */
  const linhas = [];
  for (let i = 0; i < doc.countPages(); i++) {
    let atual = "";
    doc.loadPage(i).toStructuredText().walk({
      beginLine() { atual = ""; },
      onChar(c) { atual += c; },
      endLine() { linhas.push(atual); },
    });
  }
  return linhas.join("\n");
}

/**
 * Tokens (split por whitespace) com a origem do primeiro caractere.
 * @param {mupdf.PDFDocument} doc
 * @returns {{texto: string, x: number, y: number, pagina: number}[]}
 */
export function extrairTokens(doc) {
  /** @type {{texto: string, x: number, y: number, pagina: number}[]} */
  const tokens = [];
  for (let i = 0; i < doc.countPages(); i++) {
    /** @type {{texto: string, x: number, y: number, pagina: number} | null} */
    let atual = null;
    const fechar = () => { if (atual && atual.texto) tokens.push(atual); atual = null; };
    doc.loadPage(i).toStructuredText().walk({
      onChar(c, origem) {
        if (c.trim() === "") { fechar(); return; }
        if (!atual) atual = { texto: "", x: origem[0], y: origem[1], pagina: i };
        atual.texto += c;
      },
      endLine: fechar,
    });
    fechar();
  }
  return tokens;
}
