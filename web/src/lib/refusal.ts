// Why a computer refused this panel's token, and what to say about it.
//
// The daemon puts the reason in the socket's close frame (code 4401) and in the
// `detail` of a 401 — see `_admit` in daemon/remote_ai_chat/server.py. Every
// one of them used to be shown as "token revoked", including a tunnel that had
// locked the household's own address out, which sent people looking for a
// revocation nobody had made.
//
// A token refused once is refused for the rest of this tab: nothing else that
// carries it — the socket's reconnect, /screen.jpg, /files, /upload,
// dictation — is sent again. Retrying cannot change the answer, and through the
// tunnel every retry of a wrong token was one more count towards a lock.
// Reloading the page starts over.

export type RefusalKind =
  | 'not_tunnel_device' | 'tunnel_only' | 'unknown_token' | 'revoked' | 'no_token'
  | 'locked' | 'not_let_in' | 'unauthorized';

export interface Refusal {
  kind: RefusalKind;
  /** When a lock lifts, epoch seconds. */
  until?: number;
  /** The address a lock is on, as the daemon counts it. */
  addr?: string;
}

const KINDS: RefusalKind[] = ['not_tunnel_device', 'tunnel_only', 'unknown_token', 'revoked', 'no_token'];

/** The refusal in a close frame or a 401's detail. 1008 is the tunnel's own
 *  gate — the address list or Cloudflare Access — before any token is read. */
export function parseRefusal(code: number, reason: string | null | undefined): Refusal {
  const why = String(reason ?? '');
  if (code === 1008) return { kind: 'not_let_in' };
  if (why.startsWith('locked:')) {
    const [, until, ...addr] = why.split(':');
    return { kind: 'locked', until: Number(until) || undefined, addr: addr.join(':') || undefined };
  }
  return { kind: (KINDS as string[]).includes(why) ? why as RefusalKind : 'unauthorized' };
}

const refused = new Map<string, Refusal>();

/** Remember that a computer refused this token. */
export function refuse(token: string, r: Refusal): void { refused.set(token, r); }

/** The refusal this token met, if it met one in this tab. */
export function refusedFor(token: string): Refusal | undefined { return refused.get(token); }

/** Read a 401 for its reason and remember it. Anything else is left alone. */
export async function noteRefusal(token: string, r: Response): Promise<Refusal | undefined> {
  if (r.status !== 401) return undefined;
  let detail = '';
  try { detail = String((await r.json())?.detail ?? ''); } catch { /* no body to read */ }
  const found = parseRefusal(4401, detail);
  refuse(token, found);
  return found;
}

type Words = { short: string; long: string };
type Table = Record<RefusalKind, Words>;

export const REFUSAL_TEXT: Record<'en' | 'tr', Table> = {
  en: {
    not_tunnel_device: {
      short: 'wrong door · this key is for the tailnet',
      long: 'This browser holds a key made for the tailnet, and the tunnel only takes keys made for it. The key is fine. On the computer run `remote-ai-chat web --at <hostname>` and open the link it prints here.',
    },
    tunnel_only: {
      short: 'wrong door · this key is for the tunnel',
      long: 'This key was made for the tunnel and only opens it. Open the panel by its tunnel address, or pair this browser on the tailnet with `remote-ai-chat web`.',
    },
    unknown_token: {
      short: 'key not recognised',
      long: 'The computer does not know this key — it may be another computer\'s, or from before a reset. Pair again on the computer: `remote-ai-chat web` (or `web --at <hostname>` behind the tunnel).',
    },
    revoked: {
      short: 'access revoked',
      long: 'This device was removed on the computer. Pair again to come back: `remote-ai-chat web`.',
    },
    no_token: {
      short: 'not paired',
      long: 'This page has no key for the computer yet. On the computer run `remote-ai-chat web` and open the link it prints.',
    },
    locked: {
      short: 'address locked until {time}',
      long: 'Too many different wrong keys came from {addr}, so the tunnel refuses it until {time}. To lift it now, on the computer: `remote-ai-chat unlock {addr}` — then reload this page.',
    },
    not_let_in: {
      short: 'not let through the tunnel',
      long: 'The tunnel turned this address or sign-in away before any key was read. Check `tunnel_allow_ips` and the Cloudflare Access sign-in (docs/TUNNEL.md).',
    },
    unauthorized: {
      short: 'no access',
      long: 'The computer refused this key. Pair again on the computer: `remote-ai-chat web`.',
    },
  },
  tr: {
    not_tunnel_device: {
      short: 'yanlış kapı · bu anahtar tailnet için',
      long: 'Bu tarayıcıdaki anahtar tailnet için yapılmış; tunnel sadece kendisi için yapılan anahtarları kabul eder. Anahtarda sorun yok. Bilgisayarda `remote-ai-chat web --at <hostname>` çalıştır ve verdiği linki burada aç.',
    },
    tunnel_only: {
      short: 'yanlış kapı · bu anahtar tunnel için',
      long: 'Bu anahtar tunnel için yapılmış, sadece onu açar. Paneli tunnel adresinden aç ya da bu tarayıcıyı tailnet\'te `remote-ai-chat web` ile eşle.',
    },
    unknown_token: {
      short: 'anahtar tanınmıyor',
      long: 'Bilgisayar bu anahtarı tanımıyor — başka bir bilgisayarın olabilir ya da bir sıfırlamadan öncesine ait. Bilgisayarda yeniden eşle: `remote-ai-chat web` (tunnel arkasındaysan `web --at <hostname>`).',
    },
    revoked: {
      short: 'erişim kaldırıldı',
      long: 'Bu cihaz bilgisayarda silinmiş. Geri gelmek için yeniden eşle: `remote-ai-chat web`.',
    },
    no_token: {
      short: 'eşlenmemiş',
      long: 'Bu sayfanın bilgisayar için bir anahtarı yok. Bilgisayarda `remote-ai-chat web` çalıştır ve verdiği linki aç.',
    },
    locked: {
      short: 'adres {time}\'e kadar kilitli',
      long: '{addr} adresinden çok fazla farklı yanlış anahtar geldi, tunnel bu adresi {time}\'e kadar kabul etmiyor. Hemen açmak için bilgisayarda: `remote-ai-chat unlock {addr}` — sonra bu sayfayı yenile.',
    },
    not_let_in: {
      short: 'tunnel içeri almadı',
      long: 'Tunnel bu adresi ya da girişi, anahtara bakmadan geri çevirdi. `tunnel_allow_ips` listesini ve Cloudflare Access girişini kontrol et (docs/TUNNEL.md).',
    },
    unauthorized: {
      short: 'erişim yok',
      long: 'Bilgisayar bu anahtarı reddetti. Bilgisayarda yeniden eşle: `remote-ai-chat web`.',
    },
  },
};

/** The panel has one language and this is the one place it has two: Turkish
 *  for a browser that asks for it, English otherwise. */
export function refusalLang(): 'en' | 'tr' {
  const lang = typeof navigator !== 'undefined' ? String(navigator.language || '') : '';
  return lang.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

function clock(until?: number): string {
  if (!until) return '?';
  const d = new Date(until * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** What to show for a refusal: a few words for a status line and a sentence
 *  that says what to do. */
export function refusalText(r: Refusal | null | undefined, lang = refusalLang()): Words {
  const words = REFUSAL_TEXT[lang][r?.kind ?? 'unauthorized'];
  const fill = (s: string) => s.split('{time}').join(clock(r?.until))
    .split('{addr}').join(r?.addr || (lang === 'tr' ? 'bu adres' : 'this address'));
  return { short: fill(words.short), long: fill(words.long) };
}
