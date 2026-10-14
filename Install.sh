#!/bin/bash
# Music Generator – Installer für Linux (Arch Linux / Derivate).
# Autor: ZeroDot1
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SOURCE_DIR/arch_linux.sh" --install-only "$@"
