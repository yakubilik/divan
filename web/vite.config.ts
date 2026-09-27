import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function head(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}

/** Two things the build owes the daemon that serves it.
 *
 *  `public/dev-host.json` holds a real pairing token, and vite copies
 *  everything in `public/` into the build. The daemon serves that build as
 *  plain static files with no token of its own, so shipping it would hand the
 *  computer's own credentials to anyone who can reach the port. It is there for
 *  `npm run dev`, which serves `public/` directly and never runs this.
 *
 *  `build.json` is the note saying which commit this bundle came from. The
 *  bundle is not in git and the daemon is, so without it nothing on either side
 *  can tell whether the panel in the browser still matches the code behind it —
 *  and the answer is what the Admin screen exists to show. Written here rather
 *  than only in the updater so that a build by hand is placeable too. */
function stampBuild(): Plugin {
  // Read off the resolved config rather than the constant below, because the
  // daemon's self-update passes its own --outDir and builds to a sibling.
  let dir = outDir;
  return {
    name: 'stamp-build',
    apply: 'build',
    configResolved(config) { dir = config.build.outDir; },
    closeBundle() {
      rmSync(resolve(dir, 'dev-host.json'), { force: true });
      writeFileSync(
        resolve(dir, 'build.json'),
        JSON.stringify({ sha: head(), built_at: Date.now() / 1000 }, null, 1),
      );
    },
  };
}

const outDir = '../daemon/remote_ai_chat/webui';

// The daemon serves the built files itself, from
// daemon/remote_ai_chat/webui/. Relative base so it works whether the panel is
// opened at http://127.0.0.1:8790/ or through a Tailscale name.
export default defineConfig({
  plugins: [react(), stampBuild()],
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5177,
    strictPort: true,
  },
});
