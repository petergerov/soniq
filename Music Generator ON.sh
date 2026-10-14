#!/bin/bash
# Music Generator – Startet Modellserver + Web-App unter Linux.
# Autor: ZeroDot1
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SOURCE_DIR/arch_linux.sh" --start "$@"
