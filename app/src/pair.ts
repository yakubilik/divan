// What the pairing screen is handed, read away from the screen that reads it.
//
// `divan pair` prints a QR code and a link, and the phone accepts the
// same thing typed, scanned or opened as a deep link. Which of those it is, and
// whether it is one at all, is the only judgement on that screen — everything
// else there is a camera and three boxes — and it is the judgement that decides
// whether this phone ever talks to a computer. So it lives here, where
// `scripts/test-divan-screens.cjs` can hold it to a real payload without a
// camera.
import type { HostConfig } from './protocol';

/** The port the daemon listens on unless it was told otherwise. Both halves of
 *  the screen fall back to it: a code that names no port, and a form left with
 *  the box as it was found. */
export const DEFAULT_PORT = 8790;

/** The scheme `divan pair` prints its link under. */
export const SCHEME = 'divan';

// ── LEGACY NAME BLOCK: begin ─────────────────────────────────────────────────
// The scheme from before the product was called Divan. It is accepted on
// input only, so an old QR code or a link out of an old build still pairs;
// nothing writes it. This is the one place the app spells the old name.
export const LEGACY_SCHEME = 'remoteaichat';
// ── LEGACY NAME BLOCK: end ───────────────────────────────────────────────────

/** Whether `text` is a pairing deep link, under the scheme or the legacy one. */
export function isPairLink(text: string): boolean {
  return [SCHEME, LEGACY_SCHEME].some((s) => text.startsWith(s + '://'));
}

/** Accepts what `divan pair` prints: the `divan://` deep link
 *  (or the same link under the legacy scheme), and the older JSON payload. Anything else is null — the screen says it does
 *  not recognise the code rather than pairing with half of one, because a host
 *  without a token is a connection that will be refused and a token without a
 *  host is nothing at all. */
export function parsePairCode(data: string): HostConfig | null {
  const text = (data || '').trim();
  if (isPairLink(text)) {
    const q = text.slice(text.indexOf('?') + 1);
    const p: Record<string, string> = {};
    for (const pair of q.split('&')) {
      const i = pair.indexOf('=');
      if (i > 0) p[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    }
    if (!p.host || !p.token) return null;
    return { host: p.host, port: Number(p.port) || DEFAULT_PORT, token: p.token,
             name: p.name || p.host, device_id: p.device_id };
  }
  try {
    const j = JSON.parse(text);
    if (!j.host || !j.token) return null;
    return { host: j.host, port: Number(j.port) || DEFAULT_PORT, token: j.token,
             name: j.name || j.host, device_id: j.device_id };
  } catch {
    return null;
  }
}
