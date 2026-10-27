/** A conversation with photos and videos in it, with nothing behind it.
 *
 *  Built and driven by `scripts/test-media-ui.mjs`, which serves this page and
 *  the files in `fixtures/media` from one local server standing in for the
 *  computer: `fileUrl` points at it, the way it points at a daemon. */
import { createRoot } from 'react-dom/client';
import '../src/styles/divan-tokens.css';
import '../src/styles/divan-components.css';
import '../src/styles/divan-app.css';
import { Timeline } from '../src/components/Timeline';
import { useFleet } from '../src/lib/fleet';
import { apply, type Item } from '../src/lib/timeline';
import { themeCss } from '../src/lib/theme';
import { host } from './panel-fixture.js';

const h: any = host();
h.cfg = { ...h.cfg, host: location.hostname, port: Number(location.port) };
useFleet.setState({ hosts: { test: h }, order: ['test'], focus: 'test', ready: true } as any);

const F = '/Users/x/Desktop/divan-media';
const say = (text: string, attachments: any[] = []) => ({ event: 'message.user', data: { text, attachments } });
const answer = (text: string) => ({ event: 'message.assistant', data: { segment: 1, text } });
const events = [
  // Something to scroll past, so closing the viewer can be seen to leave the
  // chat where it was.
  ...Array.from({ length: 6 }, (_, i) => [
    say(`Question ${i + 1} about the release, long enough to take a line or two of the column.`),
    answer(`Answer ${i + 1}: nothing to worry about, the build is green and the notes are drafted.`),
  ]).flat(),
  say('Two clips from the phone', [
    { kind: 'video', path: `${F}/portrait.webm`, name: 'portrait.webm' },
    { kind: 'video', path: `${F}/landscape.webm`, name: 'landscape.webm' },
  ]),
  say('And a photo', [
    { kind: 'image', path: `${F}/photo.jpg`, view: `${F}/photo-view.jpg`, name: 'photo.jpg' },
  ]),
  say('The rest', [
    { kind: 'image', path: `${F}/grid-a.jpg`, name: 'grid-a.jpg' },
    { kind: 'image', path: `${F}/grid-b.jpg`, name: 'grid-b.jpg' },
    { kind: 'image', path: `${F}/deleted.jpg`, name: 'deleted.jpg' },
    { kind: 'audio', path: `${F}/note.wav`, name: 'note.wav', transcript: 'a short voice note' },
    { kind: 'file', path: `${F}/notes.txt`, name: 'notes.txt' },
  ]),
  answer('Got all of it.'),
];
const now = Date.now() / 1000;
const items = events.reduce<Item[]>((acc, e, i) => apply(acc, { ...e, seq: i + 1, ts: now + i } as any), []);

document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root')!;
root.className = 'dv-root dv-ambient';
root.dataset.theme = 'dark';
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

createRoot(root).render(
  <div id="scroller" style={{ height: '100%', overflowY: 'auto' }}>
    <div data-chat style={{ maxWidth: 760, margin: '0 auto', padding: 16, boxSizing: 'border-box' }}>
      <Timeline items={items} hostKey="test" onRespond={() => {}} />
    </div>
  </div>,
);
