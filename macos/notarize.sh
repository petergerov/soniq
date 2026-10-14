#!/bin/bash
# Notarisiert eine signierte DMG bei Apple und heftet das Ticket an (dann öffnet macOS sie auch offline ohne Warnung).
# Das Ticket gilt auch für die App darin.
#
#   APPLE_ID=… APPLE_APP_PASSWORD=… APPLE_TEAM_ID=… macos/notarize.sh dist-mac/SONIQ.dmg
#
# APPLE_APP_PASSWORD ist ein app-spezifisches Passwort (account.apple.com › Anmeldung und Sicherheit).
set -euo pipefail
FILE="$1"
: "${APPLE_ID:?}" "${APPLE_APP_PASSWORD:?}" "${APPLE_TEAM_ID:?}"
AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD" --team-id "$APPLE_TEAM_ID")

echo "▸ Notarizing $(basename "$FILE") (usually a few minutes) …"
RESULT=$(xcrun notarytool submit "$FILE" "${AUTH[@]}" --wait --timeout 60m --output-format json)
echo "$RESULT"
ID=$(echo "$RESULT" | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -1)
if ! echo "$RESULT" | grep -q '"status" *: *"Accepted"'; then
  [ -n "$ID" ] && xcrun notarytool log "$ID" "${AUTH[@]}"
  echo "Notarization failed."
  exit 1
fi

echo "▸ Stapling"
xcrun stapler staple "$FILE"
xcrun stapler validate "$FILE"
spctl --assess --type open --context context:primary-signature --verbose=2 "$FILE"
