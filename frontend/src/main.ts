// Einstieg und Composition Root der Oberfläche: erzeugt alle Bausteine und verbindet sie.
import type { Song } from "../../shared/api.ts";
import "./styles/style.css";
import { ApiClient } from "./core/api-client.ts";
import { byId, enableKeyboardButtons } from "./core/dom.ts";
import { Dropzone } from "./features/analyze/dropzone.ts";
import { GeneratorForm } from "./features/generator/generator-form.ts";
import { FolderBar } from "./features/library/folder-bar.ts";
import { LibraryHeader } from "./features/library/library-header.ts";
import { LibraryStore } from "./features/library/library-store.ts";
import { PlayedSongs } from "./features/library/played-songs.ts";
import { SongDrag } from "./features/library/song-drag.ts";
import { SongList } from "./features/library/song-list.ts";
import { AudioPlayer } from "./features/player/audio-player.ts";
import { LayoutSwitcher } from "./features/settings/layout-switcher.ts";
import { ServerControl } from "./features/settings/server-control.ts";
import { SettingsDialog } from "./features/settings/settings-dialog.ts";
import { UpdatePanel } from "./features/settings/update-panel.ts";
import { bindKeyboardShortcuts } from "./features/shortcuts/keyboard-shortcuts.ts";
import { HealthIndicator } from "./features/status/health-indicator.ts";
import { I18n } from "./i18n/i18n.ts";

const i18n = new I18n();
const { t } = i18n;
i18n.apply();
i18n.bindSelect(byId<HTMLSelectElement>("uiLang"));
enableKeyboardButtons();

const api = new ApiClient(() => i18n.lang);
const store = new LibraryStore(api);
const played = new PlayedSongs();
const drag = new SongDrag();

// Generator
const form = new GeneratorForm({ api, t, targetFolder: () => store.targetFolder, onQueued: () => void store.refresh() });
new Dropzone(api, t, (result) => form.applyAnalysis(result));

// Bibliothek + Player
const header = new LibraryHeader(store, i18n);
const folderBar = new FolderBar(store, drag, t);
// Player und Liste kennen sich gegenseitig: der Player meldet Zustandswechsel, die Liste zeigt sie an
let songList: SongList;
const player = new AudioPlayer(t, () => songList.render());
const playSong = (song: Song) => {
  if (played.mark(song.id)) songList.render();
  player.play(song).catch((e: Error) => alert(`${t("error")}: ${e.message}`));
};
songList = new SongList({ store, played, playback: player, drag, t, play: playSong, reuse: (song) => form.fill(song) });
bindKeyboardShortcuts({ form, playback: player, songs: () => store.songs, play: playSong });
store.onChange(() => {
  folderBar.refresh();
  songList.refresh();
  header.render();
});

// Einstellungen + Status
const health = new HealthIndicator(api, t);
const updates = new UpdatePanel(api, t);
new SettingsDialog(api, () => updates.reset(), () => void health.check());
new ServerControl(api, t, () => store.stopPolling(), () => void store.refresh());
new LayoutSwitcher();

i18n.onChange(() => {
  form.refreshTexts();
  songList.render();
  folderBar.render();
  header.render();
  player.refreshTexts();
  updates.reset();
  void health.check();
});

health.start();
void store.refresh();
