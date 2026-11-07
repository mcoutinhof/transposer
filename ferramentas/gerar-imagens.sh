#!/usr/bin/env bash
# Gera favicon/ícones/imagem de compartilhamento a partir de icone.svg e ferramentas/og.html.
# Requer: inkscape, magick (ImageMagick 7), oxipng, chromium-browser. Rodar da raiz do repo.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# Variante sem cantos arredondados (o sistema aplica a própria máscara) — apple-touch e maskable.
sed 's/ rx="14"//' icone.svg > "$tmp/cheio.svg"
# Maskable: conteúdo encolhido para a zona segura (círculo central de 80%).
sed -e 's/ rx="14"//' -e 's#<g id="conteudo">#<g id="conteudo" transform="translate(6.4 6.4) scale(.8)">#' icone.svg > "$tmp/maskable.svg"

png() { inkscape "$1" -w "$2" -h "$2" -o "$3" >/dev/null 2>&1; }
for s in 16 32 48; do png icone.svg $s "$tmp/f$s.png"; done
magick "$tmp/f16.png" "$tmp/f32.png" "$tmp/f48.png" favicon.ico
png icone.svg 192 icone-192.png
png icone.svg 512 icone-512.png
png "$tmp/maskable.svg" 512 icone-maskable-512.png
png "$tmp/cheio.svg" 180 apple-touch-icon.png

chromium-browser --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot="$PWD/og.png" "file://$PWD/ferramentas/og.html" >/dev/null 2>&1
oxipng -q -o 4 --strip safe icone-*.png apple-touch-icon.png og.png
ls -l favicon.ico icone-*.png apple-touch-icon.png og.png
