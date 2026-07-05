// @ts-check
// Cola MuPDF: abre → coleta (walk) → detecta → redige → reinsere → salva.
// Exporta transporPdf para os testes Node; o protocolo de worker registra-se
// sozinho quando o arquivo roda num Web Worker de verdade.
import { detectarSubstituicoes } from "./detect.js";

/** @typedef {typeof import("mupdf")} Mupdf */
/**
 * @typedef {{ texto: string, origem: {x: number, y: number}, direcao: number[],
 *   quads: number[][], tamanho: number, cor: number[],
 *   fonte: {mono: boolean, serifa: boolean, negrito: boolean, italico: boolean} }} Token
 */
/** @typedef {Token & { textoNovo: string }} Substituicao */

/**
 * Transpõe todos os acordes do PDF em n semitons, in-place.
 * @param {Mupdf} mupdf
 * @param {ArrayBuffer | Uint8Array} dados
 * @param {number} n — inteiro ≠ 0 em [-11, 11]
 * @param {(pagina: number, total: number) => void} [aoProgredir]
 * @returns {{ dados: Uint8Array, acordes: number, linhas: number }}
 */
export function transporPdf(mupdf, dados, n, aoProgredir = () => {}) {
  /** @type {import("mupdf").Document} */
  let doc;
  try {
    doc = mupdf.Document.openDocument(dados, "application/pdf");
  } catch {
    throw new Error("Não foi possível abrir o arquivo como PDF.");
  }
  if (doc.needsPassword()) throw new Error("Este PDF é protegido por senha — envie uma versão sem senha.");
  if (!(doc instanceof mupdf.PDFDocument)) throw new Error("Não foi possível abrir o arquivo como PDF.");

  const total = doc.countPages();
  let acordes = 0, linhasAfetadas = 0;
  for (let i = 0; i < total; i++) {
    aoProgredir(i + 1, total);
    const pagina = doc.loadPage(i);
    const linhas = coletarLinhas(pagina); // coordenadas coletadas ANTES de qualquer mutação
    const r = detectarSubstituicoes(linhas, n);
    if (r.substituicoes.length === 0) continue;
    const subs = r.substituicoes.map((s) => ({ ...s.token, textoNovo: s.textoNovo }));
    apagarTokens(mupdf, pagina, subs);
    reinserir(mupdf, doc, pagina, subs);
    acordes += subs.length;
    linhasAfetadas += r.linhasAfetadas;
  }
  if (acordes === 0) throw new Error("Nenhum acorde detectado");

  // .slice(): asUint8Array é uma view do heap WASM — copiar antes de transferir.
  const bytes = doc.saveToBuffer("garbage,compress").asUint8Array().slice();
  return { dados: bytes, acordes, linhas: linhasAfetadas };
}

/**
 * Linhas de tokens da página, com origem/quads/fonte/tamanho/cor por token.
 * @param {import("mupdf").PDFPage} pagina
 * @returns {Token[][]}
 */
function coletarLinhas(pagina) {
  /** @type {Token[][]} */
  const linhas = [];
  /** @type {Token[]} */
  let linha = [];
  /** @type {Token | null} */
  let atual = null;
  /** @type {number[]} direção de leitura da linha atual (espaço MuPDF), do beginLine */
  let direcao = [1, 0];
  const fecharToken = () => { if (atual && atual.texto) linha.push(atual); atual = null; };
  const fecharLinha = () => { fecharToken(); if (linha.length) linhas.push(linha); linha = []; };
  pagina.toStructuredText().walk({
    beginLine(bbox, wmode, dir) { fecharLinha(); direcao = dir; },
    onChar(c, origem, fonte, tamanho, quad, cor) {
      if (c.trim() === "") { fecharToken(); return; }
      if (!atual) {
        atual = {
          texto: "",
          origem: { x: origem[0], y: origem[1] }, direcao,
          quads: [], tamanho, cor, // na 1.27.0 cor = RGB 3 componentes 0–1, sempre
          fonte: { mono: fonte.isMono(), serifa: fonte.isSerif(), negrito: fonte.isBold(), italico: fonte.isItalic() },
        };
      }
      atual.texto += c;
      atual.quads.push(quad);
    },
    endLine: fecharLinha,
  });
  fecharLinha();
  return linhas;
}

/**
 * Retângulo de redação do acorde: cobre a LARGURA do token ao longo do eixo de
 * leitura (extremos dos quads projetados na direção), mas no eixo da ENTRELINHA
 * usa uma BANDA justa ancorada na baseline (origem ± fração do tamanho da fonte),
 * não a altura do quad. Motivo: o quad da structured-text inclui ascent+descent
 * e costuma ser MAIS ALTO que o espaçamento entre linhas, então um encolhimento
 * por fração do quad ainda invade a linha vizinha em cifras de espaçamento
 * apertado — e o REDACT_TEXT_REMOVE apaga todo glifo que o retângulo intercepta,
 * comendo a letra. A banda pela baseline nunca alcança a vizinha se o espaçamento
 * for ≥ ~1 tamanho de fonte (sempre, em cifras reais). Como a redação só precisa
 * INTERCEPTAR o glifo antigo para removê-lo, uma banda justa basta.
 * `acima`/`abaixo` são frações do tamanho (ascent/descent do acorde). Direcional:
 * cobre /Rotate por projeção nos eixos leitura/perpendicular. Espaço MuPDF, sem conversão.
 * @param {number[][]} quads @param {number[]} direcao
 * @param {{x: number, y: number}} origem @param {number} tamanho
 * @returns {[number, number, number, number]}
 */
function retanguloDe(quads, direcao, origem, tamanho, acima = 0.7, abaixo = 0.0) {
  const mag = Math.hypot(direcao[0], direcao[1]) || 1;
  const dir = [direcao[0] / mag, direcao[1] / mag];
  const up = [dir[1], -dir[0]]; // perpendicular; +up = ascent (fitz y-baixo)
  // extensão ao longo da leitura, dos quads (largura do acorde)
  let smin = Infinity, smax = -Infinity;
  for (const q of quads) for (let k = 0; k < 8; k += 2) {
    const s = q[k] * dir[0] + q[k + 1] * dir[1];
    if (s < smin) smin = s;
    if (s > smax) smax = s;
  }
  // banda perpendicular ancorada na baseline (projeção da origem no eixo up)
  const pBase = origem.x * up[0] + origem.y * up[1];
  const pHi = pBase + acima * tamanho;  // lado do ascent
  const pLo = pBase - abaixo * tamanho; // lado do descent
  // 4 cantos = {smin,smax} × {pLo,pHi}; ponto = s·dir + p·up → bbox alinhado aos eixos
  const xs = [], ys = [];
  for (const s of [smin, smax]) for (const p of [pLo, pHi]) {
    xs.push(s * dir[0] + p * up[0]);
    ys.push(s * dir[1] + p * up[1]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Uma anotação de redação por token + UM applyRedactions com parâmetros explícitos
 * (os defaults pintam caixas pretas, furam imagens e apagam line-art).
 * @param {Mupdf} mupdf @param {import("mupdf").PDFPage} pagina @param {Substituicao[]} subs
 */
function apagarTokens(mupdf, pagina, subs) {
  for (const s of subs) pagina.createAnnotation("Redact").setRect(retanguloDe(s.quads, s.direcao, s.origem, s.tamanho));
  pagina.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE,
    mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
}

const fmt = (/** @type {number} */ v) => v.toFixed(4).replace(/\.?0+$/, "");

/**
 * Tm que reproduz a colocação original: eixo do texto → M(direção da linha do
 * walk), eixo vertical do glifo → M(up), origem → M(origem), com M =
 * page.getTransform() (MuPDF→PDF, aplicação direta) e up = [dir.y, −dir.x]
 * (perpendicular à esquerda da leitura, espaço MuPDF y-baixo). Cobre página
 * normal ([1,0,0,1,x,H−y]), /Rotate com texto reto (translação pura) e /Rotate
 * com texto pré-rotacionado (rotação herdada) — confirmar no spike (RESULTADO.md).
 * @param {number[]} M @param {{x: number, y: number}} origem @param {number[]} dir
 */
function matrizTexto(M, origem, dir) {
  const up = [dir[1], -dir[0]];
  const lin = (/** @type {number[]} */ v) => [v[0] * M[0] + v[1] * M[2], v[0] * M[1] + v[1] * M[3]];
  const [a, b] = lin(dir), [c, d] = lin(up);
  return [a, b, c, d,
    origem.x * M[0] + origem.y * M[2] + M[4],
    origem.x * M[1] + origem.y * M[3] + M[5]];
}

/**
 * Nunca literal (…): parêntese desbalanceado corrompe o stream; º/°/ø em UTF-8
 * viram glifo errado. WinAnsi ≈ Latin-1 fora de 0x80–0x9F; '?' para o resto.
 * @param {string} texto
 */
function paraHexWinAnsi(texto) {
  let hex = "";
  for (const ch of texto) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    const b = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : 0x3f;
    hex += b.toString(16).padStart(2, "0");
  }
  return "<" + hex + ">";
}

/** @param {Token["fonte"]} f */
function nomeFonteBase14({ mono, serifa, negrito, italico }) {
  if (serifa && !mono) {
    return negrito && italico ? "Times-BoldItalic" : negrito ? "Times-Bold" : italico ? "Times-Italic" : "Times-Roman";
  }
  const base = mono ? "Courier" : "Helvetica";
  return base + (negrito && italico ? "-BoldOblique" : negrito ? "-Bold" : italico ? "-Oblique" : "");
}

/**
 * /Resources é herdável e pode ser compartilhado entre páginas: copiar SEMPRE
 * (cópia rasa) para dicionários próprios da página antes de mexer. Idem /Font.
 * @param {import("mupdf").PDFDocument} doc @param {import("mupdf").PDFObject} paginaObj
 */
function prepararFontes(doc, paginaObj) {
  const copiar = (/** @type {import("mupdf").PDFObject | null} */ orig) => {
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

/**
 * Reinsere os acordes transpostos: 'q' prefixado ao /Contents original + 'Q'
 * inicial neutralizam CTM residual; cada inserção tem q…Q próprio + reset de
 * estado de texto (0 Tc 0 Tw 100 Tz 0 Ts 0 Tr) antes do BT.
 * @param {Mupdf} mupdf @param {import("mupdf").PDFDocument} doc
 * @param {import("mupdf").PDFPage} pagina @param {Substituicao[]} subs
 */
function reinserir(mupdf, doc, pagina, subs) {
  const paginaObj = pagina.getObject();
  const fontes = prepararFontes(doc, paginaObj);
  /** @type {Map<string, string>} */
  const nomes = new Map(); // nome base-14 → nome do recurso na página
  const registrar = (/** @type {string} */ base14) => {
    let i = 0, nome = "TRq0";
    while (fontes.get(nome) && !fontes.get(nome).isNull()) nome = "TRq" + ++i;
    fontes.put(nome, doc.addSimpleFont(new mupdf.Font(base14), "Latin"));
    return nome;
  };
  const M = pagina.getTransform();
  let codigo = "Q\n";
  for (const s of subs) {
    const base14 = nomeFonteBase14(s.fonte);
    let nome = nomes.get(base14);
    if (!nome) { nome = registrar(base14); nomes.set(base14, nome); }
    const [r, g, b] = s.cor;
    codigo += "q 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr BT\n"
      + `${fmt(r)} ${fmt(g)} ${fmt(b)} rg\n`
      + `/${nome} ${fmt(s.tamanho)} Tf\n`
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

// ——— protocolo do worker (só quando rodando num Web Worker de verdade) ———
// Globals de worker via cast: o lib "webworker" do TS conflita com "dom" no
// jsconfig, e em Node (testes) esses globals nem existem.
const ctx = /** @type {any} */ (globalThis);
if (typeof ctx.WorkerGlobalScope !== "undefined" && globalThis instanceof ctx.WorkerGlobalScope) {
  const URL_MUPDF = "https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf.js";
  /** @type {Promise<Mupdf> | null} */
  let carregando = null;
  // import() com URL em variável: o language server não tenta resolver; o cast dá os tipos da devDependency.
  // Em falha (CDN/rede transitória), zerar o cache para o próximo clique poder retentar —
  // uma promise rejeitada cacheada refalharia para sempre até recarregar a página.
  const carregarMupdf = () => (carregando ??= /** @type {Promise<Mupdf>} */ (
    import(URL_MUPDF).catch((e) => { carregando = null; throw e; })));

  ctx.onmessage = async (/** @type {MessageEvent} */ ev) => {
    const { dados, n } = ev.data;
    try {
      const mupdf = await carregarMupdf();
      const r = transporPdf(mupdf, dados, n,
        (pagina, total) => ctx.postMessage({ tipo: "progresso", pagina, total }));
      ctx.postMessage({ tipo: "ok", dados: r.dados, acordes: r.acordes, linhas: r.linhas }, [r.dados.buffer]);
    } catch (e) {
      ctx.postMessage({ tipo: "erro", mensagem: e instanceof Error ? e.message : String(e) });
    }
  };
}
