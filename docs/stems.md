# Spuren (Stems)

Überblick über die Spur-Funktionen in SONIQ: was man in der Oberfläche macht, und was im Hintergrund passiert.

Alle drei Erzeugungs-Funktionen brauchen das **Spuren-Modell** `acestep-v15-base` (~2,5 GB). Das normale Song-Modell (SFT/Turbo) kann `extract` und `lego` nicht. Ohne die Datei sind die Features ausgegraut bzw. mit Hinweis zum Download.

Grobe Dauer: etwa **75 Sekunden pro Spur und Minute Musik**.

---

## Spur für Spur

**Wo:** Create → Erzeugung „Spur für Spur“, Instrumente wählen.

**Was passiert:** Ein neuer Song entsteht Instrument für Instrument. Jede Spur wird mit ACE-Step **`lego`** erzeugt — die Begleitung ist die Summe der bereits fertigen Spuren (die erste Spur auf Stille). Pro Spur geht nur der Spur-Prompt plus bereinigter Stil in die Caption (fremde Instrumente/Gesang werden aus dem Song-Text gestrichen), sonst würde die erste Spur auf Stille oft einen Mini-Mix erzeugen. Der Mix ist genau die Summe der Einzelspuren; es gibt kein nachträgliches Trennen.

**Ergebnis:** Bibliothek-Eintrag mit Fertig-Mix und einzelnen Spuren (`kind: generated`).

---

## Spuren herauslösen (Extract)

**Wo:** Bibliothek → bei einem **Stereo-Mix** (Erzeugung „Ganzer Song“) **Stem Separation** öffnen → **2 / 4 / 6** Stems wählen und herauslösen.  
Nicht bei Spur-für-Spur, Replace oder Begleitung — die haben bereits Einzelspuren.

**Was passiert:** Keine Voranalyse und keine manuelle Spurwahl — feste Sets (z. B. 4 = drums/bass/guitar/vocals). Für jede Spur ruft SONIQ ACE-Step **`extract`** auf dem **Synth-Server (GPU: Metal / CUDA / Vulkan)** auf. Auf Apple Silicon hält der Server die Modelle mit `--keep-loaded` im Speicher, damit 2/4/6 Spuren nicht jedes Mal DiT/VAE neu laden. Die Spur wird **neu generiert** und folgt dem Song — das ist **kein** verlustfreier Stem-Split.

**Ergebnis:** Spuren am gleichen Song (`kind: extracted`), abspielbar, downloadbar, als ZIP, und im Mixer.

---

## Ersetzen / Begleiten

**Wo:** eigener Nav-Tab **Replace** → Route `#/replace` (nicht Teil von Create).

Datei hochladen (WAV, MP3, M4A, FLAC, OGG). SONIQ analysiert zuerst Tempo, Tonart, Länge und Stil (`/understand`). Dann zwei Modi:

### Instrumente ersetzen

Upload ist ein **Mix**. Man wählt:

- **Behalten (herauslösen)** — diese Instrumente bleiben
- **Neu erzeugen** — diese Instrumente werden ersetzt

Ablauf im Hintergrund:

1. Jeder Keeper: **`extract`** aus dem Upload  
2. Jeder Ersatz: **`lego`**, Backing = Summe der herausgelösten Keeper (+ schon fertige Ersetzungen), Reihenfolge Rhythmus zuerst  
3. Mix = Keeper + neue Spuren (peak-normalisiert). Der Upload wird gespeichert, steckt aber **nicht** im Mix — die alten Instrumente der Ersatz-Gruppe sind weg.

**Warum erst extract, dann lego?** `lego` direkt auf dem vollen Mix folgt dem Song nicht (Experiment). `extract` folgt dem Song; `lego` auf einer Summe sauberer Spuren rastet ein.

### Neue Begleitung

Upload ist schon eine **isolierte Take** (z. B. Gesang oder Gitarre). Kein Extract. Für jedes gewählte Instrument: **`lego`** nacheinander, Backing = die hochgeladene Datei.

**Ergebnis:** neuer Bibliothek-Eintrag („Replacement for …“ / „Accompaniment for …“) mit Spuren (`replacement` / `accompaniment`) und Mix.

---

## Mixer

**Wo:** Bibliothek → Tracks → **Mixer**, oder `#/mixer/:songId`.

**Was es ist:** reine Wiedergabe-UI für fertige Spuren eines Songs:

- Waveform pro Spur  
- Lautsprecher-Icon → Klick klappt den Lautstärke-Regler aus  
- Mute (M) und Solo (S)  
- gemeinsamer Transport (Play/Pause, Scrub, Zeit), Spuren synchron  

Keine neue Synthese — es werden die gespeicherten WAV-Dateien geladen. Der normale Player-Balken ist auf dieser Seite ausgeblendet.

---

## Technik kurz

| Begriff | Bedeutung |
|---|---|
| `extract` | Mix + Spurname → isolierte Spur (neu generiert) |
| `lego` | Backing + Spurname → neue Spur, die zum Backing passt (Backing steckt nicht im Output) |
| `complete` | isolierte Take → ganzer Mix drumherum (für Begleitung optional denkbar, aktuell nicht der Hauptweg) |

- Jobs laufen in der **gleichen Queue** wie Songs, nacheinander. Abbrechen stoppt die aktuelle Spur und verwirft den Rest.  
- Dateien: `<song-id>.<track>.wav` im Song-Ordner.  
- Tabelle `stems`: `id`, `song_id`, `track`, `kind`, `status`, Reihenfolge, Zeiten. Song löschen löscht die Spuren.  
- Engine: Multipart `POST /synth` mit `synth_model` = Base-Modell.  
- API u. a.: `GET /api/songs/:id/stems`, `…/stems.zip`, `GET /api/stems/:id/audio`, `DELETE /api/stems/:id`, `DELETE /api/songs/:id/stems`, `POST /api/songs/:id/stems` (extract), `POST /api/stems/upload` (replace/accompany).

Plan, Experimente und Status der Umsetzung: [`newfeatures.md`](../newfeatures.md).
