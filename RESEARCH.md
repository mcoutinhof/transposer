**Contexto:** Estou construindo um app web 100% client-side (roda offline no navegador, sem backend). O app recebe PDFs textuais (nunca escaneados/imagem) e precisa editar o texto existente por **substituição in-place**: trocar uma palavra ou trecho por outro de largura visual igual ou menor, sem nunca adicionar ou remover conteúdo, sem reflow. A formatação, fontes, espaçamento, posicionamento e o template do documento devem permanecer **100% intactos** — a edição precisa ser cirúrgica e imperceptível fora do trecho alterado.

**Tarefa:** Recomende a melhor biblioteca JavaScript/WASM para essa tarefa, priorizando **máxima qualidade do resultado**.

**Critérios de avaliação, em ordem de prioridade:**
1. **Fidelidade absoluta:** zero risco de corromper layout, fontes embutidas, encoding, ou qualquer outro elemento do PDF fora do trecho editado.
2. **Melhor balanço entre nível de abstração e qualidade:** prefira a opção mais high-level *que não sacrifique qualidade*. Não recomende uma lib low-level só por ser low-level — apenas se as high-level tiverem limitações reais de fidelidade. Se a lib ideal (high-level e high-quality) não existir, diga isso explicitamente e recomende o melhor compromisso.
3. **Viabilidade client-side/offline:** deve rodar inteiramente no navegador.
4. Licença e maturidade/manutenção do projeto são relevantes, mas secundárias.

**Formato da resposta:**
- Antes de recomendar, raciocine sobre o que a substituição in-place de texto em PDF realmente exige tecnicamente (ex.: manipulação de content streams, subsetting de fontes, encoding de glifos) e use isso como régua para julgar as candidatas.
- Compare as principais candidatas (pelo menos 3, se existirem) numa análise honesta de prós/contras frente aos critérios acima, incluindo onde cada uma **falha**.
- Termine com **uma recomendação clara e única**, justificada, e mencione limitações/armadilhas conhecidas dessa escolha que eu deva testar antes de me comprometer.
- Se alguma informação estiver desatualizada no seu conhecimento (versões, estado de manutenção), verifique fontes atuais antes de afirmar.

**Restrições:** Não presuma que posso usar servidor, ferramentas nativas (Ghostscript, qpdf via CLI) ou serviços externos. Se nenhuma opção atender bem aos critérios, prefira dizer isso claramente a forçar uma recomendação fraca.

---

# Melhor biblioteca JS/WASM para substituição de texto in-place em PDFs (100% client-side)

## TL;DR
- **Não existe uma opção que seja simultaneamente "alto nível" e de fidelidade perfeita para edição in-place de texto no browser sem backend.** A recomendação única é **MuPDF.js (pacote npm `mupdf`, WASM, da Artifex)** usando o fluxo redação-e-reinserção (`applyRedactions` + inserção de texto), aceitando que é uma API de médio/baixo nível e que exige que você forneça o arquivo de fonte original completa.
- Se orçamento comercial e uma UI de content-edit real forem prioridade acima do custo, **Apryse WebViewer** (WASM, comercial) é a única opção verdadeiramente de alto nível que edita texto existente in-place no browser — mas atenção: ela **também sofre do problema de fonte em subconjunto** e não o resolve magicamente para fontes embutidas.
- **Descarte pdf-lib** (não edita texto de página existente e está descontinuado — última release há ~5 anos), **pdf.js** (leitura/anotações, não reescreve content stream), **pdfcpu-wasm / qpdf-wasm** (não fazem substituição de glifos de texto) e as bindings PDFium JS (expõem rendering/extração, não a API de edição de texto pronta).

## Key Findings

1. **A tarefa é intrinsecamente de baixo/médio nível.** Substituir texto in-place num PDF exige manipular o content stream (operadores `Tj`/`TJ` dentro de `BT`/`ET`), lidar com fontes embutidas em subconjunto (subset), codificações (WinAnsi, Identity-H/CID), métricas de largura de glifos e o xref/atualização incremental. Nenhuma API "desenhe um texto novo" resolve isto sem risco.

2. **O maior risco de fidelidade é a fonte em subconjunto — e é universal.** Praticamente todo PDF embute apenas os glifos usados. O caractere de substituição pode não existir no subset embutido, produzindo espaços em branco ou "tofu". Isso vale tanto para soluções FOSS quanto comerciais: a própria documentação da Apryse alerta que, ao editar, "if the font is subset not all of the font characters may be available and may show up as either an incorrect or missing character when editing the text". Reaproveitar a fonte embutida é pouco confiável; o caminho robusto é ter o arquivo de fonte original completo.

3. **pdf-lib está descontinuado e não serve.** A versão npm mais recente é a 1.17.1, publicada há ~5 anos (última release em 2021); a Snyk classifica a manutenção como inativa: "it hasn't seen any new versions released to npm in the past 12 months, and could be considered as a discontinued project". Além disso, a própria documentação afirma que não oferece API para remover/editar texto de página fora de campos de formulário.

4. **MuPDF.js expõe as primitivas necessárias no WASM.** O pacote oficial `mupdf` (WASM/TypeScript) roda 100% no browser, expõe manipulação de objetos PDF, criação de fontes/texto, acesso a content stream, e `applyRedactions()`. Versão npm mais recente 1.27.0 (publicada há ~6 meses); dupla licença AGPL/comercial.

5. **Apryse WebViewer é a única opção "alto nível" real** para editar texto existente no browser via WASM (Content Edit WYSIWYG desde a versão 8.3, fev/2022), mas é comercial (exige chave de licença em produção) e não elimina o problema de glifos faltantes em fontes embutidas.

## Details

### O que a substituição in-place exige tecnicamente (a régua de avaliação)
Um PDF de texto guarda o texto como sequências de operadores de exibição (`Tj`, `TJ`, `'`, `"`) dentro de blocos `BT ... ET` no content stream da página, referenciando fontes por nome de recurso (`/F1 12 Tf`). Para substituir "palavra A" por "palavra B" de largura igual ou menor sem reflow, é preciso:

- **Editar o content stream** exatamente na posição do texto alvo, preservando matriz de texto (`Tm`/`Td`), espaçamento (`Tc`/`Tw`) e kerning nos arrays `TJ`.
- **Resolver a fonte e a codificação.** Se a fonte for simples com codificação WinAnsi, os códigos de caractere mapeiam diretamente; se for CID/Identity-H, os bytes são IDs de glifo (GIDs) internos ao subset — reescrever texto exige conhecer o mapeamento glifo↔unicode, que frequentemente não é reversível (o `/ToUnicode` pode estar ausente).
- **Garantir os glifos.** A fonte embutida quase sempre é um subconjunto contendo só os glifos já usados; caracteres novos podem faltar.
- **Respeitar as larguras** (o array `/Widths` ou métricas CID) para que o texto novo ocupe largura ≤ original — o requisito do usuário de "largura igual ou menor" ajuda, mas o posicionamento dos caracteres seguintes vem das larguras declaradas, então largura incorreta desloca o resto da linha.
- **Reserializar** via atualização incremental (mantendo o xref original) ou regravação completa, sem quebrar assinaturas digitais, PDF marcado (tags de acessibilidade) ou metadados.

Qualquer biblioteca deve ser julgada por quão bem controla esses pontos.

### Candidatos — análise honesta

**MuPDF.js (`mupdf` no npm, WASM, Artifex) — RECOMENDADO**
- **Manutenção/versão:** ativo; a página oficial do pacote confirma "MuPDF.js. Latest version: 1.27.0, last published: 6 months ago", com a linha MuPDF core em 1.26.x–1.28.x em 2025. Desenvolvido pela Artifex, criadora do MuPDF/Ghostscript.
- **Client-side:** sim, é WASM puro, roda em todos os browsers modernos, Node, Bun, Deno; binário WASM autocontido.
- **Capacidade de edição:** expõe o modelo de objetos de baixo nível (`PDFDocument`, `PDFObject`, `PDFPage`, `PDFAnnotation`), criação de fontes/texto (`addSimpleFont`, objetos `Text` com `showGlyph`/`showString`), acesso a `Contents`/`Resources` da página, e redações (`createAnnotation("Redact")`, `applyRedactions()` que remove conteúdo permanentemente). Isso permite o padrão robusto: (1) redigir/remover o trecho alvo e (2) reinserir o texto novo na mesma origem com a fonte correta.
- **Fidelidade:** o motor MuPDF C é de altíssima qualidade de rendering e a remoção por redação apaga exatamente os glifos que intersectam o retângulo. É a melhor base FOSS para preservar o resto do documento.
- **Onde FALHA / cuidados:** não há um método único "substitua a palavra X por Y preservando fonte" — você monta o fluxo. A limitação central (documentada pela própria Artifex/PyMuPDF, mesmo motor): "Fonts in PDFs usually are not complete but subset fonts... New text has a high chance to contain characters beyond that range. So the new text would contain spaces or 'tofus' for missing glyphs. In addition, embedded font files often are also often technically damaged: if you try to re-insert their extracted binary then this will raise exceptions." Reaproveitar a fonte embutida "só tem chance de funcionar se a fonte estiver de fato embutida via arquivo de fonte". Na prática você deve fornecer o arquivo de fonte completo correspondente. A redação por retângulo também pode apagar caracteres de linhas vizinhas se as caixas se sobrepõem verticalmente (mitigável com `set_small_glyph_heights`/ajuste de altura das caixas). Licença **AGPL v3** — se o app não for AGPL/open-source, é preciso licença comercial da Artifex (a partir de ~US$ 1.500, podendo passar de US$ 50.000 conforme escala).

**Apryse WebViewer (comercial) — melhor "alto nível", mas pago e sem panaceia de fonte**
- **Client-side:** sim; é um port WebAssembly/asm.js do SDK C++ da Apryse; o conteúdo não sai do browser (a "full API" roda client-side). O módulo full-API é 2–3× maior que o de visualização.
- **Capacidade de edição:** tem *Content Edit* WYSIWYG desde a versão 8.3 (fev/2022): "with the release of WebViewer 8.3, new PDF text editing via JavaScript allows users to edit in-line text and transform content in any web app, no servers required". Detecta estilos e permite edição in-line.
- **Fidelidade e o mito da fonte automática:** é o mais próximo de edição in-place "cirúrgica" pronta para uso e faz redação verdadeira preservando a camada de texto pesquisável. **Porém, a substituição automática de fonte se aplica a fontes NÃO embutidas** ("WebViewer will automatically use substitute fonts hosted on a web server when a font is not embedded in the document") — para fontes **embutidas em subconjunto** o problema persiste: "if the font is subset not all of the font characters may be available and may show up as either an incorrect or missing character when editing the text". Ou seja, o desafio nº 1 (glifo faltante) não é eliminado nem pela solução comercial.
- **Onde FALHA / cuidados:** **comercial** — exige chave de licença em produção (trial de 7 dias sem chave: "WebViewer comes with a 7-day trial without any feature limitations or trial key needed"); o editor é add-on licenciado separadamente ("For production, the editor and other add-ons are licensed separately from the base SDK"). Preço sob cotação: a Apryse publica "entry-level pricing... starting as low as $1,500", mas estimativas de terceiros para uso web são bem maiores (Vendr: "$2,000–$5,000 per seat annually" e servidores "$10,000–$25,000 per server annually"; SimplePDF: "typically starting at $10,000+/year for web-only licenses"). Bundle WASM considerável.

**MuPDF WebViewer** — produto comercial da Artifex sobre o mesmo motor, com UI de edição/redação no browser; alternativa "alto nível" se preferir o ecossistema Artifex, também sujeito a AGPL/comercial e ao mesmo limite de fonte em subconjunto.

**pdf-lib — DESCARTADO para este caso**
- MIT, roda no browser, ótimo para *criar* e *preencher formulários*. Mas: descontinuado (última release npm 1.17.1 há ~5 anos; Snyk: projeto possivelmente descontinuado) e, crucialmente, **não edita texto de página existente** — a doc oficial diz que remover/editar texto fora de campos de formulário não é suportado. Só permite "desenhar" texto novo por cima, o que não é substituição in-place fiel. Não atende.

**pdf.js (Mozilla) — DESCARTADO**
- Excelente renderizador/extrator no browser; ganhou editor de anotações (FreeText, ink), mas **não reescreve o content stream de texto existente**. Não serve para substituição in-place.

**Bindings PDFium em WASM (@embedpdf/pdfium, @hyzyla/pdfium, pdfium.js, urish/pdfium-wasm) — DESCARTADO na prática**
- O PDFium em C++ *tem* API de edição de texto (`FPDFPageObj_NewTextObj`, `FPDFText_SetText`, `FPDFPageObj_CreateTextObj`, `FPDFText_LoadFont`, `FPDFPage_GenerateContent`). Porém: as bindings JS/WASM existentes expõem sobretudo **rendering e extração**; `@hyzyla/pdfium` afirma que seu caso de uso principal é renderizar PDFs para imagens. Além disso, o próprio PDFium exige um subsetter de fonte externo ("You need a separate font subsetter, which is outside the scope of PDFium") e a inserção via `NewTextObj` cria texto sem fontes embutidas se mal usada. Montar edição in-place fiel sobre PDFium no browser hoje significa escrever muita ponte C→JS que essas libs não oferecem prontas — esforço maior e mais arriscado que MuPDF.js.

**muhammara/HummusJS — DESCARTADO**
- É wrapper de C++ para **Node.js**, não roda no browser; e busca-e-substituição de texto não é suportada em alto nível. Fora do escopo client-side.

**pdfcpu-wasm (Go) e qpdf-wasm — DESCARTADOS**
- Ambos compilam para WASM e rodam no browser, mas suas funções são estruturais (split/merge/otimizar/descriptografar/decodificar streams). Não fazem substituição de glifos de texto respeitando fontes. qpdf pode expor/reescrever streams em texto ASCII, mas não resolve fontes/codificação/glifos — inadequado para o requisito de fidelidade.

**Syncfusion JavaScript PDF (2025) e IronPDF** — Syncfusion lançou (beta, fim de 2025) uma lib JS/WASM client-side para criar/editar/assinar PDFs; é comercial e nova (maturidade a validar). IronPDF é focado em Node.js/servidor. Nenhuma demonstrou substituição in-place fiel preservando fonte embutida como diferencial verificável; tratar como candidatas a observar, não recomendar agora.

### Veredito comparativo
- **Fidelidade in-place + pronto para uso (UI/API de content-edit):** Apryse WebViewer — mas pago, comercial e **não** resolve automaticamente glifos faltantes em fontes embutidas.
- **Melhor equilíbrio FOSS/controle + client-side + qualidade de motor:** MuPDF.js — é médio/baixo nível e você assume a gestão de fontes.
- O "ideal" (alto nível **e** fidelidade perfeita **e** gratuito **e** client-side) **não existe**. Diga isso ao stakeholder: em ambos os caminhos, obter e embarcar a fonte completa é o que determina a qualidade final.

## Recommendations

**Passo 1 — Prototipar com MuPDF.js (`npm i mupdf`) imediatamente.** Implemente o fluxo: extrair `toStructuredText("preserve-spans")` para achar o span alvo (bbox, fonte, tamanho, cor, origin) → aplicar redação no retângulo do trecho → reinserir o texto novo em `span.origin` com a fonte correta e largura ≤ original. Valide em amostras reais dos seus PDFs.

**Passo 2 — Resolver a fonte antes de qualquer decisão final (fator decisivo de qualidade).** Como você controla os "templates", descubra se eles usam um conjunto conhecido e pequeno de fontes. Se sim, embarque os **arquivos de fonte completos** correspondentes no app (respeitando o licenciamento das fontes) e use-os na reinserção — isso elimina o risco de glifo faltante, que nem a solução comercial resolve para subsets embutidos.

**Passo 3 — Testar explicitamente os pontos de falha** antes de comitar: (a) glifos faltantes/tofu; (b) largura/kerning do texto novo vs. original; (c) integridade do `/ToUnicode` e extração de texto após a edição; (d) fontes CID/Identity-H (mapeamento GID); (e) PDFs marcados/acessibilidade; (f) invalidação de assinatura digital; (g) sobreposição vertical de linhas na redação.

**Passo 4 — Gatilhos para mudar de rota:**
- Se você **não conseguir obter/embarcar as fontes originais**, ou os PDFs usarem muitas fontes/CID complexas, e a qualidade com MuPDF.js ficar inaceitável → avalie **Apryse WebViewer** pela maturidade do content-edit WYSIWYG e pela redação preservando texto pesquisável (ciente de que o custo é alto e o problema de subset continua exigindo web fonts/fonte de reposição).
- Se **AGPL for incompatível** com seu produto fechado → ou compre licença comercial MuPDF/Artifex, ou vá de Apryse.
- Se precisar apenas de casos ASCII triviais → um patch direto de content stream (estilo qpdf) pode bastar em nichos, mas não recomendo como estratégia principal.

**Licenciamento (secundário, mas decisivo):** MuPDF.js é AGPL — se seu app não for open-source AGPL, orce a licença comercial Artifex. Apryse é 100% comercial e o editor é add-on separado. pdf-lib (MIT) seria o único permissivo, mas não faz a tarefa.

## Caveats
- **Fontes em subconjunto são o calcanhar de Aquiles** de qualquer solução (FOSS ou comercial): sem o arquivo de fonte completo, o texto de substituição pode não renderizar. Este é o item nº 1 a testar. A "substituição automática de fonte" da Apryse cobre fontes **não** embutidas (via web fonts), não subsets embutidos.
- **CID/Identity-H sem `/ToUnicode`** pode inviabilizar identificar/reescrever o texto com segurança — teste com seus documentos reais.
- **Assinaturas digitais** são invalidadas por qualquer edição de conteúdo (inclusive atualização incremental que altere bytes assinados).
- **PDF marcado/acessibilidade (Tagged PDF):** edições podem dessincronizar a árvore de estrutura e o `/ActualText`; verifique se acessibilidade é requisito.
- **Preços e status de manutenção** citados (MuPDF 1.27, faixas de preço Apryse/Artifex) refletem 2025–2026 e devem ser reconfirmados no momento da compra; a Apryse não publica preço público do módulo de content-edit — obtenha cotação oficial, e note que estimativas de terceiros (Vendr, SimplePDF) apontam valores bem acima do piso de US$ 1.500.
