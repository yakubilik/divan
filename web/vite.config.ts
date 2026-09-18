import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** The dev server runs on its own origin, so it has no pairing in the URL and
 *  reads one from /dev-host.json instead. That file used to live in public/,
 *  which `vite build` copies wholesale into the daemon's webui/ — so a build
 *  made on a machine that had one served a live device token to anyone who
 *  could reach the port. It sits outside public/ now and is handed out here,
 *  by a plugin that only ever runs under `vite`, never under `vite build`. */
function devHost(): Plugin {
  return {
    name: 'rac-dev-host',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-host.json', (_req, res) => {
        let body: string;
        try { body = readFileSync(new URL('./dev-host.json', import.meta.url), 'utf8'); }
        catch { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      });
    },
  };
}

// The daemon serves the built files itself, from
// daemon/remote_ai_chat/webui/. Relative base so it works whether the panel is
// opened at http://127.0.0.1:8790/ or through a Tailscale name.
export default defineConfig({
  plugins: [react(), devHost()],
  base: './',
  build: {
    outDir: '../daemon/remote_ai_chat/webui',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5177,
    strictPort: true,
  },
});
