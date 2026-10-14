// Einstieg und Composition Root der Oberfläche: erzeugt alle Bausteine und verbindet sie.
import type { Song } from "../../shared/api.ts";
import "./styles/style.css";
import { ApiClient } from "./core/api-client.ts";
import { byId, enableKeyboardButtons } from "./core/dom.ts";
import { formatDuration } from "./core/format.ts";
import { Router } from "./core/router.ts";
import { Dropzone } from "./features/analyze/dropzone.ts";
import { GeneratorForm } from "./features/generator/generator-form.ts";
import { FolderBar } from "./features/library/folder-bar.ts";
import { LibraryHeader } from "./features/library/library-header.ts";
import { LibraryStore } from "./features/library/library-store.ts";
import { PlayedSongs } from "./features/library/played-songs.ts";
import { SongDrag } from "./features/library/song-drag.ts";
import { SongList } from "./features/library/song-list.ts";
import { AudioPlayer, type PlayOptions } from "./features/player/audio-player.ts";
import { ServerControl } from "./features/settings/server-control.ts";
import { SettingsDialog } from "./features/settings/settings-dialog.ts";
import { UpdatePanel } from "./features/settings/update-panel.ts";
import { bindKeyboardShortcuts } from "./features/shortcuts/keyboard-shortcuts.ts";
import { HealthIndicator } from "./features/status/health-indicator.ts";
import { Notifier } from "./features/status/notifier.ts";
import { I18n } from "./i18n/i18n.ts";

const i18n = new I18n();
const { t } = i18n;
i18n.apply();
i18n.bindSelect(byId<HTMLSelectElement>("uiLang"));
enableKeyboardButtons();

const api = new ApiClient(() => i18n.lang);
const router = new Router();
const store = new LibraryStore(api);
const played = new PlayedSongs();
const drag = new SongDrag();

// Generator
const form = new GeneratorForm({
  api, t, targetFolder: () => store.targetFolder, onQueued: () => void store.refresh(), preferredTerms: () => store.favoriteTerms,
});
new Dropzone(api, t, (result) => form.applyAnalysis(result));

// Bibliothek + Player
const header = new LibraryHeader(store, i18n);
const folderBar = new FolderBar(store, drag, t);
// Player und Liste kennen sich gegenseitig: der Player meldet Zustandswechsel, die Liste zeigt sie an
let songList: SongList;
const playSong = (song: Song, options?: PlayOptions) => {
  if (played.mark(song.id)) songList.render();
  player.play(song, options).catch((e: Error) => alert(`${t("error")}: ${e.message}`));
};
const player = new AudioPlayer({
  t,
  onStateChange: () => songList.render(),
  // Versionen desselben Prompts in der aktuellen Ansicht, in Buchstabenfolge
  versionsOf: (song) => store.songs.filter((s) => s.group_id === song.group_id && s.status === "done" && s.url)
    .sort((a, b) => a.letter.localeCompare(b.letter)),
  onVersionPick: (song) => playSong(song, { keepPosition: true }),
});
songList = new SongList({
  store, played, playback: player, drag, t, play: playSong, // Übernehmen und Kreuzen füllen das Formular: dafür auf die Seite „Erzeugen“ wechseln
  reuse: (song) => { form.fill(song); router.go("generate"); },
  cross: (a, b) => { form.cross(a, b); router.go("generate"); },
});
bindKeyboardShortcuts({
  form, playback: player, songs: () => store.songs, play: playSong, nextVersion: () => player.nextVersion(),
  formVisible: () => router.current === "generate",
});
// Laufende und wartende Songs als Zahl am Reiter „Bibliothek“; Meldung, wenn einer fertig ist
const libBadge = byId("libBadge");
const notifier = new Notifier(api, t, () => router.go("library"));
store.onChange(() => {
  notifier.observe(store.runningIds);
  libBadge.hidden = store.activeCount === 0;
  libBadge.textContent = String(store.activeCount);
  const last = Math.max(0, ...Object.values(store.estimates));
  libBadge.title = last ? t("eta_all", formatDuration(last)) : "";
  player.renderVersions();
  folderBar.refresh();
  songList.refresh();
  header.render();
});

// Einstellungen + Status
const health = new HealthIndicator(api, t);
const updates = new UpdatePanel(api, t);
new SettingsDialog(api, () => updates.reset(), () => void health.check());
new ServerControl(api, t, () => store.stopPolling(), () => void store.refresh());

i18n.onChange(() => {
  form.refreshTexts();
  songList.render();
  folderBar.render();
  header.render();
  player.refreshTexts();
  notifier.render();
  updates.reset();
  void health.check();
});

health.start();
void store.refresh();
