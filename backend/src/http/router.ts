// Kleiner Router: Methode + Pfadmuster (z. B. /api/songs/:id) -> Handler.
import type { RequestContext } from "./request.ts";
import type { HttpResponse } from "./responses.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** Rückgabe: JSON-Daten oder eine HttpResponse (Datei, ZIP …). */
export type Handler = (ctx: RequestContext) => unknown | HttpResponse | Promise<unknown | HttpResponse>;

interface Route {
  method: HttpMethod;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export class Router {
  private readonly routes: Route[] = [];

  get(path: string, handler: Handler): this { return this.add("GET", path, handler); }
  post(path: string, handler: Handler): this { return this.add("POST", path, handler); }
  put(path: string, handler: Handler): this { return this.add("PUT", path, handler); }
  patch(path: string, handler: Handler): this { return this.add("PATCH", path, handler); }
  delete(path: string, handler: Handler): this { return this.add("DELETE", path, handler); }

  /** Treffer, "method" (Pfad passt, Methode nicht) oder undefined. */
  match(method: string, pathname: string): RouteMatch | "method" | undefined {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
      return { handler: route.handler, params };
    }
    return pathMatched ? "method" : undefined;
  }

  private add(method: HttpMethod, path: string, handler: Handler): this {
    this.routes.push({ method, ...compile(path), handler });
    return this;
  }
}
