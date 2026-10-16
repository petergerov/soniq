# Spuren (Stems)

Überblick über die Spur-Funktionen in SONIQ: was man in der Oberfläche macht, und was im Hintergrund passiert.

Alle drei Erzeugungs-Funktionen brauchen das **Spuren-Modell** `acestep-v15-base` (~2,5 GB). Das normale Song-Modell (SFT/Turbo) kann `extract` und `lego` nicht. Ohne die Datei sind die Features ausgegraut, mit Hinweis, wie man es bekommt: Installer-Frage bzw. `install --stems`
(Windows `.\install.ps1 -Stems`, Linux `./arch_linux.sh --stems`); in der Mac-App **Einstellungen › Spuren-Modell laden**
oder das Häkchen in der ersten Einrichtung. Danach sind die Funktionen ohne Neuladen der Seite frei.

Optional gibt es das **XL-Spuren-Modell** `acestep-v15-xl-base` (~5,3 GB, 4 statt 2 Mrd. Parameter, rechnet etwa doppelt
so lange): `install --xl-stems` (Windows `-XlStems`) bzw. in der Mac-App **Einstellungen › XL-Spuren-Modell laden**. Unter
**Einstellungen › Spuren-Modell** wählt man dann Standard oder XL (`Settings.stem_model`, `STEM_MODELS` in
`domain/music-engine.ts`). Fehlt die Datei des gewählten Modells, aber das andere ist da, rechnen die Spuren mit dem anderen.

Grobe Dauer: etwa **75 Sekunden pro Spur und Minute Musik**.

---

## Spur für Spur

**Wo:** Create → Erzeugung „Spur für Spur“, Instrumente wählen.

**Was passiert:** Ein neuer Song entsteht Instrument für Instrument. Jede Spur wird mit ACE-Step **`lego`** erzeugt — die Begleitung ist die Summe der bereits fertigen Spuren (die erste Spur auf Stille). Pro Spur geht nur der Spur-Prompt plus bereinigter Stil in die Caption (fremde Instrumente/Gesang werden aus dem Song-Text gestrichen), sonst würde die erste Spur auf Stille oft einen Mini-Mix erzeugen. Der Mix ist genau die Summe der Einzelspuren; es gibt kein nachträgliches Trennen.

**Lyrics:** Sind Gesangsspuren gewählt und keine Lyrics eingegeben, schreibt das Sprachmodell sie vorab (Plan). Dafür
bekommt es nur den Stil (Stichworte), nicht eine lange Beschreibung: Eine Analyse-Beschreibung wie „an energetic
instrumental piece … guitar solos“ führte sonst zu Lyrics ohne gesungenen Text (nur `[Instrumental Section …]`), und die
Gesangsspuren wurden wortlos. Hat der Plan weniger als vier gesungene Zeilen, fragt SONIQ mit anderem Seed erneut;
nach drei Versuchen bricht der Song ab, bevor Spuren entstehen („Keine Lyrics vom Modell“), dann Lyrics selbst eingeben.

**Ergebnis:** Bibliothek-Eintrag mit Fertig-Mix und einzelnen Spuren (`kind: generated`).

---

## Spuren herauslösen (Extract)

**Wo:** Bibliothek → bei einem **Stereo-Mix** (Erzeugung „Ganzer Song“) ohne Spuren im ⋮-Menü **Stem Separation** öffnen → **2 / 4 / 6** Stems wählen und herauslösen. Sind die Spuren fertig, verschwindet der Eintrag und der Mixer-Knopf erscheint.  
Nicht bei Spur-für-Spur, Replace oder Begleitung — die haben bereits Einzelspuren.

**Was passiert:** Keine Voranalyse und keine manuelle Spurwahl — feste Sets (z. B. 4 = drums/bass/guitar/vocals). Für jede Spur ruft SONIQ ACE-Step **`extract`** auf dem **Synth-Server (GPU: Metal / CUDA / Vulkan)** auf. Auf Apple Silicon hält der Server die Modelle mit `--keep-loaded` im Speicher, damit 2/4/6 Spuren nicht jedes Mal DiT/VAE neu laden. Die Spur wird **neu generiert** und folgt dem Song — das ist **kein** verlustfreier Stem-Split.

**Ergebnis:** Spuren am gleichen Song (`kind: extracted`); abspielen, herunterladen und ZIP im Mixer.

---

## Ersetzen / Begleiten

**Wo:** eigener Nav-Tab **Replace** → Route `#/replace` (nicht Teil von Create).

Datei hochladen (WAV, MP3, M4A, FLAC, OGG). Die Länge liest der Browser aus der Datei, das Stilfeld bleibt leer (optional ein kurzes Genre, z. B. `flamenco`). **Tempo und Tonart erkennen** ruft `/understand` auf und übernimmt nur BPM, Tonart, Takt und dieses kurze Genre — den Analyse-Absatz nicht. Dann zwei Modi:

### Instrumente ersetzen

Upload ist ein **Mix**. Man wählt:

- **Behalten (herauslösen)** — diese Instrumente bleiben
- **Neu erzeugen** — diese Instrumente werden ersetzt

Ablauf im Hintergrund:

1. Jeder Keeper: **`extract`** aus dem Upload  
2. Jeder Ersatz: **`lego`**, Backing = Summe der herausgelösten Keeper (+ schon fertige Ersetzungen), Reihenfolge Rhythmus zuerst. Die Caption ist nicht der ganze Analyse-Absatz: bei Fließtext bleiben Genre, Stimmung und die Rolle dieser Spur (z. B. „flamenco“ und „supportive acoustic bassline“), damit Schlagzeug nicht die Gitarren-Läufe nachspielt. Komma-Stichworte wie beim Spur-für-Spur-Stil bleiben wie bisher.  
3. Mix = Keeper + neue Spuren (peak-normalisiert). Der Upload wird gespeichert, steckt aber **nicht** im Mix — die alten Instrumente der Ersatz-Gruppe sind weg.

**Warum erst extract, dann lego?** `lego` direkt auf dem vollen Mix folgt dem Song nicht (Experiment). `extract` folgt dem Song; `lego` auf einer Summe sauberer Spuren rastet ein.

### Neue Begleitung

Upload ist schon eine **isolierte Take** (z. B. Gesang oder Gitarre). Kein Extract. Für jedes gewählte Instrument: **`lego`** nacheinander, Backing = die hochgeladene Datei.

**Ergebnis:** neuer Bibliothek-Eintrag („Replacement for …“ / „Accompaniment for …“) mit Spuren (`replacement` / `accompaniment`) und Mix.

Der Upload bleibt erreichbar: im Mixer als eigener Kanal **Original** (abspielen, herunterladen)
und im ZIP als `00 original.wav`. Beim Ersetzen ist der Kanal anfangs stumm (darin stecken die ersetzten Instrumente;
per Solo zum Vergleichen), beim Begleiten hörbar (die Aufnahme gehört zum Song).

---

## Mixer

**Wo:** Bibliothek → Mixer-Knopf am Song, oder `#/mixer/:songId`. Eine Spurenliste unter dem Song gibt es nicht mehr; alles Spur-Bezogene läuft über den Mixer. Im ⋮-Menü bleibt **Alle Spuren löschen**.

**Was es ist:** reine Wiedergabe-UI für fertige Spuren eines Songs:

- Waveform pro Spur  
- Lautsprecher-Icon → Klick klappt den Lautstärke-Regler aus  
- Mute (M) und Solo (S)  
- gemeinsamer Transport (Play/Pause, Scrub, Zeit), Spuren synchron  
- Herunterladen: **↓** je Spur, **ZIP ↓** für alle (mit Original), **Mix ↓** = der Mix so, wie er gerade klingt
  (Lautstärke, Mute und Solo). Den Mix rechnet der Server aus den gespeicherten WAVs; Spitzen über 0,95 werden wie
  beim Song-Mix abgesenkt, ein Original mit 44,1 kHz wird auf die 48 kHz der Spuren umgerechnet.

Die Wiedergabe lädt die gespeicherten WAV-Dateien. Der normale Player-Balken ist auf dieser Seite ausgeblendet.

### Neue Version einer Spur

**Wo:** Mixer → **✦** an einer Spur.

Schnellwahl-Knöpfe je Instrument (z. B. Schlagzeug: Dezenter, Mehr Body, Akustischer, Besen, Halftime …), fünf Regler
(Intensität, Body, Charakter, Spielweise, Raum; je −2…+2), Freitext und Anzahl (1–3 Versionen mit verschiedenen Seeds).
Knöpfe setzen die Regler sichtbar; wer danach einen Regler anders stellt, löst den Knopf. Die Vorschau zeigt die
Stichworte, die in die Caption gehen. Tabellen: [`shared/track-variation.ts`](../shared/track-variation.ts).

**Was passiert:** `lego` wie beim Ersetzen. Backing = alle *anderen* Spuren in ihrer hörbaren Version (beim Begleiten
dazu die Aufnahme). Caption = Spur-Prompt, Wünsche, Freitext, dann der bereinigte Song-Stil (`versionCaption`); ist der
Intensitäts-Regler gesetzt, fallen Energie-Wörter des Songs („energetic“, „calm“ …) weg. Läuft in der Warteschlange wie
das Herauslösen, der Song bleibt spielbar.

**Versionen:** Die alte Version bleibt erhalten. Gleiche Spuren bilden im Mixer eine Gruppe; mit mehreren Versionen lässt
sie sich aufklappen. Zugeklappt sieht man nur die hörbare Version („v2 · 3 Versionen“). Alle Versionen laufen synchron mit,
umschalten geht deshalb sofort, auch während der Wiedergabe. Eine neue Version wird hörbar, sobald sie fertig ist.
Mix ↓ und ZIP nehmen je Spur nur die hörbare Version, ältere lädt man einzeln (↓ in der Zeile). Nicht hörbare Versionen
lassen sich löschen (✕). Der Song-Mix in der Bibliothek bleibt unverändert.

---

## Technik kurz

| Begriff | Bedeutung |
|---|---|
| `extract` | Mix + Spurname → isolierte Spur (neu generiert) |
| `lego` | Backing + Spurname → neue Spur, die zum Backing passt (Backing steckt nicht im Output) |
| `complete` | isolierte Take → ganzer Mix drumherum (für Begleitung optional denkbar, aktuell nicht der Hauptweg) |

- Jobs laufen in der **gleichen Queue** wie Songs, nacheinander. Abbrechen stoppt die aktuelle Spur und verwirft den Rest.  
- Dateien: `<song-id>.<track>.wav` im Song-Ordner.  
- Tabelle `stems`: `id`, `song_id`, `track`, `kind` (auch `version`), `status`, Reihenfolge, Zeiten, `version`, `active` (je Spur genau eine hörbar), `recipe` (Wünsche + Caption). Song löschen löscht die Spuren. Dateien neuer Versionen: `<song-id>.v<n>.<spur>.wav`.  
- Engine: Multipart `POST /synth` mit `synth_model` = Base-Modell.  
- API u. a.: `GET /api/songs/:id/stems`, `…/stems.zip`, `GET /api/stems/:id/audio`, `DELETE /api/stems/:id`, `DELETE /api/songs/:id/stems`, `POST /api/songs/:id/stems` (extract), `POST /api/stems/upload` (replace/accompany), `GET /api/songs/:id/source` (Original), `GET /api/songs/:id/mix?gains=<spur-id>:<0…1>,…,source:<0…1>` (Mix als WAV; fehlende Kanäle sind stumm), `POST /api/stems/:id/versions` (neue Version: `axes`, `chips`, `text`, `count`), `PUT /api/stems/:id/active` (Version hörbar machen).

Plan, Experimente und Status der Umsetzung: [`newfeatures.md`](../newfeatures.md).
