const URL_MUPDF = "https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf.js";
const mupdf = await import(URL_MUPDF);
const doc = new mupdf.PDFDocument();
const pagina = doc.addPage([0, 0, 595, 842], 0, doc.newDictionary(), "");
doc.insertPage(-1, pagina);
postMessage(`OK: ${doc.countPages()} página(s), WASM inicializado`);
