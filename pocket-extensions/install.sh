#!/usr/bin/env bash
# Link each Pi Pocket extension in this folder into Pi Pocket's drop-in folder.
# Then turn each one on in Pi Pocket: Menu → Extensions.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dropins="${PI_POCKET_DATA:-$HOME/.pi-pocket}/extensions"
# Node resolves a linked module from its real folder, so the modules here need Pi Pocket's packages too.
ln -sfn "$dropins/node_modules" "$here/node_modules"
for file in "$here"/*.ts; do
  ln -sfn "$file" "$dropins/$(basename "$file")"
  echo "linked $(basename "$file")"
done
