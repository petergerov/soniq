// Seiten über den Hash: #/ = Erzeugen, #/replace = Ersetzen/Begleiten,
// #/library = Bibliothek, #/mixer/:songId = Mixer.
// Alle Bereiche bleiben im Dokument (der Player spielt beim Wechsel weiter); sichtbar ist nur der aktuelle.

export type Route = "generate" | "replace" | "library" | "mixer";

export interface RouteState {
  route: Route;
  /** Bei route "mixer": Song-ID */
  songId: string | null;
}

function parseHash(hash: string): RouteState {
  const m = hash.match(/^#\/mixer\/([^/?#]+)/);
  if (m) return { route: "mixer", songId: decodeURIComponent(m[1]!) };
  if (hash.startsWith("#/replace")) return { route: "replace", songId: null };
  if (hash.startsWith("#/library")) return { route: "library", songId: null };
  return { route: "generate", songId: null };
}

function hashFor(route: Route, songId?: string | null): string {
  if (route === "mixer" && songId) return `#/mixer/${encodeURIComponent(songId)}`;
  if (route === "replace") return "#/replace";
  if (route === "library") return "#/library";
  return "#/";
}

export class Router {
  private readonly listeners: ((state: RouteState) => void)[] = [];
  private state: RouteState = { route: "generate", songId: null };

  constructor() {
    window.addEventListener("hashchange", () => this.apply());
    this.apply();
  }

  get current(): Route {
    return this.state.route;
  }

  get songId(): string | null {
    return this.state.songId;
  }

  go(route: Route, songId?: string | null): void {
    const next = hashFor(route, songId);
    if (location.hash !== next) location.hash = next;
    else this.apply();
  }

  onChange(listener: (state: RouteState) => void): void {
    this.listeners.push(listener);
  }

  private apply(): void {
    const next = parseHash(location.hash);
    const changed = next.route !== this.state.route || next.songId !== this.state.songId;
    this.state = next;
    document.querySelectorAll<HTMLElement>("[data-route]").forEach((el) => {
      el.hidden = el.dataset.route !== next.route;
    });
    document.querySelectorAll<HTMLElement>("[data-route-link]").forEach((a) => {
      // Mixer ist kein Reiter; Bibliothek bleibt der aktive Reiter, wenn man im Mixer ist
      const link = a.dataset.routeLink;
      const active = link === next.route || (next.route === "mixer" && link === "library");
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.body.classList.toggle("in-mixer", next.route === "mixer");
    if (changed) {
      window.scrollTo({ top: 0 });
      this.listeners.forEach((l) => l(next));
    }
  }
}
