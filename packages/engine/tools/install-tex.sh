#!/bin/sh
# Install the TeX Live every reference comes from: the final, frozen edition of
# the year in tools/TEXLIVE (tlnet-final never changes), with the collections the
# oracles and fixtures use. CI runs this; locally it puts TeX where
# packages/engine/tools/tex.ts looks first.
#
#   sh packages/engine/tools/install-tex.sh [dir]     (default .cache/texlive/<year>)
set -eu
YEAR=$(cat "$(dirname "$0")/TEXLIVE")
REPO=https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/$YEAR/tlnet-final
DIR=$(mkdir -p "${1:-.cache/texlive/$YEAR}" && cd "${1:-.cache/texlive/$YEAR}" && pwd)
if [ -x "$DIR"/bin/*/latex ] 2>/dev/null; then echo "TeX Live $YEAR already in $DIR"; exit 0; fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -fsSL "$REPO/install-tl-unx.tar.gz" | tar -xz -C "$WORK"
cat > "$WORK/texlive.profile" <<PROFILE
selected_scheme scheme-custom
TEXDIR $DIR
TEXMFLOCAL $DIR/texmf-local
TEXMFSYSVAR $DIR/texmf-var
TEXMFSYSCONFIG $DIR/texmf-config
TEXMFHOME $DIR/texmf-home
TEXMFVAR $DIR/texmf-var
TEXMFCONFIG $DIR/texmf-config
collection-basic 1
collection-latex 1
collection-latexrecommended 1
collection-fontsrecommended 1
instopt_adjustpath 0
instopt_adjustrepo 0
tlpdbopt_autobackup 0
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
PROFILE
"$WORK"/install-tl-*/install-tl -profile "$WORK/texlive.profile" -repository "$REPO" > "$WORK/install.log" 2>&1 || { tail -40 "$WORK/install.log"; exit 1; }
"$DIR"/bin/*/tlmgr install enumitem cleveref
"$DIR"/bin/*/latex --version | head -1
