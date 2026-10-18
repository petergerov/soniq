# Spuren (Stems)

Überblick über die Spur-Funktionen in SONIQ: was man in der Oberfläche macht, und was im Hintergrund passiert.

Alle drei Erzeugungs-Funktionen brauchen das **Spuren-Modell** `acestep-v15-base` (~2,5 GB). Das normale Song-Modell (SFT/Turbo) kann `extract` und `lego` nicht. Ohne die Datei sind die Features ausgegraut, mit Hinweis, wie man es bekommt: Installer-Frage bzw. `install --stems`
(Windows `.\install.ps1 -Stems`, Linux `./arch_linux.sh --stems`); in der Mac-App **Einstellungen › Spuren-Modell laden**
oder das Häkchen in der ersten Einrichtung. Danach sind die Funktionen ohne Neuladen der Seite frei.

Optional gibt es das **XL-Spuren-Modell** `acestep-v15-xl-base` (~5,3 GB, 4 statt 2 Mrd. Parameter, rechnet etwa doppelt
so lange): `install --xl-stems` (Windows `-XlStems`) bzw. in der Mac-App **Einstellungen › XL-Spuren-Modell laden**. Unter
**Einstellungen › Spuren-Modell** wählt man Standard oder XL (`Settings.stem_model`, `STEM_MODELS` in
`domain/music-engine.ts`). Vorgabe ist Standard; fehlt die Datei des gewählten Modells, aber das andere ist da, rechnen die
Spuren mit dem anderen.

**Sampling der Spur-Aufgaben:** shift 3.0, CFG 7.0, 50 Schritte, wie die Referenz-Implementierung von ACE-Step 1.5
(`STEM_SHIFT`, `STEM_GUIDANCE` in `domain/music-engine.ts`). Vorher liefen die Spuren mit shift 1.0 und CFG 1.0
(extract) bzw. 5.0 (lego), wie im Beispiel von acestep.cpp; damit setzte das Modell die Spur-Anweisung kaum durch:
`extract drums` gab mit XL den ganzen Song zurück (Wellenform-Korrelation 0,993), mit Standard die Gitarre, und `lego`
auf Stille ergab einen Mix (Drums mit Flöten). Mit den Referenz-Werten lösten beide Modelle aus einem Funk-Song echte
Drums heraus; die vom Standard-Modell klangen sauberer, daher bleibt Standard die Vorgabe.

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

**Wo:** Bibliothek → bei einem **Stereo-Mix** (Erzeugung „Ganzer Song“) ohne Spuren im ⋮-Menü **Stem Separation** öffnen → Verfahren wählen und herauslösen. Sind die Spuren fertig, verschwindet der Eintrag und der Mixer-Knopf erscheint.  
Nicht bei Spur-für-Spur, Replace oder Begleitung — die haben bereits Einzelspuren.

**Verfahren** (Vorauswahl: das erste verfügbare):

| Wahl | Modell | Spuren | Dauer (Mac, 32 GB, 4 Threads) |
|---|---|---|---|
| Demucs · 4 Stems | `htdemucs_ft`: vier nachtrainierte Modelle (4 × 84 MB), beste Qualität | drums, bass, vocals, other | ~3,2 × Songlänge (90-s-Song: 288 s) |
| Demucs · 6 Stems | `htdemucs_6s` (55 MB; Mac: Core ML 340 MB) | drums, bass, guitar, keyboard (Klavier), vocals, other | demucs.cpp ~0,9 × Songlänge (90 s: 78 s); Mac mit Core ML: GPU ~0,1 ×, CPU ~0,15 × |
| ACE-Step | Spuren-Modell, `extract` je Spur | 2 / 4 / 6 nach festem Set | je Spur etwa so lange wie der Song |

**Demucs** ist ein eigenes Trennmodell (Meta, über [demucs.cpp](https://github.com/sevagh/demucs.cpp), MIT): es teilt den
vorhandenen Mix auf, alle Spuren in einem Durchgang, auf der CPU (Mac: Accelerate; Linux: OpenMP). Die Spuren
ergeben zusammen wieder den Song (Rest bei „Amber Echoes“, htdemucs_6s: −23,5 dB). Die Gewichte sind die
Originale von Meta in halber Genauigkeit (htdemucs_6s 55 MB = offizieller Checkpoint `5c90dfd2-34c22ccb.th`); ein
größeres 6-Spur-Demucs gibt es nicht. Das Klavier von htdemucs_6s ist laut den Entwicklern noch unsauber.
**Core ML (Mac, htdemucs_6s):** `soniq-demucs` (`macos/demucs-coreml.swift`) rechnet htdemucs_6s als Core-ML-Modell
mit der STFT im Modell (`demucs_6s_f32.mlpackage`, 32 Bit, aus der App Gig Songbook), Segmente wie `demucs.apply_model`
(7,8 s, 25 % Überlappung, Dreiecks-Gewichte, Mix normiert). Einstellung `demucs_device`: GPU (Vorgabe) oder CPU.
Gemessen an „Slow Tide“ (90 s, M2 Pro) gegen die echten Spuren (Spur-für-Spur-Song, SI-SDR): demucs.cpp −3,2 dB in 57 s,
Core ML CPU −2,9 dB in 11 s, Core ML GPU −4,2 dB in 6 s. Die GPU rechnet also ungenauer (Bass −0,3 statt 2,4 dB), die CPU
so genau wie demucs.cpp (Übereinstimmung 10 dB, Drums 16,5 dB). Scheitert Core ML, rechnet demucs.cpp. htdemucs_ft
(4 Stems) läuft weiter mit demucs.cpp: das 4-Spur-Core-ML-Modell braucht die STFT außerhalb und ist kein ft-Modell.

Ablauf (`infrastructure/demucs-separator.ts`): Song auf 44,1 kHz (das liest demucs.cpp) als Float-WAV in `data/tmp`,
`demucs_mt.cpp.main` bzw. `demucs_ft_mt.cpp.main` mit 1–4 Threads je nach Arbeitsspeicher (je Thread ~1,7 GB), Spuren
zurück auf 48 kHz. Nur für WAV-Songs (ein MP3-Decoder fehlt dem Server bewusst; MP3-Songs → ACE-Step). Die Restspur
`other` kennt ACE-Step nicht: im Mixer ohne ✦ (keine neue Version).

**ACE-Step:** Keine Voranalyse und keine manuelle Spurwahl — feste Sets (z. B. 4 = drums/bass/guitar/vocals). Für jede Spur ruft SONIQ ACE-Step **`extract`** auf dem **Synth-Server (GPU: Metal / CUDA / Vulkan)** auf, ohne Caption (sie lenkte auf das, was sie nennt). Die Spur wird **neu generiert** und folgt dem Song — das ist **kein** verlustfreier Stem-Split.

**Ergebnis:** Spuren am gleichen Song (`kind: extracted`; das Verfahren steht intern im Feld `recipe`); abspielen, herunterladen und ZIP im Mixer.

**Installation:** `install.command` und `arch_linux.sh` bauen demucs.cpp (feste Revision `DEMUCS_REV` in
`scripts/common.sh`) nach `engine/demucs.cpp/build` und laden die Gewichte mit SHA-256-Prüfung nach `models/demucs`.
Die fertige Mac-App und das Debian-Paket bringen demucs.cpp portabel gebaut mit (`demucs_build_portable`: ohne
`-march=native`; Mac `-mcpu=apple-m1` mit Accelerate, Linux OpenMP, amd64 zusätzlich ein AVX2/FMA-Build in
`bin/demucs/avx2`, den das Backend nach `/proc/cpuinfo` wählt). Die Gewichte lädt dort Zahnrad › Demucs
(`POST /api/setup/demucs`, nach `<Modelle>/demucs`, ohne Neustart des Modellservers). Windows liefert Demucs noch
nicht mit; dort fehlen die Demucs-Knöpfe. Auf dem Mac baut `install.command` zusätzlich `soniq-demucs` (swiftc, neben
die Programme von demucs.cpp) und lädt das Core-ML-Modell (`DEMUCS_COREML_FILES`, ZIP mit SHA-256, entpackt nach
`models/demucs`); die Mac-App bringt `soniq-demucs` mit und lädt das Modell unter Zahnrad › Demucs dazu.

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

**Seed und Nachbauen:** Jede Version bekommt beim Einreihen ihren Seed fest zugeteilt (zufällig oder aus dem Seed-Feld im
✦-Feld, bei mehreren Versionen hochgezählt) und speichert ihn im Rezept; der Tooltip der Beschreibung zeigt Caption und
Seed. ↻ an einer Version übernimmt Wünsche und Seed ins ✦-Feld. Gleich klingt die neue Version nur, wenn auch die übrigen
Spuren (das Backing) und das Spuren-Modell dieselben sind. Versionen von vor dieser Änderung haben keinen Seed und kein ↻.

---

## Technik kurz

| Begriff | Bedeutung |
|---|---|
| `extract` | Mix + Spurname → isolierte Spur (neu generiert) |
| `lego` | Backing + Spurname → neue Spur, die zum Backing passt (Backing steckt nicht im Output) |
| `complete` | isolierte Take → ganzer Mix drumherum (für Begleitung optional denkbar, aktuell nicht der Hauptweg) |

- Jobs laufen in der **gleichen Queue** wie Songs, nacheinander. Abbrechen stoppt die aktuelle Spur und verwirft den Rest.  
- Dateien: `<song-id>.<track>.wav` im Song-Ordner.  
- Tabelle `stems`: `id`, `song_id`, `track`, `kind` (auch `version`), `status`, Reihenfolge, Zeiten, `version`, `active` (je Spur genau eine hörbar), `recipe` (Wünsche, Caption, Seed). Song löschen löscht die Spuren. Dateien neuer Versionen: `<song-id>.v<n>.<spur>.wav`.  
- Engine: Multipart `POST /synth` mit `synth_model` = Base-Modell.  
- API u. a.: `GET /api/songs/:id/stems`, `…/stems.zip`, `GET /api/stems/:id/audio`, `DELETE /api/stems/:id`, `DELETE /api/songs/:id/stems`, `POST /api/songs/:id/stems` (Stem Separation: `{ separator: "demucs_ft" | "demucs_6s" }` oder `{ separator: "ace", tracks }`), `POST /api/stems/upload` (replace/accompany), `GET /api/songs/:id/source` (Original), `GET /api/songs/:id/mix?gains=<spur-id>:<0…1>,…,source:<0…1>` (Mix als WAV; fehlende Kanäle sind stumm), `POST /api/stems/:id/versions` (neue Version: `axes`, `chips`, `text`, `count`, optional `seed`), `PUT /api/stems/:id/active` (Version hörbar machen).

Plan, Experimente und Status der Umsetzung: [`newfeatures.md`](../newfeatures.md).
