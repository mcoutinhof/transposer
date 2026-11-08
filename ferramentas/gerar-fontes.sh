#!/usr/bin/env bash
# Gera fontes/*.ttf: as fontes das cifras mais comuns (Cifra Club = Open Sans;
# hinários exportados do LibreOffice = Liberation Mono), reduzidas aos caracteres
# que um acorde usa, para o acorde novo sair na mesma fonte do original.
# Requer: pyftsubset (pip install fonttools) e os pacotes Fedora open-sans-fonts
# (1.10, Apache 2.0) e liberation-mono-fonts (2.1.5, OFL). Rodar da raiz do repo.
#
# Liberation é "Reserved Font Name" na OFL: a versão reduzida é uma versão
# modificada e não pode usar esse nome, por isso vira "TransposerMono".
set -euo pipefail
cd "$(dirname "$0")/.."
OS=/usr/share/fonts/open-sans
LM=/usr/share/fonts/liberation-mono-fonts
# ASCII + Latin-1: tudo o que o worker consegue escrever (paraHexWinAnsi troca o resto
# por "?"). Com a cobertura igual à da base-14, a escolha da fonte não varia de acorde
# para acorde: ou todos os acordes de uma fonte saem na hospedada, ou nenhum.
CHARS="U+0020-007E,U+00A0-00FF"

reduzir() { # origem destino [família nova]
  pyftsubset "$1" --unicodes="$CHARS" --no-hinting --layout-features='' \
    --name-IDs='0,1,2,4,6,13,14' --drop-tables+=FFTM,DSIG,kern,GPOS,GSUB,GDEF \
    --output-file="$2" 2>/dev/null
  if [ -n "${3:-}" ]; then
    python3 - "$2" "$3" <<'EOF'
import sys
from fontTools.ttLib import TTFont
arq, familia = sys.argv[1:]
f = TTFont(arq)
estilo = f["name"].getDebugName(2)
ps = familia + ("" if estilo == "Regular" else "-" + estilo.replace(" ", ""))
for r in f["name"].names:
    if r.nameID == 1: r.string = familia
    elif r.nameID == 4: r.string = (familia + " " + estilo).replace(" Regular", "")
    elif r.nameID == 6: r.string = ps
f.save(arq)
EOF
  fi
}

mkdir -p fontes
reduzir $OS/OpenSans-Bold.ttf fontes/OpenSans-Bold.ttf
reduzir $OS/OpenSans-Regular.ttf fontes/OpenSans-Regular.ttf
reduzir $LM/LiberationMono-Bold.ttf fontes/TransposerMono-Bold.ttf TransposerMono
reduzir $LM/LiberationMono-BoldItalic.ttf fontes/TransposerMono-BoldItalic.ttf TransposerMono
reduzir $LM/LiberationMono-Regular.ttf fontes/TransposerMono-Regular.ttf TransposerMono
cp /usr/share/licenses/liberation-mono-fonts/LICENSE fontes/OFL-TransposerMono.txt
