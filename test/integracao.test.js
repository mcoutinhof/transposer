// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import * as mupdf from "mupdf";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transporPdf, FONTES_HOSPEDADAS, fontesHospedadasDoPdf } from "../worker.js";
import { criarPdf, salvar, LINHAS_CIFRA } from "./fixtures/gerar.mjs";
import { extrairTexto, extrairTokens } from "./util.mjs";

const bytesDe = (/** @type {mupdf.PDFDocument} */ doc) => doc.saveToBuffer("").asUint8Array().slice();
const abrir = (/** @type {Uint8Array} */ bytes) =>
  /** @type {mupdf.PDFDocument} */ (mupdf.Document.openDocument(bytes, "application/pdf"));

test("transpõe +2 preservando a letra, com contadores certos", () => {
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA)), 2);
  const doc = abrir(r.dados);
  const tokens = extrairTokens(doc).map((t) => t.texto);
  for (const esperado of ["A", "E/G#", "F#m", "D#m7(b5)", "C", "Eº", "(E7)", "|F#m|", "B7(9)"]) {
    assert.ok(tokens.includes(esperado), `falta ${esperado} em ${tokens}`);
  }
  assert.ok(!tokens.includes("G"), "acorde antigo G ainda presente");
  const texto = extrairTexto(doc);
  assert.match(texto, /A menina que passa danca/);
  assert.match(texto, /E o vento leva a saudade/);
  // 3 (Intro) + 3 (linha G D/F# Em) + 4 (C#m7(b5) Bb Dº (D7)) + 2 (|Em| A7(9)) = 12 acordes, 4 linhas
  assert.equal(r.acordes, 12);
  assert.equal(r.linhas, 4);
});

test("origens preservadas dentro da tolerância", () => {
  const antes = extrairTokens(criarPdf(["G   D/F#   Em"]));
  const r = transporPdf(mupdf, bytesDe(criarPdf(["G   D/F#   Em"])), 2);
  const depois = extrairTokens(abrir(r.dados));
  const em = antes.find((t) => t.texto === "Em");
  const fsm = depois.find((t) => t.texto === "F#m");
  assert.ok(em && fsm, "tokens não encontrados");
  assert.ok(Math.abs(em.x - fsm.x) < 0.7, `desvio x: ${em.x} → ${fsm.x}`);
  assert.ok(Math.abs(em.y - fsm.y) < 0.7, `desvio y: ${em.y} → ${fsm.y}`);
});

test("página com /Rotate 90: transpõe e preserva a letra (redação não come a linha vizinha)", () => {
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { rotate: 90 })), 2);
  const doc = abrir(r.dados);
  const texto = extrairTexto(doc);
  assert.match(texto, /A menina que passa danca/);
  assert.match(texto, /E o vento leva a saudade/);
  assert.ok(extrairTokens(doc).map((t) => t.texto).includes("F#m"));
  assert.equal(r.acordes, 12);
});

test("zero acordes → erro 'Não achei acordes'", () => {
  const semAcordes = criarPdf(["Documento sem nenhum acorde.", "So texto comum aqui."]);
  assert.throws(() => transporPdf(mupdf, bytesDe(semAcordes), 2), /Não achei acordes/);
});

test("PDF com senha → erro claro", () => {
  const caminho = join(mkdtempSync(join(tmpdir(), "transposer-")), "senha.pdf");
  salvar(criarPdf(LINHAS_CIFRA), caminho, "encrypt=aes-128,user-password=teste,owner-password=teste");
  assert.throws(() => transporPdf(mupdf, new Uint8Array(readFileSync(caminho)), 2), /senha/);
});

test("progresso é reportado por página", () => {
  /** @type {number[][]} */
  const chamadas = [];
  transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA)), 2, (pagina, total) => chamadas.push([pagina, total]));
  assert.deepEqual(chamadas, [[1, 1]]);
});

test("entrelinha apertada (0.82× a fonte): a redação não come a letra vizinha", () => {
  // Regressão: a banda antiga [baseline, +0.7] comia letra com entrelinha ≤ 0.85×.
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { entrelinha: 9 })), 2);
  const doc = abrir(r.dados);
  const texto = extrairTexto(doc);
  assert.match(texto, /A menina que passa danca/);
  assert.match(texto, /E o vento leva a saudade/);
  const tokens = extrairTokens(doc).map((t) => t.texto);
  for (const antigo of ["G", "D/F#", "Em", "C#m7(b5)", "Dº"]) assert.ok(!tokens.includes(antigo), `fantasma ${antigo}`);
  assert.equal(r.acordes, 12);
});

test("PDF digitalizado com OCR (texto invisível): erro claro, nada reinserido por cima da imagem", () => {
  assert.throws(() => transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { invisivel: true })), 2), /escaneado/);
});

test("acordes colados: cada pedaço é reinserido na posição do original", () => {
  const linha = ["E   B7   AE"]; // B7: acorde forte (sem ele, "E A AE" poderia ser letra)
  const antes = extrairTokens(criarPdf(linha));
  const depois = extrairTokens(abrir(transporPdf(mupdf, bytesDe(criarPdf(linha)), 2).dados));
  const ae = antes.find((t) => t.texto === "AE");
  // os pedaços B e F# encostam (como A e E encostavam) e extraem como um token só
  const novo = depois.find((t) => t.texto === "BF#");
  assert.ok(ae && novo, `tokens: ${depois.map((t) => t.texto)}`);
  assert.ok(Math.abs(novo.x - ae.x) < 0.7 && Math.abs(novo.y - ae.y) < 0.7, "B no lugar do A colado");
  assert.ok(!depois.some((t) => t.texto === "AE"), "fantasma AE");
});

test("várias páginas reusam o mesmo objeto de fonte (sem duplicar por página)", () => {
  const r = transporPdf(mupdf, bytesDe(criarPdf(LINHAS_CIFRA, { paginas: 3 })), 2);
  const doc = abrir(r.dados);
  const nums = [0, 1, 2].map((i) => doc.loadPage(i).getObject().get("Resources").get("Font").get("TRq0").asIndirect());
  assert.equal(new Set(nums).size, 1, `objetos: ${nums}`);
  assert.equal(r.acordes, 36);
});

test("texto invisível minoritário (marca d'água oculta) não vira mensagem de PDF digitalizado", () => {
  const r = criarPdf(["Documento sem nenhum acorde.", "So texto comum aqui."], { posambulo: "BT 3 Tr /F1 11 Tf 50 100 Td (marca) Tj ET\n" });
  assert.throws(() => transporPdf(mupdf, bytesDe(r), 2), /^Error: Não achei acordes/);
});

/** Fonte de cada token do PDF (nome como o MuPDF reporta). */
const fontesDosTokens = (/** @type {mupdf.PDFDocument} */ doc) => {
  /** @type {Map<string, string>} */
  const m = new Map();
  let texto = "", nome = "";
  const fechar = () => { if (texto) m.set(texto, nome); texto = ""; };
  doc.loadPage(0).toStructuredText("").walk({
    onChar(c, _o, f) { if (c.trim() === "") { fechar(); return; } if (!texto) nome = f.getName(); texto += c; },
    endLine: fechar,
  });
  return m;
};

test("fonte hospedada: acorde novo sai na cópia da fonte original", () => {
  // Simula o PDF do LibreOffice: fonte embutida com nome de subconjunto "BAAAAA+LiberationMono-Bold".
  const ttf = new Uint8Array(readFileSync(new URL("../fontes/TransposerMono-Bold.ttf", import.meta.url)));
  const original = () => bytesDe(criarPdf(["G   D/F#   Em", "A menina que passa"],
    { fonte: new mupdf.Font("TransposerMono-Bold", ttf), baseFont: "BAAAAA+LiberationMono-Bold" }));
  const hospedadas = new Map([[FONTES_HOSPEDADAS["LiberationMono-Bold"], ttf]]);
  const saida = abrir(transporPdf(mupdf, original(), 2, undefined, hospedadas).dados);
  const com = fontesDosTokens(saida);
  // prefixo de subconjunto: a fonte embutida só tem os caracteres usados
  assert.match(com.get("F#m") ?? "", /^[A-Z]{6}\+TransposerMono-Bold$/);
  assert.equal(com.get("E/G#"), com.get("F#m"));
  assert.equal(com.get("menina"), "BAAAAA+LiberationMono-Bold", "letra intacta");
  const arquivo = saida.loadPage(0).getObject().get("Resources").get("Font").get("TRq0")
    .get("FontDescriptor").get("FontFile2").readStream().getLength();
  assert.ok(arquivo < 3000, `fonte embutida com ${arquivo} bytes (inteira tem ~9 KB)`);
  // Sem a cópia (download falhou) ou com bytes que não são fonte (portal de Wi-Fi):
  // fonte padrão do PDF, sem erro.
  const sem = fontesDosTokens(abrir(transporPdf(mupdf, original(), 2).dados));
  assert.match(sem.get("F#m") ?? "", /^Courier/);
  const lixo = new Map([[FONTES_HOSPEDADAS["LiberationMono-Bold"], new TextEncoder().encode("<html>login</html>")]]);
  const invalida = fontesDosTokens(abrir(transporPdf(mupdf, original(), 2, undefined, lixo).dados));
  assert.match(invalida.get("F#m") ?? "", /^Courier/);
});

test("todo arquivo de FONTES_HOSPEDADAS existe e cobre tudo o que o worker escreve", () => {
  // ASCII imprimível + Latin-1 (fora disso o worker escreve "?"). Cobertura completa = a
  // escolha entre hospedada e base-14 nunca varia de um acorde para outro da mesma fonte.
  const faixa = (/** @type {number} */ a, /** @type {number} */ b) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i));
  const chars = [...faixa(0x20, 0x7e), ...faixa(0xa0, 0xff)];
  for (const arq of new Set(Object.values(FONTES_HOSPEDADAS))) {
    const f = new mupdf.Font(arq, new Uint8Array(readFileSync(new URL("../fontes/" + arq, import.meta.url))));
    const faltam = chars.filter((ch) => f.encodeCharacter(ch) === 0);
    assert.deepEqual(faltam, [], `${arq} sem glifo para ${faltam.join(" ")}`);
  }
});

test("fontesHospedadasDoPdf: só as fontes declaradas no PDF, inclusive Type0 (Cifra Club)", () => {
  const ttf = new Uint8Array(readFileSync(new URL("../fontes/TransposerMono-Bold.ttf", import.meta.url)));
  const simples = bytesDe(criarPdf(["G D Em"],
    { fonte: new mupdf.Font("TransposerMono-Bold", ttf), baseFont: "BAAAAA+LiberationMono-Bold" }));
  assert.deepEqual(fontesHospedadasDoPdf(mupdf, simples), ["TransposerMono-Bold.ttf"]);
  assert.deepEqual(fontesHospedadasDoPdf(mupdf, bytesDe(criarPdf(["G D Em"]))), [], "Courier: nada a baixar");
  assert.deepEqual(fontesHospedadasDoPdf(mupdf, new TextEncoder().encode("não é PDF")), []);
  // Type0 como o da Cifra Club: dicionário principal SEM FontDescriptor (fica no descendente),
  // e uma segunda fonte depois dela, que a varredura não pode pular.
  const doc = criarPdf(["G D Em"]);
  const t0 = doc.addFont(new mupdf.Font("TransposerMono-Bold", ttf));
  t0.put("BaseFont", doc.newName("OpenSans-Bold"));
  t0.get("DescendantFonts").get(0).put("BaseFont", doc.newName("OpenSans-Bold"));
  const fontes = doc.loadPage(0).getObject().get("Resources").get("Font");
  fontes.put("F0", t0);
  fontes.put("F2", doc.addSimpleFont(new mupdf.Font("TransposerMono-Bold", ttf), "Latin"));
  fontes.get("F2").put("BaseFont", doc.newName("OpenSans-Regular"));
  assert.deepEqual(fontesHospedadasDoPdf(mupdf, bytesDe(doc)).sort(), ["OpenSans-Bold.ttf", "OpenSans-Regular.ttf"]);
});

test("fontesHospedadasDoPdf: Form XObject que se referencia não interrompe a varredura", () => {
  const doc = criarPdf(["G D Em"], { paginas: 2 });
  // página 1: Form cujo /Resources (direto) aponta para o próprio Form
  const form = doc.addStream("", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10] });
  const res = doc.newDictionary(), xs = doc.newDictionary();
  xs.put("X", form); res.put("XObject", xs); form.put("Resources", res);
  const p1 = doc.loadPage(0).getObject();
  const r1 = doc.newDictionary(); r1.put("XObject", xs); p1.put("Resources", r1);
  // página 2: a fonte que precisa ser achada depois do ciclo
  const f = doc.addSimpleFont(new mupdf.Font("Courier"), "Latin");
  f.put("BaseFont", doc.newName("OpenSans-Bold"));
  const r2 = doc.newDictionary(), fs = doc.newDictionary();
  fs.put("F1", f); r2.put("Font", fs); doc.loadPage(1).getObject().put("Resources", r2);
  assert.deepEqual(fontesHospedadasDoPdf(mupdf, bytesDe(doc)), ["OpenSans-Bold.ttf"]);
});
