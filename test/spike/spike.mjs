// Spike redact+reinsert — descartável. Uso: node test/spike/spike.mjs <entrada.pdf> <n> <prefixo-saida>
import * as mupdf from "mupdf";
import { mkdirSync, writeFileSync } from "node:fs";

// ——— detecção ingênua (só para o spike; a real é a detect.js da Task 5) ———
const RE_ACORDE = /^[A-G](?:#|b)?(?:maj|min|dim|aug|sus|add|m|M|\+|-|º|°|ø|#|b|[0-9]|\(|\)|,|\.)*(?:\/[A-G](?:#|b)?)?$/;
const SAIDA = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function transporNota(nota, n) {
  let i = BASE[nota[0]] + (nota[1] === "#" ? 1 : nota[1] === "b" ? -1 : 0);
  return SAIDA[(((i + n) % 12) + 12) % 12];
}
function transporAcorde(acorde, n) {
  return acorde.replace(/^([A-G](?:#|b)?)/, (m) => transporNota(m, n))
               .replace(/\/([A-G](?:#|b)?)$/, (m, g) => "/" + transporNota(g, n));
}

// ——— coleta (antes de QUALQUER mutação da página) ———
// Formatos a conferir no 1º run: origin {x,y} ou [x,y]; quad = 8 números; color = [r,g,b] 0–1.
function coletarTokens(pagina) {
  const tokens = [];
  let atual = null;
  let direcao = [1, 0]; // direção de leitura da linha atual (espaço MuPDF), do beginLine
  const fechar = () => { if (atual && atual.texto) tokens.push(atual); atual = null; };
  pagina.toStructuredText().walk({
    beginLine(bbox, wmode, dir) { fechar(); direcao = dir; },
    onChar(c, origem, fonte, tamanho, quad, cor) {
      if (c.trim() === "") { fechar(); return; }
      if (!atual) {
        atual = {
          texto: "", origem: { x: origem[0], y: origem[1] }, direcao,
          quads: [], tamanho, cor,
          fonte: { mono: fonte.isMono(), serifa: fonte.isSerif(), negrito: fonte.isBold(), italico: fonte.isItalic() },
        };
      }
      atual.texto += c;
      atual.quads.push(quad);
    },
    endLine: fechar,
  });
  fechar();
  return tokens;
}

// ——— redação ———
// Quads e rects de anotação estão ambos no espaço MuPDF (fitz) — sem conversão.
// Encolhe no eixo da ENTRELINHA (perpendicular à direção da linha): linha
// horizontal separa-se da vizinha em Y; em página /Rotate 90/270 (texto reto
// no PDF space), em X — encolher no eixo errado deixa a redação comer a vizinha.
function retanguloDe(quads, direcao, encolhe = 0.1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of quads) {
    x0 = Math.min(x0, q[0], q[2], q[4], q[6]); x1 = Math.max(x1, q[0], q[2], q[4], q[6]);
    y0 = Math.min(y0, q[1], q[3], q[5], q[7]); y1 = Math.max(y1, q[1], q[3], q[5], q[7]);
  }
  if (Math.abs(direcao[0]) >= Math.abs(direcao[1])) {
    const dy = (y1 - y0) * encolhe;
    return [x0, y0 + dy, x1, y1 - dy];
  }
  const dx = (x1 - x0) * encolhe;
  return [x0 + dx, y0, x1 - dx, y1];
}
function apagarTokens(pagina, substituicoes) {
  for (const s of substituicoes) {
    const a = pagina.createAnnotation("Redact");
    a.setRect(retanguloDe(s.quads, s.direcao));
  }
  // Parâmetros SEMPRE explícitos — os defaults pintam caixas pretas, furam imagens e apagam vetores.
  pagina.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE,
    mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
}

// ——— reinserção ———
const fmt = (v) => v.toFixed(4).replace(/\.?0+$/, "");

// Tm que reproduz a colocação original: eixo do texto → M(direção da linha do
// walk), eixo vertical do glifo → M(up), origem → M(origem), com M =
// page.getTransform() (MuPDF→PDF, aplicação direta) e up = [dir.y, -dir.x]
// (perpendicular à esquerda da leitura, no espaço MuPDF y-baixo). Validado nos
// 3 cenários: página normal → [1,0,0,1,x,H−y]; /Rotate 90 com texto reto no
// PDF space → translação pura; /Rotate 90 com texto pré-rotacionado → [0,1,−1,0,e,f].
function matrizTexto(M, origem, dir) {
  const up = [dir[1], -dir[0]];
  const lin = (v) => [v[0] * M[0] + v[1] * M[2], v[0] * M[1] + v[1] * M[3]];
  const [a, b] = lin(dir), [c, d] = lin(up);
  return [a, b, c, d,
    origem.x * M[0] + origem.y * M[2] + M[4],
    origem.x * M[1] + origem.y * M[3] + M[5]];
}

// Nunca literal (…): parêntese desbalanceado corrompe o stream; º/°/ø em UTF-8 viram glifo errado.
// WinAnsi ≈ Latin-1 fora de 0x80–0x9F; charset de acordes cabe inteiro.
function paraHexWinAnsi(texto) {
  let hex = "";
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    const b = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : 0x3f; // '?' p/ fora do WinAnsi
    hex += b.toString(16).padStart(2, "0");
  }
  return "<" + hex + ">";
}

function nomeFonteBase14({ mono, serifa, negrito, italico }) {
  if (serifa && !mono) {
    return negrito && italico ? "Times-BoldItalic" : negrito ? "Times-Bold" : italico ? "Times-Italic" : "Times-Roman";
  }
  const base = mono ? "Courier" : "Helvetica";
  return base + (negrito && italico ? "-BoldOblique" : negrito ? "-Bold" : italico ? "-Oblique" : "");
}

// /Resources é herdável e pode ser compartilhado entre páginas: copiar SEMPRE
// (cópia rasa) para um dicionário próprio da página antes de mexer — nunca
// escrever no herdado/compartilhado. Idem para /Resources/Font.
function prepararFontes(doc, paginaObj) {
  const copiar = (orig) => {
    const d = doc.newDictionary();
    if (orig && !orig.isNull()) orig.forEach((v, k) => d.put(k, v));
    return d;
  };
  const recursos = copiar(paginaObj.getInheritable("Resources"));
  const fontes = copiar(recursos.get("Font"));
  recursos.put("Font", fontes);
  paginaObj.put("Resources", recursos);
  return fontes;
}
function registrarFonte(doc, fontes, nomeBase14) {
  let i = 0, nome;
  do { nome = "TRq" + i++; } while (fontes.get(nome) && !fontes.get(nome).isNull());
  fontes.put(nome, doc.addSimpleFont(new mupdf.Font(nomeBase14), "Latin"));
  return nome;
}

// Estado gráfico: 'q' prefixado ao /Contents original + 'Q' antes da reinserção
// neutraliza CTM residual (um 'cm' desbalanceado do gerador); cada inserção tem
// q…Q próprio + reset de estado de texto (um '3 Tr' residual deixaria o acorde invisível).
function reinserir(doc, pagina, substituicoes) {
  const paginaObj = pagina.getObject();
  const fontes = prepararFontes(doc, paginaObj);
  const nomes = new Map(); // nomeBase14 → nome do recurso na página
  const M = pagina.getTransform();
  let codigo = "Q\n";
  for (const s of substituicoes) {
    const base14 = nomeFonteBase14(s.fonte);
    if (!nomes.has(base14)) nomes.set(base14, registrarFonte(doc, fontes, base14));
    const [r, g, b] = s.cor; // na 1.27.0 o walk entrega sempre RGB 3 componentes 0–1
    codigo += "q 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr BT\n"
      + `${fmt(r)} ${fmt(g)} ${fmt(b)} rg\n`
      + `/${nomes.get(base14)} ${fmt(s.tamanho)} Tf\n`
      + matrizTexto(M, s.origem, s.direcao).map(fmt).join(" ") + " Tm\n"
      + paraHexWinAnsi(s.textoNovo) + " Tj\nET Q\n";
  }
  const arr = doc.newArray();
  arr.push(doc.addStream("q\n", null));
  const atual = paginaObj.get("Contents");
  if (atual.isArray()) atual.forEach((v) => arr.push(v));
  else if (!atual.isNull()) arr.push(atual);
  arr.push(doc.addStream(codigo, null));
  paginaObj.put("Contents", arr);
}

// ——— pipeline + render ———
function renderizar(doc, prefixo) {
  for (let i = 0; i < doc.countPages(); i++) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB);
    writeFileSync(`${prefixo}-p${i + 1}.png`, pix.asPNG());
  }
}

const [entrada, nArg, prefixo] = process.argv.slice(2);
const n = Number(nArg);
mkdirSync("test/spike/saida", { recursive: true });
const doc = mupdf.Document.openDocument(new Uint8Array((await import("node:fs")).readFileSync(entrada)), "application/pdf");
renderizar(doc, prefixo + "-antes");
for (let i = 0; i < doc.countPages(); i++) {
  const pagina = doc.loadPage(i);
  const tokens = coletarTokens(pagina);            // 1. coletar (antes de mutar)
  const subs = tokens
    .filter((t) => RE_ACORDE.test(t.texto))
    .map((t) => ({ ...t, textoNovo: transporAcorde(t.texto, n) }))
    .filter((t) => t.textoNovo !== t.texto);
  console.log(`página ${i + 1}: ${subs.length} substituições:`, subs.map((s) => `${s.texto}→${s.textoNovo}`).join(" "));
  if (!subs.length) continue;
  apagarTokens(pagina, subs);                      // 2. apagar
  reinserir(doc, pagina, subs);                    // 3. reinserir
}
writeFileSync(prefixo + ".pdf", doc.saveToBuffer("garbage,compress").asUint8Array());
const depois = mupdf.Document.openDocument(new Uint8Array((await import("node:fs")).readFileSync(prefixo + ".pdf")), "application/pdf");
renderizar(depois, prefixo + "-depois");
console.log("extração pós-edição:\n" + (await import("../util.mjs")).extrairTexto(depois));
