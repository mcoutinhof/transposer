// @ts-check
// Lógica da página: seleção de arquivo, semitons, worker, download.
const ROTULO_PADRAO = "Arraste um PDF de cifra aqui ou clique para escolher";

const entrada = /** @type {HTMLInputElement} */ (document.getElementById("arquivo"));
const area = /** @type {HTMLElement} */ (document.getElementById("area"));
const rotulo = /** @type {HTMLElement} */ (document.getElementById("rotulo"));
const semitons = /** @type {HTMLInputElement} */ (document.getElementById("semitons"));
const botao = /** @type {HTMLButtonElement} */ (document.getElementById("transpor"));
const status = /** @type {HTMLElement} */ (document.getElementById("status"));

const worker = new Worker("./worker.js", { type: "module" });

/** @type {File | null} */
let arquivo = null;
/** @type {{ nome: string, n: number } | null} — captura no clique; usuário pode mexer na UI durante o processamento */
let emCurso = null;

function lerN() {
  const v = Number(semitons.value);
  return Number.isInteger(v) && v >= -11 && v <= 11 ? v : 0;
}
function atualizar() {
  botao.disabled = emCurso !== null || !arquivo || lerN() === 0;
}
function avisar(/** @type {string} */ mensagem, ehErro = false) {
  status.textContent = mensagem;
  status.classList.toggle("erro", ehErro);
}
function escolher(/** @type {File | undefined} */ f) {
  const ehPdf = !!f && (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  arquivo = ehPdf && f ? f : null;
  rotulo.textContent = arquivo ? arquivo.name : ROTULO_PADRAO;
  avisar(f && !ehPdf ? "Escolha um arquivo PDF." : "", !!f && !ehPdf);
  atualizar();
}

area.addEventListener("click", () => entrada.click());
entrada.addEventListener("change", () => escolher(entrada.files?.[0]));
area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("arrastando"); });
area.addEventListener("dragleave", () => area.classList.remove("arrastando"));
area.addEventListener("drop", (e) => {
  e.preventDefault();
  area.classList.remove("arrastando");
  escolher(e.dataTransfer?.files?.[0]);
});
semitons.addEventListener("input", atualizar);

botao.addEventListener("click", async () => {
  if (!arquivo || lerN() === 0 || emCurso) return;
  emCurso = { nome: arquivo.name, n: lerN() };
  atualizar();
  avisar("Carregando…");
  const dados = await arquivo.arrayBuffer();
  worker.postMessage({ dados, n: emCurso.n }, [dados]);
});

worker.onmessage = (/** @type {MessageEvent} */ ev) => {
  const m = ev.data;
  if (m.tipo === "progresso") {
    avisar(`Processando página ${m.pagina}/${m.total}…`);
    return;
  }
  const contexto = emCurso;
  emCurso = null;
  atualizar();
  if (m.tipo === "erro") { avisar(m.mensagem, true); return; }
  const blob = new Blob([m.dados], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const base = (contexto?.nome ?? "cifra.pdf").replace(/\.pdf$/i, "");
  const n = contexto?.n ?? 0;
  a.download = `${base} (${n > 0 ? "+" : ""}${n}).pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
  avisar(`${m.acordes} acordes transpostos em ${m.linhas} linhas`);
};
worker.onerror = () => {
  emCurso = null;
  atualizar();
  avisar("Erro inesperado no processamento.", true);
};

export {};
