// Zwei Seiten über den Hash der Adresse: #/ = Erzeugen, #/library = Bibliothek.
// Beide Bereiche bleiben im Dokument (der Player spielt beim Wechsel weiter); sichtbar ist nur der aktuelle.

export type Route = "generate" | "library";

const HASHES: Record<Route, string> = { generate: "#/", library: "#/library" };

export class Router {
  private readonly listeners: ((route: Route) => void)[] = [];
  private route: Route = "generate";

  constructor() {
    window.addEventListener("hashchange", () => this.apply());
    this.apply();
  }

  get current(): Route {
    return this.route;
  }

  go(route: Route): void {
    if (location.hash !== HASHES[route]) location.hash = HASHES[route];
    else this.apply();
  }

  onChange(listener: (route: Route) => void): void {
    this.listeners.push(listener);
  }

  private apply(): void {
    const route: Route = location.hash.startsWith("#/library") ? "library" : "generate";
    const changed = route !== this.route;
    this.route = route;
    document.querySelectorAll<HTMLElement>("[data-route]").forEach((el) => { el.hidden = el.dataset.route !== route; });
    document.querySelectorAll<HTMLElement>("[data-route-link]").forEach((a) => {
      if (a.dataset.routeLink === route) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (changed) {
      window.scrollTo({ top: 0 });
      this.listeners.forEach((l) => l(route));
    }
  }
}
