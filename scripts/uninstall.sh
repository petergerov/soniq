#!/bin/bash
# Music Generator – Deinstallation für macOS und Linux.
# Ursprung: Uninstall-Funktion von ZeroDot1 (Arch Linux), hier für Mac und Linux gemeinsam umgesetzt.
# Entfernt Modellserver, Modelle, Node.js-Laufzeit und Einstellungen. Songs und Bibliothek bleiben auf Wunsch.
# Optionen:  --yes  keine Rückfragen: alles entfernen, Songs und Bibliothek behalten
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$ROOT" || exit 1

AUTO=0
for a in "$@"; do case "$a" in --yes|-y) AUTO=1 ;; esac; done

frage() {   # frage "Text" standard(j|n): Enter nimmt den Standard
  [ "$AUTO" = 1 ] && return 0
  local a hint="[Enter = yes, n = no]"
  [ "$2" = "n" ] && hint="[Enter = no, y = yes]"
  read -r -p "$1 $hint " a
  if [ -z "$a" ]; then [ "$2" != "n" ]; else [[ "$a" =~ ^[jJyY] ]]; fi
}

# Sicherheitsprüfung: nur im Programmordner von Music Generator arbeiten
if [ ! -f "$ROOT/backend/src/main.ts" ] || [ ! -f "$ROOT/scripts/common.sh" ] || [ "$ROOT" = "/" ] || [ "$ROOT" = "$HOME" ]; then
  echo "✗ This does not look like the Music Generator folder ($ROOT). Nothing was changed."
  exit 1
fi

groesse() { [ -e "$1" ] && du -sh "$1" 2>/dev/null | cut -f1; }

echo "═══════════════════════════════════════════"
echo "  MUSIC GENERATOR · Uninstall"
echo "═══════════════════════════════════════════"
echo ""
echo "  This removes, inside $ROOT :"
[ -d "$ENGINE" ]        && echo "    engine/   model server and models   ($(groesse "$ENGINE"))"
[ -d "$ROOT/runtime" ]  && echo "    runtime/  Node.js (and cmake)       ($(groesse "$ROOT/runtime"))"
[ -d "$ROOT/node_modules" ] && echo "    node_modules/  developer tools      ($(groesse "$ROOT/node_modules"))"
[ -d "$ROOT/.venv" ]    && echo "    .venv/    old Python environment    ($(groesse "$ROOT/.venv"))"
[ -d "$DATA" ]          && echo "    data/     settings, logs, library   ($(groesse "$DATA"))"
echo "  Not removed: the program folder itself, tools installed outside it"
echo "  (for example Git) and songs in a song folder you chose yourself."
echo ""
frage "  Uninstall now?" n || { echo "  Cancelled. Nothing was changed."; exit 0; }

# 1. Server beenden
for p in "$PORT" "$SYNTH_PORT" "$LM_PORT"; do
  pids=$(port_pids "$p")
  [ -n "$pids" ] && { echo "  Stopping server on port $p ..."; kill $pids 2>/dev/null; }
done
sleep 1

# 2. Songs und Bibliothek behalten?
BEHALTEN=0
if [ -d "$DATA/songs" ] && [ -n "$(ls -A "$DATA/songs" 2>/dev/null)" ]; then
  echo ""
  echo "  Your songs are in data/songs ($(groesse "$DATA/songs"))."
  frage "  Keep songs and library (titles, folders, favorites)?" j && BEHALTEN=1
fi

# 3. Entfernen
echo ""
[ -d "$ENGINE" ]     && { echo "  - removing engine/ ..."; rm -rf "$ROOT/engine"; }
[ -d "$ROOT/runtime" ] && { echo "  - removing runtime/ ..."; rm -rf "$ROOT/runtime"; }
[ -d "$ROOT/node_modules" ] && { echo "  - removing node_modules/ ..."; rm -rf "$ROOT/node_modules" "$ROOT/backend/node_modules" "$ROOT/frontend/node_modules"; }
[ -d "$ROOT/.venv" ] && { echo "  - removing .venv/ ..."; rm -rf "$ROOT/.venv"; }
if [ -d "$DATA" ]; then
  if [ "$BEHALTEN" = 1 ]; then
    echo "  - cleaning data/ (keeping songs and library) ..."
    find "$DATA" -mindepth 1 -maxdepth 1 ! -name songs ! -name 'music.db*' -exec rm -rf {} +
  else
    echo "  - removing data/ ..."
    rm -rf "$DATA"
  fi
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  Done."
[ "$BEHALTEN" = 1 ] && echo "  Your songs and library were kept in data/."
echo "  To finish, delete this folder: $ROOT"
echo "═══════════════════════════════════════════"
