#!/bin/bash
# Beendet Web-App und Modellserver und schließt die Browser-Tabs der App.
source "$(dirname "$0")/scripts/common.sh"

for P in "$PORT" "$SYNTH_PORT" "$LM_PORT"; do
  PIDS=$(lsof -i :"$P" -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "Stopping server on port $P..."
    kill $PIDS
  fi
done
sleep 1
echo "Servers stopped."

osascript -e "
if application \"Google Chrome\" is running then
  tell application \"Google Chrome\"
    repeat with w in windows
      set tabList to every tab of w
      repeat with i from (count tabList) to 1 by -1
        set t to item i of tabList
        if (URL of t contains \"localhost:$PORT\") or (URL of t contains \"127.0.0.1:$PORT\") then close t
      end repeat
    end repeat
  end tell
end if
if application \"Safari\" is running then
  tell application \"Safari\"
    repeat with w in windows
      set tabList to every tab of w
      repeat with i from (count tabList) to 1 by -1
        set t to item i of tabList
        if (URL of t contains \"localhost:$PORT\") or (URL of t contains \"127.0.0.1:$PORT\") then close t
      end repeat
    end repeat
  end tell
end if
" >/dev/null 2>&1

fenster_schliessen
exit 0
