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
  // destroy() explícito: o heap do WASM nunca encolhe, e o worker vive a sessão toda —
  // não dá para depender do GC (FinalizationRegistry) para soltar o documento.
  try {
    if (doc.needsPassword()) throw new Error("Este PDF é protegido por senha — envie uma versão sem senha.");
    if (!(doc instanceof mupdf.PDFDocument)) throw new Error("Não foi possível abrir o arquivo como PDF.");
    const total = doc.countPages();
    let acordes = 0, linhasAfetadas = 0, invisiveis = 0, visiveis = 0;
    /** @type {Map<string, import("mupdf").PDFObject>} fonte base-14 → objeto, compartilhado entre páginas */
    const fontesDoc = new Map();
    for (let i = 0; i < total; i++) {
      aoProgredir(i + 1, total);
      const pagina = doc.loadPage(i);
      try {
        const c = coletarLinhas(mupdf, pagina); // coordenadas coletadas ANTES de qualquer mutação
        invisiveis += c.invisiveis;
        visiveis += c.visiveis;
        const r = detectarSubstituicoes(c.linhas, n);
        if (r.substituicoes.length === 0) continue;
        const subs = r.substituicoes.map((s) => ({ ...s.token, textoNovo: s.textoNovo }));
        apagarTokens(mupdf, pagina, subs);
        reinserir(mupdf, doc, pagina, subs, fontesDoc);
        acordes += subs.length;
        linhasAfetadas += r.linhasAfetadas;
      } finally {
        pagina.destroy();
      }
    }
    // Só "digitalizado" se o texto é MAJORITARIAMENTE invisível — um PDF comum com uma
    // marca d'água oculta não deve receber essa mensagem.
    if (acordes === 0 && invisiveis > visiveis) {
      throw new Error("Este PDF parece ser digitalizado (o texto é só uma camada invisível de OCR) — não dá para transpor.");
    }
    if (acordes === 0) throw new Error("Nenhum acorde detectado");

    const buffer = doc.saveToBuffer("garbage,compress");
    // .slice(): asUint8Array é uma view do heap WASM — copiar antes de transferir.
    const bytes = buffer.asUint8Array().slice();
    buffer.destroy();
    return { dados: bytes, acordes, linhas: linhasAfetadas };
  } finally {
    doc.destroy();
  }
}

/**
 * Origens dos glifos INVISÍVEIS da página (modo 3 Tr — camada de OCR de PDF digitalizado),
 * que o interpretador manda para `ignoreText`. O structured text inclui esse texto, e
 * transpô-lo desenharia o acorde novo VISÍVEL por cima do antigo, que está na imagem.
 * Chave = caractere + origem numa grade de 0,5 pt (mesmo espaço do walk).
 * @param {Mupdf} mupdf @param {import("mupdf").PDFPage} pagina
 */
function glifosInvisiveis(mupdf, pagina) {
  /** @type {Set<string>} */
  const chaves = new Set();
  const dispositivo = new mupdf.Device({
    ignoreText(texto, ctm) {
      texto.walk({
        showGlyph(_fonte, trm, _glifo, unicode) {
          const x = trm[4] * ctm[0] + trm[5] * ctm[2] + ctm[4];
          const y = trm[4] * ctm[1] + trm[5] * ctm[3] + ctm[5];
          chaves.add(`${String.fromCodePoint(unicode)}@${Math.round(x * 2)},${Math.round(y * 2)}`);
        },
      });
    },
  });
  try {
    pagina.run(dispositivo, mupdf.Matrix.identity);
    dispositivo.close();
  } finally {
    dispositivo.destroy();
  }
  return chaves;
}

/**
 * Linhas de tokens da página, com origem/quads/fonte/tamanho/cor por token. Caracteres invisíveis (OCR) contam como espaço — ficam fora dos tokens.
 * @param {Mupdf} mupdf @param {import("mupdf").PDFPage} pagina
 * @returns {{ linhas: Token[][], invisiveis: number, visiveis: number }}
 */
function coletarLinhas(mupdf, pagina) {
  const invisivel = glifosInvisiveis(mupdf, pagina);
  let invisiveis = 0, visiveis = 0;
  /** @param {string} c @param {number[]} o */
  const ehInvisivel = (c, o) => {
    if (invisivel.size === 0) return false;
    const gx = Math.round(o[0] * 2), gy = Math.round(o[1] * 2);
    for (const dx of [0, -1, 1]) for (const dy of [0, -1, 1]) {
      if (invisivel.has(`${c}@${gx + dx},${gy + dy}`)) return true;
    }
    return false;
  };
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
  const stext = pagina.toStructuredText("");
  try {
    stext.walk({
      beginLine(bbox, wmode, dir) { fecharLinha(); direcao = dir; },
      onChar(c, origem, fonte, tamanho, quad, cor) {
        if (c.trim() === "") { fecharToken(); return; }
        if (ehInvisivel(c, origem)) { invisiveis++; fecharToken(); return; }
        visiveis++;
        if (!atual) {
          atual = {
            texto: "", origem: { x: origem[0], y: origem[1] }, direcao, quads: [],
            tamanho, cor: [...cor], // na 1.28 cor = RGB 3 componentes 0–1, sempre (o union do .d.ts engana)
            fonte: { mono: fonte.isMono(), serifa: fonte.isSerif(), negrito: fonte.isBold(), italico: fonte.isItalic() },
          };
        }
        atual.texto += c;
        atual.quads.push(quad);
      },
      endLine: fecharLinha,
    });
  } finally {
    stext.destroy();
  }
  fecharLinha();
  return { linhas, invisiveis, visiveis };
}

/**
 * Retângulo de redação do acorde: cobre a LARGURA do token ao longo do eixo de
 * leitura (extremos dos quads projetados na direção), mas no eixo da ENTRELINHA
 * usa uma BANDA estreita no meio do corpo do glifo, não a altura do quad.
 * Motivo: o REDACT_TEXT_REMOVE apaga todo glifo cuja caixa INTERCEPTA o
 * retângulo, e essa caixa vem das métricas da fonte (ascent/descent), não da
 * tinta — a da letra de baixo sobe quase 1 tamanho acima da sua baseline, a da
 * letra de cima desce ~0.25. Medido em fixtures (Helvetica/Times/Courier/bold):
 * a banda antiga [baseline, +0.7] comia letra com entrelinha ≤ 0.85× o tamanho;
 * a banda [+0.25, +0.5] preserva a letra até 0.75× e continua interceptando
 * todo glifo do acorde (inclusive `.`, `,`, `-`, `º`), porque a caixa de
 * qualquer glifo vai do descent ao ascent. Validado no acervo real (568 PDFs).
 * `acima`/`abaixo` são frações do tamanho a partir da baseline (`abaixo`
 * negativo = a banda começa acima da baseline). Direcional: cobre /Rotate por
 * projeção nos eixos leitura/perpendicular. Espaço MuPDF, sem conversão.
 * @param {number[][]} quads @param {number[]} direcao
 * @param {{x: number, y: number}} origem @param {number} tamanho
 * @returns {[number, number, number, number]}
 */
function retanguloDe(quads, direcao, origem, tamanho, acima = 0.5, abaixo = -0.25) {
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
 * @param {Map<string, import("mupdf").PDFObject>} fontesDoc — cache por documento: um objeto
 *   de fonte por base-14, referenciado por todas as páginas (sem duplicar por página)
 */
function reinserir(mupdf, doc, pagina, subs, fontesDoc) {
  const paginaObj = pagina.getObject();
  const fontes = prepararFontes(doc, paginaObj);
  /** @type {Map<string, string>} */
  const nomes = new Map(); // nome base-14 → nome do recurso na página
  const registrar = (/** @type {string} */ base14) => {
    let i = 0, nome = "TRq0";
    while (fontes.get(nome) && !fontes.get(nome).isNull()) nome = "TRq" + ++i;
    let objeto = fontesDoc.get(base14);
    if (!objeto) {
      objeto = doc.addSimpleFont(new mupdf.Font(base14), "Latin");
      fontesDoc.set(base14, objeto);
    }
    fontes.put(nome, objeto);
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
  const URL_MUPDF = "https://cdn.jsdelivr.net/npm/mupdf@1.28.1/dist/mupdf.js";
  /** @type {Promise<Mupdf> | null} */
  let carregando = null;
  // import() com URL em variável: o language server não tenta resolver; o cast dá os tipos da devDependency.
  // Em falha (CDN/rede transitória), zerar o cache para o próximo clique poder retentar —
  // uma promise rejeitada cacheada refalharia para sempre até recarregar a página.
  const carregarMupdf = () => (carregando ??= /** @type {Promise<Mupdf>} */ (
    import(URL_MUPDF).catch((e) => { carregando = null; throw e; })));
  // Pré-carga: os ~10 MB do WASM baixam enquanto o usuário escolhe o arquivo, não no clique.
  // Falha aqui é silenciosa — o clique retenta e aí reporta o erro.
  carregarMupdf().catch(() => {});

  ctx.onmessage = async (/** @type {MessageEvent} */ ev) => {
    const { dados, n } = ev.data;
    try {
      const mupdf = await carregarMupdf();
      const r = transporPdf(mupdf, dados, n,
        (pagina, total) => ctx.postMessage({ tipo: "progresso", pagina, total }));
      ctx.postMessage({ tipo: "ok", dados: r.dados, acordes: r.acordes, linhas: r.linhas }, [r.dados.buffer]);
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      // Falha de rede no import do CDN: a mensagem crua do navegador não ajuda o usuário.
      ctx.postMessage({ tipo: "erro", mensagem: carregando === null
        ? "Não foi possível baixar o componente de PDF — verifique a conexão e tente de novo."
        : mensagem });
    }
  };
}
