import { defineConfig } from "vite";

// Im Entwicklungsmodus (npm run dev) leitet Vite /api an den laufenden Backend-Server weiter.
// Anderer Port (z. B. weil 8765 belegt ist): PORT=8766 npm run dev
const BACKEND_PORT = process.env.PORT ?? "8765";
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  server: { port: 5173, proxy: { "/api": { target: BACKEND, headers: { host: `127.0.0.1:${BACKEND_PORT}` } } } },
});
