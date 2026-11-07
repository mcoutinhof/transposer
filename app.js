// @ts-check
// Lógica da página: seleção de arquivo, tom, worker, download.
const ROTULO_PADRAO = "Arraste um PDF de cifra aqui ou clique para escolher";

const entrada = /** @type {HTMLInputElement} */ (document.getElementById("arquivo"));
const area = /** @type {HTMLElement} */ (document.getElementById("area"));
const rotulo = /** @type {HTMLElement} */ (document.getElementById("rotulo"));
const abaixar = /** @type {HTMLButtonElement} */ (document.getElementById("abaixar"));
const subir = /** @type {HTMLButtonElement} */ (document.getElementById("subir"));
const valor = /** @type {HTMLElement} */ (document.getElementById("valor"));
const botao = /** @type {HTMLButtonElement} */ (document.getElementById("transpor"));
const status = /** @type {HTMLElement} */ (document.getElementById("status"));

const worker = new Worker("./worker.js", { type: "module" });

/** @type {File | null} */
let arquivo = null;
/** @type {{ nome: string, n: number } | null} — captura no clique; usuário pode mexer na UI durante o processamento */
let emCurso = null;
/** Semitons. ±6 basta: a cifra não tem oitava, então +7 dá o mesmo PDF que −5. */
let n = 0;
const LIMITE = 6;

/**
 * Na língua do cantor, sem "semitom": 3 → "Subir 1 tom e meio", −1 → "Abaixar meio tom".
 * @param {number} n
 */
function descrever(n) {
  if (n === 0) return "Tom original";
  const tons = Math.floor(Math.abs(n) / 2);
  const meio = Math.abs(n) % 2 === 1;
  const quanto = tons === 0 ? "meio tom" : `${tons} ${tons === 1 ? "tom" : "tons"}${meio ? " e meio" : ""}`;
  return `${n > 0 ? "Subir" : "Abaixar"} ${quanto}`;
}
function atualizar() {
  valor.textContent = descrever(n);
  valor.classList.toggle("original", n === 0);
  abaixar.disabled = n <= -LIMITE;
  subir.disabled = n >= LIMITE;
  botao.disabled = emCurso !== null || !arquivo || n === 0;
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

// O clique/Enter na área é tratado nativamente pelo <label for="arquivo"> — sem JS.
entrada.addEventListener("change", () => escolher(entrada.files?.[0]));
// Soltar o arquivo FORA da área faria o navegador abrir o PDF e sair do app.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("arrastando"); });
area.addEventListener("dragleave", () => area.classList.remove("arrastando"));
area.addEventListener("drop", (e) => {
  e.preventDefault();
  area.classList.remove("arrastando");
  escolher(e.dataTransfer?.files?.[0]);
});
abaixar.addEventListener("click", () => { n = Math.max(n - 1, -LIMITE); atualizar(); });
subir.addEventListener("click", () => { n = Math.min(n + 1, LIMITE); atualizar(); });

botao.addEventListener("click", async () => {
  if (!arquivo || n === 0 || emCurso) return;
  emCurso = { nome: arquivo.name, n };
  atualizar();
  avisar("Carregando…");
  try {
    const dados = await arquivo.arrayBuffer();
    worker.postMessage({ dados, n: emCurso.n }, [dados]);
  } catch {
    // Ex.: o arquivo mudou/sumiu do disco depois de escolhido (NotReadableError).
    emCurso = null;
    atualizar();
    avisar("Não foi possível ler o arquivo — escolha-o de novo.", true);
  }
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
  // Revogar na hora pode cancelar o download em alguns navegadores; dá folga.
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  const plural = (/** @type {number} */ q, /** @type {string} */ um, /** @type {string} */ varios) => `${q} ${q === 1 ? um : varios}`;
  avisar(`${plural(m.acordes, "acorde transposto", "acordes transpostos")} em ${plural(m.linhas, "linha", "linhas")}`);
};
worker.onerror = () => {
  emCurso = null;
  atualizar();
  avisar("Erro inesperado no processamento.", true);
};

export {};
