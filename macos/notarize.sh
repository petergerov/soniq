#!/bin/bash
# Notarisiert eine signierte DMG bei Apple und heftet das Ticket an (dann öffnet macOS sie auch offline ohne Warnung).
# Das Ticket gilt auch für die App darin. Anleitung für die Zugangsdaten: macos/README.md
#
#   macos/notarize.sh dist-mac/SONIQ.dmg
#
# Zugangsdaten, in dieser Reihenfolge versucht:
#   A) App Store Connect API key (bevorzugt): APPLE_API_KEY_BASE64 (.p8 base64), APPLE_API_KEY_ID, APPLE_API_ISSUER
#   B) Apple-ID: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
#   C) lokal: SONIQ_NOTARY_PROFILE = Profil aus "xcrun notarytool store-credentials"
set -euo pipefail
FILE="$1"

if [ -n "${APPLE_API_KEY_BASE64:-}" ]; then
  : "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is missing}" "${APPLE_API_ISSUER:?APPLE_API_ISSUER is missing}"
  KEY_FILE="$(mktemp -d)/AuthKey_$APPLE_API_KEY_ID.p8"
  trap 'rm -rf "$(dirname "$KEY_FILE")"' EXIT
  echo "$APPLE_API_KEY_BASE64" | base64 --decode > "$KEY_FILE"
  AUTH=(--key "$KEY_FILE" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
  echo "  using App Store Connect API key $APPLE_API_KEY_ID"
elif [ -n "${APPLE_ID:-}" ]; then
  : "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD is missing}" "${APPLE_TEAM_ID:?APPLE_TEAM_ID is missing}"
  AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
  echo "  using Apple ID $APPLE_ID"
elif [ -n "${SONIQ_NOTARY_PROFILE:-}" ]; then
  AUTH=(--keychain-profile "$SONIQ_NOTARY_PROFILE")
  echo "  using notarytool profile $SONIQ_NOTARY_PROFILE"
else
  echo "No notarization credentials (see macos/README.md, step 4)."
  exit 1
fi

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
# Das Ticket holt stapler von Apples Server; direkt nach dem Notarisieren ist es manchmal noch nicht verteilt
# oder die Verbindung bricht ab (Error 68). Dann mit Pause wiederholen.
for attempt in 1 2 3 4 5; do
  xcrun stapler staple "$FILE" && break
  [ "$attempt" = 5 ] && { echo "Stapling failed after $attempt attempts."; exit 1; }
  echo "  stapling failed, retrying in $((attempt * 15)) s …"
  sleep $((attempt * 15))
done
# "stapler staple" prüft das Ticket schon selbst ("staple and validate action worked"); ein extra "stapler validate"
# fragt erneut bei Apple nach und scheiterte im CI an derselben abgebrochenen Verbindung. Zum Schluss Gatekeeper:
spctl --assess --type open --context context:primary-signature --verbose=2 "$FILE"
