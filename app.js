// @ts-check
// Lógica da página: seleção de arquivo, tom, worker, download.
const ROTULO_PADRAO = "Escolher o PDF da cifra";

const entrada = /** @type {HTMLInputElement} */ (document.getElementById("arquivo"));
const area = /** @type {HTMLElement} */ (document.getElementById("area"));
const rotuloTexto = /** @type {HTMLElement} */ (document.getElementById("rotulo-texto"));
const abaixar = /** @type {HTMLButtonElement} */ (document.getElementById("abaixar"));
const subir = /** @type {HTMLButtonElement} */ (document.getElementById("subir"));
const valor = /** @type {HTMLElement} */ (document.getElementById("valor"));
const valorTexto = /** @type {HTMLElement} */ (document.getElementById("valor-texto"));
const botao = /** @type {HTMLButtonElement} */ (document.getElementById("transpor"));
/** Região viva (polite) sempre ligada: recebe só mensagens de fim e erro. */
const status = /** @type {HTMLElement} */ (document.getElementById("status"));
const compartilhar = /** @type {HTMLButtonElement} */ (document.getElementById("compartilhar"));
/** Região só para leitor de tela: confirma o que a tela já mostra (arquivo, tom, limite). */
const anuncio = /** @type {HTMLElement} */ (document.getElementById("anuncio"));

const worker = new Worker("./worker.js", { type: "module" });

/** @type {File | null} */
let arquivo = null;
/** @type {{ nome: string, n: number } | null} — captura no clique; usuário pode mexer na UI durante o processamento */
let emCurso = null;
/** @type {File | null} PDF novo, para o botão Compartilhar */
let resultado = null;
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
  valorTexto.textContent = descrever(n);
  valor.classList.toggle("original", n === 0);
  // aria-disabled em vez de disabled: botão desabilitado perde o foco no limite, e mover o
  // foco para o outro botão faria o próximo Enter inverter a direção sem aviso.
  abaixar.setAttribute("aria-disabled", String(n <= -LIMITE));
  subir.setAttribute("aria-disabled", String(n >= LIMITE));
  // Apagado até ter PDF e tom (aria-disabled: continua focável e o leitor de tela diz "indisponível").
  botao.setAttribute("aria-disabled", String(emCurso === null && (!arquivo || n === 0)));
  botao.setAttribute("aria-busy", String(emCurso !== null));
  if (!emCurso) botao.textContent = "Mudar o tom";
}
/** O texto do meio, sozinho, soa igual ao nome do botão — o leitor de tela ouve o fato ("vai subir 1 tom"). */
function anunciarTom(noLimite = false) {
  if (n === 0) return anunciar("Tom original, sem mudança");
  const fato = descrever(n).replace(/^\S+/, (verbo) => `vai ${verbo.toLowerCase()}`);
  if (noLimite) anunciar(`Já está no máximo: ${fato}`);
  else anunciar(`V${fato.slice(1)}${Math.abs(n) === LIMITE ? ", o máximo" : ""}`);
}
/** @type {ReturnType<typeof setTimeout> | undefined} */
let escrita;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let limpeza;
/** Zera e reescreve (texto igual ao anterior também é anunciado) e limpa depois: aviso velho não fica no DOM. */
function anunciar(/** @type {string} */ texto) {
  anuncio.textContent = "";
  clearTimeout(escrita); // toques rápidos: só o último aviso é dito
  clearTimeout(limpeza);
  escrita = setTimeout(() => {
    anuncio.textContent = texto;
    limpeza = setTimeout(() => { anuncio.textContent = ""; }, 3000);
  }, 50);
}
/**
 * @param {string} mensagem texto visível
 * @param {{ erro?: boolean, falado?: string }} [opcoes] falado: substitui a mensagem para o leitor de tela
 */
function avisar(mensagem, { erro = false, falado } = {}) {
  /** @param {string} texto */
  const sr = (texto) => Object.assign(document.createElement("span"), { className: "sr", textContent: texto });
  status.replaceChildren();
  status.classList.toggle("erro", erro);
  status.classList.toggle("com-texto", !!mensagem);
  if (erro) status.append(sr("Erro: "));
  if (falado) {
    const visto = document.createElement("span");
    visto.setAttribute("aria-hidden", "true");
    visto.textContent = mensagem;
    status.append(visto, sr(falado));
  } else {
    status.append(mensagem);
  }
}
/** Resultado velho (de outro arquivo ou outro tom) não pode ficar na tela nem no Compartilhar. */
function limparResultado() {
  resultado = null;
  compartilhar.hidden = true;
  botao.classList.remove("feito");
  avisar("");
}
function escolher(/** @type {File | undefined} */ f) {
  if (!f) return; // cancelar o seletor dispara "change" vazio em alguns navegadores: mantém o já escolhido
  const ehPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
  arquivo = ehPdf ? f : null;
  area.classList.toggle("escolhido", !!arquivo);
  rotuloTexto.textContent = arquivo ? arquivo.name : ROTULO_PADRAO; // o ✓ está no ícone
  // O nome começa com o texto visível ("trocar de arquivo"), para quem usa comando de voz.
  entrada.setAttribute("aria-label", arquivo ? `Trocar de arquivo. Escolhido: ${arquivo.name}` : ROTULO_PADRAO);
  limparResultado(); // se está processando, segue com o arquivo antigo
  if (ehPdf) anunciar(`Arquivo escolhido: ${f.name}`);
  else avisar("Esse arquivo não é PDF. Escolha o PDF da cifra.", { erro: true });
  atualizar();
}

// O clique/Enter cai direto no campo, que cobre a área inteira.
entrada.addEventListener("change", () => escolher(entrada.files?.[0]));
// Primeiro sinal de intenção → worker começa a baixar o MuPDF (idempotente no worker).
const preparar = () => worker.postMessage({ tipo: "preparar" });
entrada.addEventListener("click", () => {
  // Zera ao abrir, não depois do change (senão o campo diria "nenhum arquivo escolhido" ao leitor
  // de tela): assim, escolher o mesmo arquivo de novo também dispara o change.
  entrada.value = "";
  preparar();
});
area.addEventListener("dragenter", preparar);
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
/** @param {number} passo */
function mudar(passo) {
  const limite = passo < 0 ? n <= -LIMITE : n >= LIMITE;
  n = Math.max(-LIMITE, Math.min(LIMITE, n + passo));
  if (!emCurso && !limite) limparResultado();
  atualizar();
  anunciarTom(limite);
}
abaixar.addEventListener("click", () => mudar(-1));
subir.addEventListener("click", () => mudar(1));

botao.addEventListener("click", async () => {
  if (emCurso) {
    anunciar(`Ainda ${botao.textContent?.replace("Mudando", "mudando")}`); // o botão mostra o progresso
    return;
  }
  if (!arquivo || n === 0) return; // botão apagado
  limparResultado();
  emCurso = { nome: arquivo.name, n };
  atualizar();
  botao.textContent = "Mudando o tom…";
  anunciar("Mudando o tom, aguarde.");
  try {
    const dados = await arquivo.arrayBuffer();
    worker.postMessage({ dados, n: emCurso.n }, [dados]);
  } catch {
    // Ex.: o arquivo mudou/sumiu do disco depois de escolhido (NotReadableError).
    emCurso = null;
    atualizar();
    avisar("Não consegui ler o arquivo. Escolha o PDF de novo.", { erro: true });
  }
});

compartilhar.addEventListener("click", async () => {
  if (!resultado) return;
  try {
    await navigator.share({ files: [resultado] });
  } catch (e) {
    // AbortError = a pessoa fechou a janela de compartilhar: não é erro.
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      avisar("Não deu para compartilhar daqui. O PDF está na pasta Downloads.", { erro: true });
    }
  }
});

worker.onmessage = (/** @type {MessageEvent} */ ev) => {
  const m = ev.data;
  if (m.tipo === "progresso") {
    if (m.total > 1) botao.textContent = `Mudando… ${m.pagina} de ${m.total}`; // 1 página: não há o que contar
    return;
  }
  const contexto = emCurso;
  emCurso = null;
  atualizar();
  if (m.tipo === "erro") { avisar(m.mensagem, { erro: true }); return; }
  const base = (contexto?.nome ?? "cifra.pdf").replace(/\.pdf$/i, "");
  const feito = contexto?.n ?? 0;
  const nome = `${base} (${feito > 0 ? "+" : ""}${feito}).pdf`;
  const blob = new Blob([m.dados], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  // Revogar na hora pode cancelar o download em alguns navegadores; dá folga.
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);

  const novo = new File([blob], nome, { type: "application/pdf" });
  const podeCompartilhar = !!navigator.canShare?.({ files: [novo] });
  // O navegador já mostra/abre o PDF baixado: na tela não sobra nada a dizer, exceto se o tom
  // mudou durante o processamento (o PDF é do tom pedido no toque, e a tela já mostra outro).
  // Quem usa leitor de tela não vê o download: para ele, o "Pronto" é falado.
  const outro = n !== feito ? "O tom escolhido agora é outro: toque em Mudar o tom de novo." : "";
  const falado = [`Pronto. O PDF ${nome} foi baixado.`, outro,
    podeCompartilhar ? "Para mandar no WhatsApp, use o botão Compartilhar o PDF, logo depois desta mensagem." : ""];
  avisar(outro, { falado: falado.filter(Boolean).join(" ") });
  if (podeCompartilhar) {
    resultado = novo;
    compartilhar.hidden = false;
    botao.classList.add("feito");
  }
};
worker.onerror = () => {
  emCurso = null;
  atualizar();
  avisar("Não consegui transformar este PDF. Tente outro arquivo, ou feche esta página e abra de novo.", { erro: true });
};

atualizar();

export {};
