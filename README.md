# Music Generator

Eigene Songs lokal erzeugen – ohne Limits, ohne Abo, ohne Cloud.
Web-Oberfläche für [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) über
[acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp).

- **Mac** (Apple Silicon, Metal): diese Seite. Ausführliche Anleitung mit Bildern (Englisch): **[docs/guide](docs/guide/README.md)**
- **Windows** (NVIDIA, CUDA/Vulkan): **[README-WINDOWS.md](README-WINDOWS.md)**
- **Linux** (Arch Linux / Derivate mit Installer, andere Distributionen von Hand): Abschnitt [Linux](#linux-arch-linux--derivate) unten

## Installation

Voraussetzungen: Mac mit Apple Silicon (M1 oder neuer), mindestens 8 GB Arbeitsspeicher, 7–11 GB frei.

```bash
git clone https://github.com/rabbitfiremediacreation/music-generator.git ~/MusicGenerator
open ~/MusicGenerator/Install.command
```

Der Installer

1. prüft Chip, Arbeitsspeicher und freien Platz,
2. schlägt das passende Sprachmodell vor (0.6B unter 12 GB, 1.7B bis 24 GB, 4B darüber),
3. installiert was fehlt: Apple-Entwicklerwerkzeuge, Node.js (portabel in `runtime/`), `cmake` (ohne Homebrew, ohne Passwort),
4. baut acestep.cpp in der getesteten Version (`b7ba6d9`),
5. lädt nur die benötigten Modelle (fortsetzbar),
6. testet, ob das Sprachmodell auf dem Grafikchip richtig rechnet (sonst CPU, siehe unten),
7. richtet die Symbole für **Music Generator ON / OFF** ein und startet die App.

Er kann jederzeit erneut laufen; Erledigtes wird übersprungen.
Optionen: `--yes` (keine Rückfragen), `--lm 0.6B|1.7B|4B`, `--xl`, `--no-start`.

**XL-Klangmodell (optional):** Der Installer fragt, ob zusätzlich das größere Klangmodell ACE-Step 1.5 XL (4 statt 2 Milliarden Parameter, 5,3 GB) geladen werden soll. Laut den Entwicklern klingt es besser, es rechnet etwa doppelt so lange und braucht mehr Speicher (ab 16 GB Arbeitsspeicher bzw. 12 GB Grafikspeicher). Standard bleibt das kleinere Modell; XL wählst du danach unter Zahnrad › Klangmodell. Gemessen auf einem M4 mit 16 GB: ein 30-Sekunden-Song brauchte mit Standard 49 s, mit XL 99 s. Noch wenig getestet, Rückmeldungen willkommen.

## Benutzen

- **Music Generator ON** startet Modellserver und App und öffnet http://localhost:8765
- **Music Generator OFF** beendet alles und schließt die Browser-Tabs
- Oberfläche in zwölf Sprachen (Auswahl oben rechts): Deutsch, Englisch, Spanisch, Französisch, Italienisch, Portugiesisch, Türkisch, Polnisch, Russisch, Ukrainisch, Japanisch, Chinesisch. Korrekturen an `frontend/src/i18n/translations.ts` (Oberfläche) und `backend/src/i18n/messages.ts` (Meldungen des Servers) sind willkommen.

## Aktualisieren

In der App: Zahnrad › **Nach Updates suchen** › **Jetzt aktualisieren** (holt die neue Fassung von GitHub und startet die App neu; ändert sich acestep.cpp, weist sie auf den Installer hin). Oder von Hand:

```bash
cd ~/MusicGenerator && git pull
open Install.command
```

Songs und Einstellungen in `data/` bleiben erhalten.

## Deinstallieren

- **Mac:** `Uninstall.command` doppelklicken (oder im Terminal ausführen)
- **Windows:** `Uninstall.bat` doppelklicken
- **Linux:** `./Uninstall.sh` (oder `./arch_linux.sh --uninstall`)

Das Skript zeigt, was es entfernt, und fragt vorher. Es beendet die Server, löscht Modellserver, Modelle, Node.js-Laufzeit und Einstellungen (unter Windows auch die Verknüpfungen) und fragt, ob **Songs und Bibliothek** (Titel, Ordner, Favoriten) bleiben sollen. Vorgabe ist behalten. Mit `--yes` (Windows: `-Yes`) läuft es ohne Rückfragen und behält Songs und Bibliothek. Nicht entfernt werden der Programmordner selbst, Werkzeuge außerhalb davon (zum Beispiel Git) und Songs in einem selbst gewählten Song-Ordner. Zum Schluss den Programmordner löschen. Die Linux-Fassung geht auf eine Idee von ZeroDot1 zurück.

## Linux (Arch Linux & Derivate)

Unter Arch Linux (sowie CachyOS, EndeavourOS, Manjaro) steht ein automatisches All-in-One-Skript bereit (bereitgestellt von ZeroDot1):

```bash
git clone https://github.com/rabbitfiremediacreation/music-generator.git ~/MusicGenerator
cd ~/MusicGenerator
./arch_linux.sh
```

Das Skript:
1. Prüft System, RAM, Festplatte und Grafikkarte:
   - **AMD Radeon** (z. B. **RX 9070 XT** / Navi 48 / RDNA4): Native Beschleunigung über ROCm/HIP (`rocm-hip-sdk`) oder Vulkan (`vulkan-radeon` / RADV).
   - **NVIDIA**: CUDA oder Vulkan.
   - **Intel**: Vulkan (`vulkan-intel`).
   - **CPU**: Automatischer Fallback, falls keine GPU vorhanden ist.
2. Installiert fehlende Abhängigkeiten via `pacman` oder `yay` (`base-devel`, `cmake`, `git`, `curl`, `xdg-utils`, sowie je nach Backend `rocm-hip-sdk` bzw. `vulkan-headers`, `spirv-headers`, `shaderc`, `vulkan-icd-loader`).
3. Nutzt ein installiertes Node.js ab 22.18, sonst lädt es eine portable Version nach `runtime/node`.
4. Kompiliert `acestep.cpp` mit optimaler Hardwarebeschleunigung (ROCm/HIP für AMD, CUDA für NVIDIA, Vulkan oder CPU).
5. Lädt die benötigten GGUF-Modelle mit SHA-256-Prüfung herunter.
6. Führt den Grafik-Selbsttest durch, startet die Server und öffnet den Browser unter `http://localhost:8765`.

**Benutzen unter Linux:**
- Starten: `./arch_linux.sh` (oder `./Music\ Generator\ ON.sh`)
- Beenden: `./arch_linux.sh --stop` (oder `./Music\ Generator\ OFF.sh` sowie über den Knopf „Server stoppen“ in der Web-Oberfläche)
- Status: `./arch_linux.sh --status`
- Optionen: `--yes` (keine Rückfragen), `--yay` (Pakete via AUR-Helper yay installieren), `--backend [auto|rocm|hip|vulkan|cuda|cpu]`, `--lm [0.6B|1.7B|4B]`, `--xl`, `--rebuild`, `--no-browser`

**Mehrere Grafikkarten:** Das Skript nutzt standardmäßig die erste Karte und bevorzugt die dedizierte (`HIP_VISIBLE_DEVICES=0`, `DRI_PRIME=1`, `GGML_VK_VISIBLE_DEVICES=0`). Wer eine andere Karte braucht, setzt die Variable vor dem Start selbst, zum Beispiel `GGML_VK_VISIBLE_DEVICES=1 ./arch_linux.sh --start`. Die eigenen Werte werden nicht überschrieben.

### Andere Linux-Distributionen (von Hand)

Das Skript setzt `pacman` voraus. Auf Ubuntu, Debian, Fedora und anderen geht es von Hand. **Ungetestet**, Rückmeldungen willkommen.

Voraussetzungen: git, cmake, ein C++-Compiler, [Node.js](https://nodejs.org) ab 22.18 (empfohlen: 24 LTS), für NVIDIA das CUDA-Toolkit (AMD/Intel: Vulkan-SDK).

```bash
git clone https://github.com/rabbitfiremediacreation/music-generator.git ~/MusicGenerator
cd ~/MusicGenerator
# Modellserver in der getesteten Version bauen (Hash steht in scripts/common.sh)
git clone --recurse-submodules https://github.com/ServeurpersoCom/acestep.cpp engine/acestep.cpp
(cd engine/acestep.cpp && git checkout b7ba6d9 && ./buildcuda.sh)     # oder ./buildvulkan.sh, ./buildcpu.sh
# Modelle laden: die drei festen plus ein Sprachmodell (Adresse und SHA-256 in scripts/common.sh)
(cd engine/acestep.cpp && ./models.sh --lm 1.7B --sft)
# Betriebsart: ein Server für alles
mkdir -p data && printf 'MODE=single\nLM_FILE=acestep-5Hz-lm-1.7B-Q8_0.gguf\n' > data/engine.conf
```

Starten und Stoppen funktionieren danach mit `./arch_linux.sh --start` und `--stop`, auch ohne `pacman` (nicht getestet). Alternativ die beiden Server von Hand starten:

```bash
engine/acestep.cpp/build/ace-server --host 127.0.0.1 --port 8085 --models engine/acestep.cpp/models --max-batch 1
node --disable-warning=ExperimentalWarning backend/src/main.ts --port 8765
```

`models.sh` lädt mehr Varianten als nötig, gebraucht werden `vae-BF16`, `Qwen3-Embedding-0.6B-Q8_0`, `acestep-v15-sft-Q8_0` und das gewählte `acestep-5Hz-lm-*-Q8_0`. Songs liegen wie überall in `data/songs`.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `Install.command` | Installer (Mac) |
| `Uninstall.command`, `Uninstall.bat` / `.ps1`, `Uninstall.sh` | Deinstallation (Mac, Windows, Linux); `scripts/uninstall.sh` gemeinsam für Mac und Linux |
| `Music Generator ON/OFF.command` | Start und Stopp (Mac) |
| `Install.ps1`, `Music Generator ON/OFF.ps1` + `.bat` | Installer, Start und Stopp (Windows) |
| `arch_linux.sh`, `Install.sh`, `Music Generator ON/OFF.sh` | Installer, Start und Stopp (Arch Linux & Linux) |
| `scripts/common.sh` | gemeinsame Pfade, Ports, acestep.cpp-Version, Modell-Prüfsummen |
| `scripts/common.ps1` | Windows-Gegenstück, liest die Werte aus `common.sh` |
| `backend/` | Server in TypeScript (Node.js, ohne Laufzeit-Abhängigkeiten, läuft ohne Build), siehe unten |
| `frontend/` | Oberfläche in TypeScript (Vite); `frontend/dist/` ist die gebaute Fassung und liegt mit im Repo |
| `shared/api.ts` | Typen der HTTP-API, von Backend und Frontend gemeinsam genutzt |
| `runtime/` | portable Node.js-Laufzeit (und auf dem Mac ggf. cmake), vom Installer, nicht im Repo |
| `docs/guide/` | Anleitung mit Bildern (Englisch, Markdown). `capture.py` fotografiert die laufende App für die Bilder in `images/` (`uv run --with websockets python docs/guide/capture.py`) |
| `engine/` | acestep.cpp und Modelle (vom Installer, nicht im Repo) |
| `data/` | Songs, Datenbank, Logs, `engine.conf` (nicht im Repo) |

## Entwicklung

Backend und Frontend sind TypeScript. Endnutzer brauchen keinen Build: Node.js führt `backend/src` direkt aus
(Type Stripping, Node ab 22.18), die Oberfläche kommt fertig gebaut aus `frontend/dist`.

```bash
npm install            # Entwicklerwerkzeuge (TypeScript, Vite, wavesurfer.js)
npm run dev            # Backend mit --watch auf :8765 und Vite mit Hot Reload auf :5173 (leitet /api weiter)
npm run typecheck      # Typprüfung beider Teile
npm run build          # Oberfläche nach frontend/dist bauen – vor dem Commit ausführen, dist/ gehört ins Repo
```

`MG_DATA_DIR=/pfad` lässt das Backend einen anderen Datenordner nutzen (z. B. zum Testen mit einer Kopie der Bibliothek).

**Backend** (`backend/src`), Schichten von außen nach innen; Abhängigkeiten zeigen nur nach innen und werden in
`main.ts` (Composition Root) per Konstruktor übergeben:

| Ordner | Aufgabe |
|---|---|
| `http/` | Router, Request/Response, Validierung, Fehler → HTTP-Status; `routes/` je Ressource |
| `services/` | Anwendungslogik: Generierung + Warteschlange, Bibliothek, Ordner, Einstellungen, Analyse, Updates, System |
| `domain/` | Fachregeln und Schnittstellen ohne Technik: Songs, Fehlerarten, `MusicEngine` |
| `infrastructure/` | Technik: SQLite (`node:sqlite`), Repositories, acestep.cpp-Client, Dateien, ZIP, Git, Prozesse, Wachhalten |
| `config/`, `i18n/` | Pfade/Ports, Server-Meldungen in zwölf Sprachen |
| `cli/selftest.ts` | Sprachmodell-Test des Installers |

**Frontend** (`frontend/src`): `core/` (API-Client, DOM, Formatierung, Speicher), `i18n/`, und je Funktion ein Ordner
unter `features/` (`generator`, `analyze`, `library`, `player`, `settings`, `status`). `main.ts` verbindet alles.

## Grafikchip und die zwei Modi

Auf dem Apple M4 liefert das Sprachmodell unter Metal in acestep.cpp `b7ba6d9` fehlerhafte Ergebnisse
(0 Audio-Codes). Der Installer erkennt das mit einem kurzen Probelauf und schreibt nach `data/engine.conf`:

- `MODE=split` – Sprachmodell auf der CPU (Port 8086), Klangerzeugung auf Metal (Port 8085)
- `MODE=single` – alles auf einem Metal-Server (Port 8085)

Nach einem Update von acestep.cpp (`ACESTEP_REV` in `scripts/common.sh`) testet der Installer neu.

## Lizenz der Modelle

ACE-Step 1.5 steht unter Apache 2.0. Die Modelle werden beim Installieren von
[Hugging Face](https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF) geladen und sind nicht Teil dieses Repositorys.
Vor kommerzieller Nutzung die Lizenz- und Trainingsdaten-Lage selbst prüfen.

## Lizenz

Der Code in diesem Repository steht unter der [MIT-Lizenz](LICENSE).
Der Player nutzt [wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) (BSD-3-Clause), eingebunden in `frontend/dist`.
