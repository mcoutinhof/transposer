// @ts-check
// Cola MuPDF: abre → coleta (walk) → detecta → redige → reinsere → salva.
// Exporta transporPdf para os testes Node; o protocolo de worker registra-se
// sozinho quando o arquivo roda num Web Worker de verdade.
import { detectarSubstituicoes } from "./detect.js";

/** @typedef {typeof import("mupdf")} Mupdf */

/** Erro com mensagem escrita para o usuário; qualquer outro (ex.: exceção crua do MuPDF, em inglês) vira mensagem genérica. */
export class ErroAmigavel extends Error {}
/**
 * @typedef {{ texto: string, origem: {x: number, y: number}, direcao: number[],
 *   quads: number[][], tamanho: number, cor: number[], nomeFonte: string,
 *   fonte: {mono: boolean, serifa: boolean, negrito: boolean, italico: boolean} }} Token
 */

/**
 * Fonte original do acorde (nome sem o prefixo de subconjunto "ABCDEF+") → arquivo em
 * fontes/. O PDF só traz as letras que usa, então o acorde novo (F#, B…) muitas vezes não
 * cabe na fonte embutida; com a cópia hospedada, ele sai na mesma fonte do original.
 * O MuPDF trunca nomes em 31 caracteres contando o prefixo: daí "…-BoldItali".
 */
export const FONTES_HOSPEDADAS = /** @type {Record<string, string>} */ ({
  "OpenSans-Bold": "OpenSans-Bold.ttf",
  "OpenSans-Regular": "OpenSans-Regular.ttf",
  "OpenSans": "OpenSans-Regular.ttf",
  "LiberationMono-Bold": "TransposerMono-Bold.ttf",
  "LiberationMono-BoldItalic": "TransposerMono-BoldItalic.ttf",
  "LiberationMono-BoldItali": "TransposerMono-BoldItalic.ttf",
  "LiberationMono": "TransposerMono-Regular.ttf",
  "LiberationMono-Regular": "TransposerMono-Regular.ttf",
});
/**
 * Arquivos de FONTES_HOSPEDADAS que este PDF pode precisar: as fontes declaradas nas
 * páginas e nos Form XObjects (só os dicionários — rápido, sem extrair texto). Pode
 * incluir fonte que só aparece na letra; nunca deixa de fora uma usada nos acordes.
 * Assim o worker baixa só essas, e não todas as hospedadas. PDF ilegível → [] (o erro
 * amigável sai depois, no transporPdf).
 * @param {Mupdf} mupdf @param {ArrayBuffer | Uint8Array} dados
 * @returns {string[]}
 */
export function fontesHospedadasDoPdf(mupdf, dados) {
  /** @type {Set<string>} */
  const arquivos = new Set();
  /** @type {import("mupdf").Document | undefined} */
  let doc;
  try {
    doc = mupdf.Document.openDocument(dados, "application/pdf");
    if (!(doc instanceof mupdf.PDFDocument) || doc.needsPassword()) return [];
    /** @type {Set<number>} objetos indiretos já visitados (recursos e Form XObjects): evita
     * reler o que várias páginas compartilham e laço infinito num Form que se referencia */
    const vistos = new Set();
    const primeiraVez = (/** @type {import("mupdf").PDFObject} */ o) => {
      if (!o.isIndirect()) return true;
      if (vistos.has(o.asIndirect())) return false;
      vistos.add(o.asIndirect());
      return true;
    };
    const nome = (/** @type {import("mupdf").PDFObject} */ o) => {
      if (!o.isName()) return;
      const arq = FONTES_HOSPEDADAS[o.asName().replace(/^[A-Z]{6}\+/, "")];
      if (arq) arquivos.add(arq);
    };
    // Cada nível pode faltar (Type0 não tem FontDescriptor; Type3 não tem BaseFont): checar
    // antes de descer, senão a exceção interrompe a varredura no meio.
    const fonte = (/** @type {import("mupdf").PDFObject} */ f) => {
      if (!f.isDictionary()) return;
      nome(f.get("BaseFont"));
      const fd = f.get("FontDescriptor");
      if (fd.isDictionary()) nome(fd.get("FontName"));
      const desc = f.get("DescendantFonts");
      if (desc.isArray()) desc.forEach(fonte);
    };
    const recursos = (/** @type {import("mupdf").PDFObject} */ res) => {
      if (!res.isDictionary() || !primeiraVez(res)) return;
      const fs = res.get("Font");
      if (fs.isDictionary()) fs.forEach(fonte);
      const xs = res.get("XObject");
      if (xs.isDictionary()) xs.forEach((x) => {
        if (!primeiraVez(x)) return;
        const tipo = x.isDictionary() || x.isStream() ? x.get("Subtype") : null;
        if (tipo?.isName() && tipo.asName() === "Form") recursos(x.get("Resources"));
      });
    };
    for (let i = 0, n = doc.countPages(); i < n; i++) {
      const pagina = doc.loadPage(i);
      try { recursos(pagina.getObject().getInheritable("Resources")); } finally { pagina.destroy(); }
    }
  } catch {
    // segue com o que achou
  } finally {
    doc?.destroy();
  }
  return [...arquivos];
}

/** @typedef {Token & { textoNovo: string }} Substituicao */
/**
 * Fonte do acorde novo: a hospedada igual à original, se tiver todos os caracteres;
 * senão a base-14 mais parecida. `chave` identifica o objeto de fonte no documento.
 * @typedef {(s: Substituicao) => { chave: string, criar: () => import("mupdf").Font }} FonteDe
 */

/**
 * Transpõe todos os acordes do PDF em n semitons, in-place.
 * @param {Mupdf} mupdf
 * @param {ArrayBuffer | Uint8Array} dados
 * @param {number} n — inteiro ≠ 0 em [-11, 11]
 * @param {(pagina: number, total: number) => void} [aoProgredir]
 * @param {Map<string, Uint8Array>} [hospedadas] — arquivo de FONTES_HOSPEDADAS → bytes;
 *   o que faltar (ex.: download falhou) cai na fonte padrão do PDF
 * @returns {{ dados: Uint8Array, acordes: number, linhas: number }}
 */
export function transporPdf(mupdf, dados, n, aoProgredir = () => {}, hospedadas = new Map()) {
  /** @type {import("mupdf").Document} */
  let doc;
  try {
    doc = mupdf.Document.openDocument(dados, "application/pdf");
  } catch {
    throw new ErroAmigavel("Não consegui abrir este arquivo. Confira se ele é mesmo um PDF.");
  }
  // destroy() explícito: o heap do WASM nunca encolhe, e o worker vive a sessão toda —
  // não dá para depender do GC (FinalizationRegistry) para soltar o documento.
  /** @type {Map<string, import("mupdf").Font | null>} arquivo hospedado → fonte (null = bytes inválidos) */
  const carregadas = new Map();
  try {
    if (doc.needsPassword()) throw new ErroAmigavel("Este PDF tem senha. Use uma cópia sem senha.");
    if (!(doc instanceof mupdf.PDFDocument)) throw new ErroAmigavel("Não consegui abrir este arquivo. Confira se ele é mesmo um PDF.");
    const total = doc.countPages();
    let acordes = 0, linhasAfetadas = 0, invisiveis = 0, visiveis = 0;
    /** @type {Map<string, import("mupdf").PDFObject>} fonte → objeto, compartilhado entre páginas */
    const fontesDoc = new Map();
    /** @type {Map<string, Set<string>>} arquivo hospedado → caracteres usados no documento */
    const usados = new Map();
    /** @type {FonteDe} */
    const fonteDe = (s) => {
      const arq = FONTES_HOSPEDADAS[s.nomeFonte];
      const bytes = arq && hospedadas.get(arq);
      if (bytes) {
        if (!carregadas.has(arq)) {
          // Bytes que não são fonte (ex.: página de login de Wi-Fi servida com 200):
          // fica com a base-14 em vez de derrubar a transposição.
          try { carregadas.set(arq, new mupdf.Font(arq.replace(/\.ttf$/, ""), bytes)); }
          catch { carregadas.set(arq, null); }
        }
        // Confere o texto como ele vai ser escrito. As hospedadas cobrem todo o Latin-1
        // (teste "todo arquivo de FONTES_HOSPEDADAS…"), então isto só falha com fonte
        // quebrada — na prática a decisão é a mesma para todos os acordes da fonte.
        const fonte = carregadas.get(arq), escrito = paraWinAnsi(s.textoNovo);
        if (fonte && [...escrito].every((ch) => fonte.encodeCharacter(ch) > 0)) {
          const u = usados.get(arq) ?? new Set();
          for (const ch of escrito) u.add(ch);
          usados.set(arq, u);
          return { chave: arq, criar: () => fonte };
        }
      }
      const base14 = nomeFonteBase14(s.fonte);
      return { chave: base14, criar: () => new mupdf.Font(base14) };
    };
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
        reinserir(doc, pagina, subs, fontesDoc, fonteDe);
        acordes += subs.length;
        linhasAfetadas += r.linhasAfetadas;
      } finally {
        pagina.destroy();
      }
    }
    // Só "digitalizado" se o texto é MAJORITARIAMENTE invisível — um PDF comum com uma
    // marca d'água oculta não deve receber essa mensagem.
    if (acordes === 0 && invisiveis > visiveis) {
      throw new ErroAmigavel("Este PDF parece ser foto ou papel escaneado. Só funciona com cifra digitada.");
    }
    if (acordes === 0) throw new ErroAmigavel("Não achei acordes neste PDF. Eles precisam estar digitados em cima da letra.");

    for (const [arq, chars] of usados) {
      const objeto = fontesDoc.get(arq), fonte = carregadas.get(arq);
      if (objeto && fonte) reduzirFonte(mupdf, doc, objeto, fonte, chars);
    }
    const buffer = doc.saveToBuffer("garbage,compress");
    // .slice(): asUint8Array é uma view do heap WASM — copiar antes de transferir.
    const bytes = buffer.asUint8Array().slice();
    buffer.destroy();
    return { dados: bytes, acordes, linhas: linhasAfetadas };
  } finally {
    doc.destroy();
    for (const f of carregadas.values()) f?.destroy();
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
            nomeFonte: fonte.getName().replace(/^[A-Z]{6}\+/, ""),
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
  for (const ch of paraWinAnsi(texto)) hex += /** @type {number} */ (ch.codePointAt(0)).toString(16).padStart(2, "0");
  return "<" + hex + ">";
}

/** O texto como ele sai no PDF: fora de 0x20–0x7E e 0xA0–0xFF vira "?". @param {string} texto */
function paraWinAnsi(texto) {
  return [...texto].map((ch) => {
    const c = /** @type {number} */ (ch.codePointAt(0));
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? ch : "?";
  }).join("");
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
 * Troca a fonte hospedada embutida (~14 KB) por um subconjunto só com os caracteres usados
 * (~1–2 KB). O subset roda num PDF à parte porque doc.subsetFonts() mexeria também nas
 * fontes originais — e há PDFs reais com fonte malformada em que isso dá erro. O resultado
 * (BaseFont com prefixo, Widths, FontDescriptor com o arquivo reduzido) é copiado por cima
 * do objeto que as páginas já referenciam. Se algo falhar, fica a fonte inteira, que é válida.
 * @param {Mupdf} mupdf @param {import("mupdf").PDFDocument} doc
 * @param {import("mupdf").PDFObject} objeto @param {import("mupdf").Font} fonte @param {Set<string>} chars
 */
function reduzirFonte(mupdf, doc, objeto, fonte, chars) {
  const tmp = new mupdf.PDFDocument();
  try {
    const f = tmp.addSimpleFont(fonte, "Latin");
    const fontes = tmp.newDictionary();
    fontes.put("F", f);
    const recursos = tmp.newDictionary();
    recursos.put("Font", fontes);
    tmp.insertPage(-1, tmp.addPage([0, 0, 100, 100], 0, recursos,
      `BT /F 10 Tf ${paraHexWinAnsi([...chars].join(""))} Tj ET`));
    tmp.subsetFonts();
    const reduzida = doc.graftObject(f).resolve();
    reduzida.forEach((v, k) => objeto.put(k, v));
  } catch {
    // mantém a fonte inteira
  } finally {
    tmp.destroy();
  }
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
 * @param {import("mupdf").PDFDocument} doc
 * @param {import("mupdf").PDFPage} pagina @param {Substituicao[]} subs
 * @param {Map<string, import("mupdf").PDFObject>} fontesDoc — cache por documento: um objeto
 *   por fonte, referenciado por todas as páginas (sem duplicar por página)
 * @param {FonteDe} fonteDe
 */
function reinserir(doc, pagina, subs, fontesDoc, fonteDe) {
  const paginaObj = pagina.getObject();
  const fontes = prepararFontes(doc, paginaObj);
  /** @type {Map<string, string>} */
  const nomes = new Map(); // chave da fonte → nome do recurso na página
  const registrar = (/** @type {ReturnType<FonteDe>} */ { chave, criar }) => {
    let i = 0, nome = "TRq0";
    while (fontes.get(nome) && !fontes.get(nome).isNull()) nome = "TRq" + ++i;
    let objeto = fontesDoc.get(chave);
    if (!objeto) {
      objeto = doc.addSimpleFont(criar(), "Latin");
      fontesDoc.set(chave, objeto);
    }
    fontes.put(nome, objeto);
    return nome;
  };
  const M = pagina.getTransform();
  let codigo = "Q\n";
  for (const s of subs) {
    const escolhida = fonteDe(s);
    let nome = nomes.get(escolhida.chave);
    if (!nome) { nome = registrar(escolhida); nomes.set(escolhida.chave, nome); }
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
  // Fontes dos acordes (~14 KB cada), só as que o PDF declara. Falha não é erro: o acorde
  // sai na fonte padrão do PDF. Download que falhou sai do cache: o próximo pedido tenta de novo.
  /** @type {Map<string, Promise<Uint8Array | null>>} */
  const fontesBaixadas = new Map();
  const baixarFonte = (/** @type {string} */ a) => {
    let p = fontesBaixadas.get(a);
    if (!p) {
      // Limite de 10 s: a fonte é baixada depois do MuPDF, e um download parado travaria a
      // transposição. AbortSignal.timeout não existe em navegador antigo (Safari < 16): lá, sem limite.
      p = fetch(new URL("fontes/" + a, import.meta.url), { signal: AbortSignal.timeout?.(10000) })
        .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null))
        .catch(() => null)
        .then((b) => { if (!b) fontesBaixadas.delete(a); return b; });
      fontesBaixadas.set(a, p);
    }
    return p;
  };
  const carregarFontes = async (/** @type {string[]} */ arquivos) => {
    const lista = await Promise.all(arquivos.map(async (a) => /** @type {const} */ ([a, await baixarFonte(a)])));
    return new Map(/** @type {[string, Uint8Array][]} */ (lista.filter(([, b]) => b)));
  };
  ctx.onmessage = async (/** @type {MessageEvent} */ ev) => {
    // Pré-carga sob demanda: a página pede assim que o usuário demonstra intenção (abre o
    // seletor, arrasta, escolhe o arquivo), e os ~4 MB comprimidos do WASM baixam enquanto
    // ele escolhe o arquivo e o tom — não no clique, e nem para quem só visita a página.
    // Falha aqui é silenciosa — o clique em Transpor retenta e aí reporta o erro.
    if (ev.data?.tipo === "preparar") { carregarMupdf().catch(() => {}); return; }
    const { dados, n } = ev.data;
    try {
      const mupdf = await carregarMupdf();
      const fontes = await carregarFontes(fontesHospedadasDoPdf(mupdf, dados));
      const r = transporPdf(mupdf, dados, n,
        (pagina, total) => ctx.postMessage({ tipo: "progresso", pagina, total }), fontes);
      ctx.postMessage({ tipo: "ok", dados: r.dados }, [r.dados.buffer]);
    } catch (e) {
      const mensagem = e instanceof ErroAmigavel ? e.message
        : "Não consegui mudar o tom deste PDF. Tente outro arquivo.";
      // Falha de rede no import do CDN: a mensagem crua do navegador não ajuda o usuário.
      ctx.postMessage({ tipo: "erro", mensagem: carregando === null
        ? "Não consegui carregar. Confira a internet e tente de novo."
        : mensagem });
    }
  };
}
