# Music Generator – Windows-Test: Briefing für die Claude-Code-Session auf dem PC

## Was das ist

„Music Generator" ist eine lokale Web-App (FastAPI + Vanilla-JS), die über acestep.cpp
(ACE-Step 1.5, GGUF-Modelle) Songs erzeugt. Die Mac-Fassung ist fertig und öffentlich:
https://github.com/rabbitfiremediacreation/music-generator

Die Windows-Fassung ist ein **ungetesteter Erstentwurf** im privaten Repo:
https://github.com/rabbitfiremediacreation/music-generator
(Branch `main`; auf dem Mac heißt derselbe Stand Branch `windows` im Hauptprojekt.)

Ziel dieser Session: Installation auf diesem Windows-PC (NVIDIA-Grafikkarte) zum Laufen bringen,
Fehler in den Skripten beheben, Ergebnis ins private Repo pushen.

## Einstieg

```powershell
git clone https://github.com/rabbitfiremediacreation/music-generator.git $HOME\MusicGenerator
cd $HOME\MusicGenerator
.\Install.bat        # oder: .\Install.ps1 -Yes  (ohne Rückfragen)
```

Danach: `Music Generator ON.bat` startet alles und öffnet http://localhost:8765,
`Music Generator OFF.bat` beendet alles.

## Aufbau (nur die für Windows relevanten Teile)

| Datei | Zweck |
|---|---|
| `Install.ps1` / `Install.bat` | Installer. Optionen: `-Yes`, `-LM 0.6B|1.7B|4B`, `-NoStart`, `-Build` |
| `Music Generator ON.ps1` / `.bat` | startet ace-server (Port 8085, bei Modus split zusätzlich 8086 auf CPU) und uvicorn (Port 8765) |
| `Music Generator OFF.ps1` / `.bat` | beendet die Prozesse auf den drei Ports |
| `scripts/common.ps1` | Pfade, Port-Hilfsfunktionen, `Start-Hintergrund`. Liest PORT, SYNTH_PORT, LM_PORT, ACESTEP_REPO, ACESTEP_REV, HF_BASE **aus `scripts/common.sh`** (eine Quelle für Mac und Windows) |
| `scripts/metal_selftest.py` | Selbsttest per HTTP: läuft das Sprachmodell auf der GPU korrekt? Exit 0 = Modus `single`, sonst `split` (LM auf CPU) |
| `app/main.py` `/api/shutdown` | Knopf „Server stoppen" in der App, Windows-Zweig startet `Music Generator OFF.ps1` |
| `app/updater.py` `_restart` | Neustart nach Update, Windows-Zweig wartet per `Get-NetTCPConnection` auf freien Port |
| `app/db.py` | liest `data/engine.conf` (MODE, LM_FILE), setzt daraus `lm_url` |
| `assets/icon-on.ico`, `icon-off.ico` | Icons für die `.lnk`-Verknüpfungen |
| `README-WINDOWS.md` | Anleitung |

Vom Installer erzeugt (nicht im Repo): `engine/acestep.cpp/build/Release/*.exe|dll`,
`engine/acestep.cpp/models/*.gguf`, `data/engine.conf`, `data/*.log`, `data/*.err.log`, `.venv/`.

## Was der Installer tut

1. PC prüfen (GPU per `Win32_VideoController` und `nvidia-smi`, RAM, freier Platz).
2. Sprachmodell wählen (0.6B < 12 GB RAM, 1.7B < 24 GB, sonst 4B).
3. Werkzeuge: `git` (winget, falls fehlt), `uv` (astral.sh-Installer), `uv sync`.
4. Modellserver: **fertige Binaries** von https://www.serveurperso.com/temp/acestep.cpp-win64/build/Release/
   (Index wird per Regex nach `*.exe`/`*.dll` durchsucht, Download mit `curl.exe -C -`).
   Stand dort: 7. Okt 2026, entspricht acestep.cpp HEAD. Unsere Mac-Version ist `b7ba6d9` (24. Sep);
   dazwischen nur Build-System- und ggml-Änderungen, keine API-Änderung.
   Mit `-Build` stattdessen: Quellcode klonen, cmake mit `-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=native`
   (braucht VS Build Tools + CUDA Toolkit, der Installer nennt die winget-Befehle und bricht ab).
5. Modelle von HuggingFace (`HF_BASE` aus common.sh): vae-BF16, Qwen3-Embedding-0.6B-Q8_0,
   acestep-v15-sft-Q8_0, acestep-5Hz-lm-<SIZE>-Q8_0.
6. Selbsttest: ace-server auf Port 8099 starten, `metal_selftest.py` ausführen, Modus in `data/engine.conf` schreiben.
7. Verknüpfungen `.lnk` (powershell -File …) in Programmordner und auf Desktop, dann ON ausführen.

## Ergebnis des Windows-Tests (10. Okt 2026, GTX 1060 6 GB, i7-7700, 64 GB RAM, Windows 10)

Installation, ON, OFF, Song-Erzeugung (30 s und 90 s), „Server stoppen“ und Update-Check laufen. Gefunden und behoben:

- **Python:** uv wählt das neueste Python (3.15.0), dafür hat pydantic-core keine Wheels, `uv sync` scheitert.
  Installer ruft jetzt `uv sync --python 3.12` auf.
- **CUDA fällt auf Pascal aus:** `ggml-cuda.dll` der fertigen Binaries ist mit CUDA 13 gebaut (importiert `cublas64_13.dll`,
  die nicht mitgeliefert wird) und enthält nur sm_86/89/120/121 (RTX 30xx bis 50xx). ggml lädt die DLL nicht und nimmt
  automatisch `Vulkan0` (GTX 1060 über den NVIDIA-Treiber, Vulkan 1.4). Kein Eingriff nötig, nur langsamer:
  LM 1.7B 41-54 tok/s, DiT 50 Schritte für 30 s in ~30 s, VAE 30 s in 13 s. Mit RTX 30xx+ sollte CUDA0 greifen (ungetestet).
- **Sprachmodell nach Grafikspeicher:** Nach RAM-Regel wäre 4B dran; es lädt 4,2 GB, dann scheitert der 1-GB-KV-Cache
  (`ErrorOutOfDeviceMemory`), der Server stirbt, Selbsttest meldet nur „Verbindung verweigert“ → Modus split.
  Installer deckelt jetzt nach VRAM (<6 GB 0.6B, <8 GB 1.7B, sonst 4B) und zeigt bei Absturz den Log-Schwanz. 1.7B: Modus single.
- **VAE-Decoder:** braucht ohne Kachelung 6,7 GB für 30 s Audio. Installer schreibt `VAE_CHUNK` (128 bei <8 GB, 256 bei <12,
  512 bei <16) nach `data/engine.conf`, ON gibt `--vae-chunk` an ace-server weiter. 90 s = 36 Kacheln, 33 s.
- **„Server stoppen“ tat nichts:** Python startete PowerShell mit `DETACHED_PROCESS` (keine Konsole). PowerShell 5.1
  startet dann, führt den Befehl aber nicht aus (Exit 0, keine Ausgabe, kein Fehler). Mit `CREATE_NO_WINDOW` (eigene
  unsichtbare Konsole) läuft es. Gefixt in `app/main.py` (Shutdown, getestet) und `app/updater.py` (`_restart`, gleicher
  Mechanismus, nicht getestet, weil die Installation nach dem Push auf dem neuesten Stand ist).
- `*.lnk` in `.gitignore` (der Installer legt sie im Programmordner an).
- Nicht geändert: Desktop-Verknüpfungen landen bei OneDrive-Umleitung unter `OneDrive\Desktop`, das ist korrekt so.
- Hinweis für Tests aus Claude Code heraus: Die Shell des Claude-Desktop-Tools läuft in einer MSIX-Sandbox, die `AppData`
  umleitet; uv-Installationen dort sind kaputt (Junction zeigt ins Leere). Installer und Skripte im Terminal-Panel laufen lassen.

## Bekannte Unsicherheiten (Stand vor dem Test, zur Einordnung)

- **Alle `.ps1` sind ohne PowerShell geschrieben und nie ausgeführt worden.** Syntax- oder Laufzeitfehler sind wahrscheinlich.
  Dateien haben UTF-8-BOM (wegen Umlauten in PowerShell 5.1) und per `.gitattributes` CRLF.
- **Starten die fertigen Binaries ohne CUDA-Toolkit?** `ggml-cuda.dll` ist 122 MB (CUDA vermutlich statisch gelinkt),
  aber ob `cublas64_*.dll` o. ä. fehlt, ist unbekannt. Symptom: ace-server beendet sich sofort, Fehler in `data\selftest.err.log`
  bzw. `data\ace-server.err.log`. Lösung dann: fehlende DLLs ins `build\Release` legen oder NVIDIA-Treiber/CUDA-Runtime installieren,
  oder `-Build`.
- **Wählt ace-server CUDA?** In `data\ace-server.err.log` muss `[Load] ... backend: CUDA0` stehen, nicht `CPU`.
  Backend-Auswahl: automatisch „best", erzwingen per Umgebungsvariable `GGML_BACKEND=CUDA0|Vulkan0|CPU`
  (so startet ON im Modus split das Sprachmodell mit `GGML_BACKEND=CPU`).
- **Selbsttest:** Auf dem Mac M4 rechnet das 1.7B-Sprachmodell unter Metal falsch (0 Codes), daher der Test.
  Ob das unter CUDA auch passiert, ist unbekannt. Ergebnis steht in der Installer-Ausgabe („Modus single/split").
- **`Start-Process -RedirectStandardOutput`** braucht getrennte Dateien für stdout/stderr, daher `*.log` + `*.err.log`.
- **`uv` im PATH:** Installer ergänzt `%USERPROFILE%\.local\bin`. Die `.lnk`-Verknüpfungen starten eine frische PowerShell,
  common.ps1 setzt den PATH deshalb selbst.
- **Nicht umgesetzt:** OFF schließt keine Browser-Tabs (Mac macht das per AppleScript).
- **`app/updater.py` `REPO_URL`** zeigt im Windows-Branch auf das private Repo; der Update-Knopf in der App macht `git pull origin main`.

## Konventionen

- Antworten und Kommentare auf Deutsch, Lee duzen, kurz.
- Commits mit `Co-Authored-By: Claude …`-Zeile, pushen nach `origin main` des öffentlichen Repos.
- Mac-Dateien (`*.command`, `scripts/symbole.sh`, `Install.command`) nicht anfassen; sie werden später zurückgemerged.
- Werte, die Mac und Windows teilen (Ports, acestep-Version, HF-Adresse), nur in `scripts/common.sh` ändern.
- Songs/Einstellungen liegen in `data/` und sind in `.gitignore`.

## Nachtrag vom Mac (10. Okt 2026, nach dem PC-Test)

Die Härtung aus dem öffentlichen Repo (Hinweise von Jürgen/schimmilab.de) ist in diesen Branch gemerged:
TrustedHostMiddleware (nur localhost/127.0.0.1), `/api/update/apply` mit Pflicht-Header `X-Lang`,
Modelle von fester Hugging-Face-Revision, `ACESTEP_REV` als voller Hash, `MODEL_FILES`-Tabelle
(Name:MB:SHA-256) in `scripts/common.sh`.

**Auf dem PC geprüft (10. Okt 2026, nach dem Nachtrag):** Das In-App-Update von 67e852b auf ce4ba5a lief komplett durch
(`git pull`, Windows-Neustart per `_restart` mit `CREATE_NO_WINDOW`, App wieder da). Fremder `Host`-Header bekommt 400.
`common.ps1` liest alle 6 Tabelleneinträge; die SHA-256 der bereits geladenen Modelle stimmen mit der Tabelle überein.
Schnelltest mit beiseitegelegter `vae-BF16.gguf`: Download, Prüfsumme, Umbenennen ok, Installer gibt jetzt „Prüfsumme ok" aus.
Nebenbefund behoben: `updater.py` dekodierte Git-Ausgabe mit cp1252, Commit-Texte hatten kaputte Umlaute; jetzt UTF-8.

**Vom Mac als ungetestet markiert:**
- `scripts/common.ps1` liest jetzt zusätzlich `MODEL_FILES` aus `common.sh` in `$MODEL_MB` / `$MODEL_SHA`.
- `Install.ps1` baut `$FILES` daraus und prüft nach jedem Download die SHA-256 per `Get-FileHash`
  (Download nach `<datei>.neu`, dann Hash, dann umbenennen). Vorhandene Dateien werden nicht erneut geprüft.
- Beim `-Build`-Pfad wird `--help` gegen die ersten 7 Zeichen des Hashes verglichen.
- Schnelltest ohne Neuinstallation: eine Modelldatei umbenennen, `.\Install.ps1 -Yes -NoStart` laufen lassen,
  Prüfsumme muss „ok" melden; danach die umbenannte Datei löschen.

## Nachtrag: Deinstallation

`Uninstall.bat` / `Uninstall.ps1` sind neu und wurden ohne PowerShell geschrieben. Bitte auf dem PC prüfen:
`.\Uninstall.ps1` (nur anschauen und mit Enter abbrechen), dann in einer Kopie des Ordners `.\Uninstall.ps1 -Yes`.
Erwartet: Server werden beendet, `engine`, `.venv` und `data` (außer `songs` und `music.db*`) verschwinden, die vier Verknüpfungen (Ordner und Desktop) auch.
Mac und Linux nutzen `scripts/uninstall.sh` und sind getestet.

### Ergebnis auf dem PC (13. Okt 2026, Stand 560338a, gleicher PC wie oben)

**Funktioniert.** Getestet wurde der Weg, den ein normaler Nutzer geht: alles entfernen, Songs mitlöschen,
Ordner löschen, frisch klonen, neu installieren. Kein Fehler, keine Änderung am Skript nötig.

Ausgangslage: laufende App (Web-App und Synthese-Server), 7 Songs (82 MB), Modelle inklusive XL-Klangmodell.

**1. Deinstallation** per `Uninstall.bat`, Antworten wie getippt: „Uninstall now?“ → `y`, „Keep songs and library?“ → `n`.
(Für den Test wurden die beiden Antworten per Pipe übergeben; `Read-Host` liest sie dann aus der Eingabe.)

| Schritt | Ergebnis |
|---|---|
| Übersicht vorab | zeigt `engine\` 14,5 GB, `.venv\` 16 MB, `data\` 85 MB, die Verknüpfungen und was bleibt (Ordner, Git, uv, eigener Songordner) |
| Server beenden | „Stopping server on port 8765 / 8085“, danach kein Port mehr offen, kein `ace-server` mehr |
| Songs-Frage | erscheint mit Größe (82 MB), Vorgabe „behalten“, mit `n` beantwortet |
| Entfernen | `engine\`, `.venv\`, `data\` komplett weg (inkl. `songs` und `music.db`) |
| Verknüpfungen | alle vier entfernt, auch die auf dem umgeleiteten Desktop (`OneDrive\Desktop`) |
| Ende | „Done. To finish, delete this folder: …“, dann „Press any key to close…“ (hält das Fenster beim Doppelklick offen, richtig so) |

Nachkontrolle: Im Programmordner blieben nur die Repo-Dateien (7,6 MB), rund 14,6 GB waren frei.
Git und uv waren weiter installiert, wie angekündigt. Danach den Ordner von Hand gelöscht, wie das Skript es sagt.

**2. Neuinstallation** nach `README-WINDOWS.md`: `git clone` aus dem öffentlichen Repo (ohne Anmeldung), dann `Install.bat -Yes -XL`.

- Binaries neu geladen, alle fünf Modelle geladen, jede Prüfsumme „ok“.
- Selbsttest lief neu (nach frischer Installation nicht mehr „already tested“): Planung ok, 50 Codes → Modus `single`.
- `data\engine.conf` neu geschrieben, `VAE_CHUNK=128`, ace-server startet mit `--vae-chunk 128`.
- Verknüpfungen in Programmordner und auf dem Desktop wieder da, App startete am Ende selbst.
- App: leere Bibliothek, beide Klangmodelle verfügbar, Update-Check ok.
- 30-Sekunden-Song nach der Neuinstallation in etwa 60 s fertig, Audio nicht stumm.

**Nicht getestet:**
- Abbrechen mit Enter bei „Uninstall now?“ (sollte nichts ändern).
- Songs behalten (Enter bzw. `-Yes`): dann müssten `data\songs` und `music.db*` bleiben, der Rest von `data\` weg sein.
- Ein eigener Songordner außerhalb des Programmordners (laut Skript wird er nicht angefasst).
