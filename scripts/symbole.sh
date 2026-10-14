#!/bin/bash
# Setzt die Symbole und blendet die Endung ".command" aus. Git und ZIP-Entpacken überschreiben beides,
# deshalb ruft der Installer das hier auf und die App bei jedem Start noch einmal.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
osascript -l JavaScript - "$ROOT" >/dev/null 2>&1 <<'JXA'
ObjC.import("AppKit");
function run(argv) {
  const root = argv[0] + "/", ws = $.NSWorkspace.sharedWorkspace, fm = $.NSFileManager.defaultManager;
  const hide = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSFileExtensionHidden);
  for (const [png, file] of [["assets/icon-on.png", "start.command"],
                             ["assets/icon-off.png", "stop.command"],
                             ["assets/icon-on.png", "install.command"]]) {
    ws.setIconForFileOptions($.NSImage.alloc.initWithContentsOfFile(root + png), root + file, 0);
    fm.setAttributesOfItemAtPathError(hide, root + file, null);
  }
}
JXA
