#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.test-build', 'approval');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(join(web, 'node_modules/.bin/tsc'), ['src/components/Timeline.tsx', 'src/vite-env.d.ts', '--outDir', out, '--rootDir', '.', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--jsx', 'react-jsx', '--strict', '--skipLibCheck'], { cwd: web, stdio: 'inherit' });
for (const f of readdirSync(out, { recursive: true, withFileTypes: true })) {
  if (!f.name.endsWith('.js')) continue;
  const path = join(f.parentPath ?? f.path, f.name);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, (m, a, spec, z) => spec.endsWith('.js') ? m : `${a}${spec}.js${z}`));
}
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Timeline } = await import(pathToFileURL(join(out, 'src/components/Timeline.js')));
const root = createRoot(document.getElementById('root'));
let id = 0;
const sent = [];
let fail = false;
async function show(input) {
  id++;
  await act(async () => root.render(h(Timeline, { hostKey: 'test', items: [{ id: String(id), kind: 'approval', ts: 1, requestId: `r${id}`, tool: 'Codex request', input, preview: '', danger: false, decision: null }], onRespond: async (...args) => { sent.push(args); if (fail) throw new Error('offline'); } })));
}
const button = (text) => [...document.querySelectorAll('button')].find((el) => el.textContent.includes(text));
const click = async (text) => { const el = button(text); assert.ok(el, text); await act(async () => el.click()); };
async function type(label, value) {
  const el = document.querySelector(`input[aria-label="${label}"]`);
  assert.ok(el, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
await show({ kind: 'mcp_elicitation', mode: 'form', requestedSchema: { type: 'object', required: ['token', 'count', 'enabled'], properties: { token: { type: 'string', format: 'password' }, count: { type: 'integer' }, enabled: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } } } });
assert.equal(button('Submit answers').disabled, true);
assert.equal(document.querySelector('input[aria-label="token"]').type, 'password');
await type('token', 'secret-for-test');
await type('count', '3');
await click('No');
await click('○ a');
fail = true;
await click('Submit answers');
assert.match(document.querySelector('[role="alert"]').textContent, /try again/);
assert.equal(document.querySelector('input[aria-label="token"]').value, 'secret-for-test');
fail = false;
await click('Submit answers');
assert.deepEqual(sent.at(-1), ['r1', 'allow', { content: { token: 'secret-for-test', count: 3, enabled: false, tags: ['a'] } }]);
assert.equal(document.querySelector('input[aria-label="token"]').value, '');
assert.equal(localStorage.length, 0);
await show({ kind: 'user_input', questions: [{ id: 'choice', question: 'Choose', options: [{ label: 'One' }], isOther: false }, { id: 'note', question: 'Note', isSecret: true }] });
assert.equal(document.querySelector('input[aria-label="Choose"]'), null);
await click('One');
await type('Note', 'Private');
await click('Submit answers');
assert.deepEqual(sent.at(-1), ['r2', 'allow', { answers: { choice: { answers: ['One'] }, note: { answers: ['Private'] } } }]);
await show({ kind: 'mcp_elicitation', mode: 'url', url: 'https://example.com/authorize' });
assert.equal(document.querySelector('a').rel, 'noopener noreferrer');
await click('I have completed');
assert.deepEqual(sent.at(-1), ['r3', 'allow', { content: null }]);
await show({ kind: 'mcp_elicitation', mode: 'url', url: 'javascript:alert(1)' });
assert.equal(document.querySelector('a'), null);
assert.equal(button('I have completed').disabled, true);
await click('Deny');
assert.deepEqual(sent.at(-1), ['r4', 'deny', undefined]);
await show({ kind: 'mcp_elicitation', mode: 'form', requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } } });
assert.equal(button('Submit answers').disabled, true);
assert.equal(button('Always allow'), undefined);
await act(async () => root.unmount());
dom.window.close();
console.log('Structured approval UI: all good');
