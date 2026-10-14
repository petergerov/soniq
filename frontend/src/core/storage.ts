// localStorage ohne Ausnahmen: im privaten Modus oder bei blockierten Website-Daten wirft der Zugriff.

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // nur Komfort
    }
  },
  getJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  },
};
