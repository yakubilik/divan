/** The diagram page (`src/mermaid-page.ts`) against a real browser engine:
 *  the bundled mermaid draws a flowchart, a sequence, a pie and an
 *  xychart-beta bar chart in both themes and says each one's size; a text that
 *  is not a diagram says `error` and leaves no drawing behind (no red "syntax
 *  error" picture); a chart wider than the page is shrunk to it.
 *
 *  Needs a Chromium: Playwright's headless shell under ~/Library/Caches/
 *  ms-playwright, or one named in CHROME. Not in `npm test` for that reason —
 *  `test-diagram.cjs` holds the rest without a browser.
 *
 *  Run: node scripts/diagram-page-live.cjs [--shots <dir>]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('sucrase');

require.extensions['.ts'] = (mod, filename) => mod._compile(transform(fs.readFileSync(filename, 'utf8'),
  { transforms: ['typescript', 'imports'], filePath: filename }).code, filename);
const { mermaidPage } = require(path.join(__dirname, '..', 'src', 'mermaid-page.ts'));
const { dark, light } = require(path.join(__dirname, '..', 'src', 'tokens.ts'));

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) {
    for (const sub of fs.readdirSync(path.join(base, d))) {
      const bin = path.join(base, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  }
  throw new Error('no Chromium found: set CHROME');
}

const CASES = {
  flowchart: 'flowchart TD\n  A[Phone] -->|tailnet| B(Daemon)\n  B --> C{Agent}\n  C -->|yes| D[Answer]\n  C -->|no| E[Retry]\n  click A href "https://example.com"',
  sequence: 'sequenceDiagram\n  Phone->>Daemon: chat.send\n  Daemon->>Agent: prompt\n  Agent-->>Daemon: answer\n  Daemon-->>Phone: event',
  pie: 'pie title Where the time went\n  "Build" : 42\n  "Tests" : 30\n  "Review" : 18',
  xychart: 'xychart-beta\n  title "Tickets per day"\n  x-axis [Mon, Tue, Wed, Thu, Fri]\n  y-axis "Tickets" 0 --> 12\n  bar [5, 8, 3, 11, 7]',
  invalid: 'flowchart TD\n  A -->> -- B[[',
};

const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const bin = chrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-live-'));
const WIDTH = 340;   // the bubble's inner width on an iPhone-size screen
const failures = [];
try {
  for (const [name, code] of Object.entries(CASES)) {
    for (const scheme of ['dark', 'light']) {
      const bg = (scheme === 'dark' ? dark : light).card;
      // The page's one message lands in the title, where --dump-dom shows it.
      const html = mermaidPage({ code, dark: scheme === 'dark', background: bg })
        .replace('<div id="d"></div>', '<div id="d"></div><script>window.ReactNativeWebView={postMessage:function(m){document.title=m;}};</script>');
      const file = path.join(tmp, `${name}-${scheme}.html`);
      fs.writeFileSync(file, html);
      const args = ['--headless', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(tmp, 'profile')}`,
                    '--virtual-time-budget=10000', `--window-size=${WIDTH},700`];
      let msg = null;
      let dom = '';
      // Virtual time in the headless shell now and then ends before the
      // page's last frame; a page that has said nothing is asked again.
      for (let i = 0; i < 3 && !msg; i++) {
        dom = execFileSync(bin, [...args, '--dump-dom', `file://${file}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
        const t = dom.match(/<title>([^<]*)<\/title>/);
        msg = t ? JSON.parse(t[1].replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')) : null;
      }
      const body = dom.slice(dom.indexOf('<div id="d">'), dom.indexOf('</div>', dom.indexOf('<div id="d">')) + 6);
      let ok;
      if (name === 'invalid') {
        ok = msg && msg.t === 'error' && !/<svg/.test(body) && !/Syntax error/i.test(dom.replace(/<script>[\s\S]*?<\/script>/g, ''));
      } else {
        ok = msg && msg.t === 'size' && msg.w > 0 && msg.h > 0 && /<svg/.test(body) && !/href="https?:/.test(body);
        if (ok && (name === 'pie' || name === 'xychart')) ok = msg.w <= WIDTH;
      }
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${scheme}): ${JSON.stringify(msg).slice(0, 100)}`);
      if (!ok) failures.push(`${name}-${scheme}`);
      if (shots && name !== 'invalid') {
        fs.mkdirSync(shots, { recursive: true });
        execFileSync(bin, [...args, `--screenshot=${path.join(shots, `page-${name}-${scheme}.png`)}`, `file://${file}`], { stdio: 'ignore' });
      }
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\nall diagram pages drew as they should');
process.exit(failures.length ? 1 : 0);
