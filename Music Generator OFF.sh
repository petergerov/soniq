#!/bin/bash
# Music Generator – Beendet Web-App und Modellserver unter Linux.
# Autor: ZeroDot1
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SOURCE_DIR/arch_linux.sh" --stop "$@"
