/** A picture of the phone's Dashboard, without a phone.
 *
 *     node scripts/shot-dashboard.cjs <out.png> [dark|light]
 *
 *  The screen is stood up through `render-divan.cjs` with the real words, its
 *  React Native styles are written out as CSS on plain boxes, and a browser
 *  photographs it at 390 pt. It is the layout and the type, not a simulator:
 *  icons are not drawn. Not a check, and in no npm script. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('./render-divan.cjs');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'dashboard-phone.png'));
const scheme = process.argv[3] === 'light' ? 'light' : 'dark';
const h = R.React.createElement;
const C = require(path.join(root, 'src/compose.ts'));
const K = require(path.join(root, 'src/tokens.ts'));
const Dashboard = require(path.join(root, 'app/dashboard.tsx')).default;

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const project = (name, o = {}) => ({ id: `${name}-id`, name, slug: name.toLowerCase(), summary: o.summary || '',
  repos: o.repos || [], sort: 0, archived: false, created_at: 0, updated_at: NOW - 60,
  branches: [{ id: 'e', kind: 'engineering', name: 'Engineering', summary: '', summary_at: null, cards: {}, open: 0 }],
  counts: o.counts || {}, running: o.running || 0, waiting: o.waiting || 0, summary_line: '' });
const card = (id, o) => ({ id, project_id: o.project, branch_id: 'e', branch: 'engineering', column: 'in_progress',
  position: 0, title: o.title, summary: '', executor: 'coding_agent', machine: null, repo: null,
  ustabasi_id: o.ticket ?? null, agent_status: o.status, agent_status_at: NOW - (o.ago || 600),
  agent_detail: o.detail || '', created_at: 0, updated_at: 0, moved_at: NOW - 600 });
const agent = (id, o) => ({ card_id: id, project_id: o.project, project: o.name, branch: 'engineering', title: o.title,
  executor: 'coding_agent', machine: 'studio', status: 'running', detail: '', since: NOW - o.since, ustabasi_id: null });
const snap = { machine: 'studio', os: 'Darwin', at: NOW, queue: {},
  quota: { enabled: true, accounts: 2, blocked: 0, spent: false, left: 0.64, resets_at: NOW + 4 * 3600, unknown: false },
  projects: [project('Quire', { repos: ['/r/quire'], running: 2, waiting: 1 }), project('Hush', { repos: ['/r/hush'], running: 1 }),
             project('Pebble', { repos: ['/r/pebble'], summary: 'Search for a reading list' }),
             project('Walk', { repos: ['/r/walk'] })],
  cards: [card('k2', { project: 'Quire-id', status: 'asking', ticket: 42, title: 'Stripe keys', ago: 720,
                       detail: 'The test keys work. Use the live ones now, or wait for the review?' }),
          card('k3', { project: 'Quire-id', status: 'running', title: 'Retry policy' }),
          card('k4', { project: 'Quire-id', status: 'running', title: 'Webhook replay' }),
          card('h3', { project: 'Hush-id', status: 'running', title: 'Paywall copy variants' })],
  agents: [agent('k3', { project: 'Quire-id', name: 'Quire', title: 'Retry policy', since: 840 }),
           agent('k4', { project: 'Quire-id', name: 'Quire', title: 'Webhook replay', since: 2460 }),
           agent('h3', { project: 'Hush-id', name: 'Hush', title: 'Paywall copy variants', since: 3700 })],
  activity: { '/r/quire': { at: NOW - 840, week: 4, today: 1 }, '/r/hush': { at: NOW - 3600, week: 2, today: 0 },
              '/r/pebble': { at: NOW - 3 * 3600, week: 1, today: 0 }, '/r/walk': { at: NOW - 35 * DAY, week: 0, today: 0 } } };

R.words.real();
R.store.set({ hosts: [{ id: 'h1', name: 'studio' }], divan: { h1: { snapshot: snap, at: NOW, reachable: true, error: null, old: false } },
  host: { id: 'h1' }, conn: 'online', loadDivan() {}, ustabasi: { available: true, tickets: [] }, ustabasiOld: false, loadUstabasi() {},
  catalog: { claude: { models: [{ id: 'opus', label: 'Opus 5', hint: '' }], efforts: ['high'], perm_modes: ['default'] } },
  defaults: { provider: 'claude', model: 'opus', effort: 'high', perm_mode: 'default', cwd: null, byProvider: {} },
  accounts: [{ id: 'default-claude', provider: 'claude', label: 'own', logged_in: true, is_default: true, detail: '' }],
  accountsLoaded: true, loadAccounts: async () => {}, limits: {}, projects: [], listAgents: async () => [],
  compose: C.NO_DRAFT, setCompose() {} });
const markup = R.render(scheme, h(Dashboard));

const UNITLESS = new Set(['fontWeight', 'opacity', 'flex', 'flexGrow', 'flexShrink', 'zIndex', 'aspectRatio']);
const css = (st) => {
  const out = ['display:flex', 'flex-direction:column', 'box-sizing:border-box', 'min-width:0', 'position:relative'];
  const px = (v) => (typeof v === 'number' ? `${v}px` : v);
  for (const [k, v] of Object.entries(st)) {
    if (v == null || typeof v === 'object') continue;
    if (k === 'paddingHorizontal') { out.push(`padding-left:${px(v)}`, `padding-right:${px(v)}`); continue; }
    if (k === 'paddingVertical') { out.push(`padding-top:${px(v)}`, `padding-bottom:${px(v)}`); continue; }
    if (k === 'marginHorizontal') { out.push(`margin-left:${px(v)}`, `margin-right:${px(v)}`); continue; }
    if (k === 'marginVertical') { out.push(`margin-top:${px(v)}`, `margin-bottom:${px(v)}`); continue; }
    if (/^border(Top|Bottom|Left|Right)?Width$/.test(k)) {
      const side = k.replace(/^border|Width$/g, '').toLowerCase();
      out.push(`border${side ? `-${side}` : ''}-width:${px(v)}`, `border${side ? `-${side}` : ''}-style:${st.borderStyle || 'solid'}`);
      continue;
    }
    if (k === 'fontFamily') {
      const w = /SemiBold/.test(v) ? 600 : /Medium/.test(v) ? 500 : 400;
      out.push(`font-family:${/Mono/.test(v) ? '"Geist Mono"' : '"Geist"'}`, `font-weight:${w}`);
      continue;
    }
    const name = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    out.push(`${name}:${UNITLESS.has(k) ? v : px(v)}`);
  }
  return out.join(';');
};
const html = markup
  .replace(/<(div|span) data-rn="([^"]+)" data-style="([^"]*)"([^>]*)>/g, (m, tag, kind, style, rest) => {
    const st = JSON.parse(style.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'"));
    if (kind === 'Svg' || kind === 'Path') return `<${tag} style="display:none">`;
    const ph = (rest.match(/data-placeholder="([^"]*)"/) || [])[1];
    const extra = kind === 'Text' ? 'display:block;' : kind === 'TextInput' ? 'display:block;' : '';
    return `<${tag} style="${extra}${css(st).replace(kind === 'Text' || kind === 'TextInput' ? /display:flex;flex-direction:column;/ : /^$/, '')}">${kind === 'TextInput' && ph ? `<span style="color:${K.tokensFor(scheme).ink3}">${ph}</span>` : ''}`;
  });
const t = K.tokensFor(scheme);
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=390">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>body{margin:0;width:390px;background:${t.bg};color:${t.ink};font-family:Geist,sans-serif;font-size:14px}</style></head>
<body>${html}</body></html>`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
fs.writeFileSync(path.join(dir, 'page.html'), page);
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].filter(Boolean).find((p) => fs.existsSync(p));
// The browser can linger after it has written the file; the picture is what counts.
try { execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(dir, 'p')}`,
  '--window-size=390,1500', '--force-device-scale-factor=2', '--virtual-time-budget=4000',
  `--screenshot=${out}`, `file://${path.join(dir, 'page.html')}`], { stdio: 'ignore', timeout: 30000 }); } catch { /* see above */ }
console.log(out);
process.exit(0);
