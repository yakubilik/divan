import type { ReactNode } from 'react';
import { C, R } from '../lib/theme';
import { mono } from '../ui/kit';

/** The two halves of a conversation, so that both walls speak the same one.
 *
 *  A chat draws what a person said as a bubble on the right and what came back
 *  as plain words on the left, and a ticket is read the same way. Keeping the
 *  geometry in one place is the only way that stays true: two copies of a
 *  bubble drift apart the first time one of them is adjusted.
 */

/** What a person said, on the right. */
export function Bubble({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        // HANDOVER §4.8: `--glass-2`, a hairline edge, the corner it speaks from.
        maxWidth: '80%', background: C.surface2, border: `1px solid ${C.border}`,
        borderRadius: '18px 18px 6px 18px',
        padding: '10px 14px', fontSize: 15, lineHeight: '22px', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {children}
      </div>
    </div>
  );
}

/** What the daemon leaves where a key was pasted (`daemon/divan/
 *  secrets.py`): the family, the keychain item, and how to read it back. The
 *  agent needs all of that; a person reading the chat needs only to see that a
 *  key was there and is safe, so it is drawn as one locked chip. */
export const SECRET = /\[secret ([a-z]+) (rac-secret-[a-z]+-[0-9a-f]{8})( — not saved)?[^\]]*\]/g;

const SECRET_NAME: Record<string, string> = {
  openai: 'OpenAI key', anthropic: 'Anthropic key', github: 'GitHub token', aws: 'AWS key',
  google: 'Google key', stripe: 'Stripe key', resend: 'Resend key', posthog: 'PostHog key',
  sentry: 'Sentry token', slack: 'Slack token', telegram: 'Telegram bot token', jwt: 'token',
  pem: 'private key', secret: 'secret', password: 'password', apppassword: 'app password',
};

export function SecretChip({ kind, service, saved }: { kind: string; service: string; saved: boolean }) {
  return (
    <span
      title={saved ? `In the keychain as ${service}` : 'The keychain refused it, so it was not saved'}
      style={{
        ...mono, fontSize: 12, padding: '1px 7px', borderRadius: R.badge, whiteSpace: 'nowrap',
        background: C.surface, border: `1px solid ${C.border}`, color: saved ? C.text2 : C.danger,
      }}
    >🔒 {SECRET_NAME[kind] ?? kind}</span>
  );
}

/** Plain text with every placeholder in it drawn as its chip. */
export function withSecrets(text: string, keyBase = 's'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SECRET)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<SecretChip key={`${keyBase}-${m.index}`} kind={m[1]} service={m[2]} saved={!m[3]} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A link, opened in a tab of its own so the panel stays where it was. */
function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>
      {children}
    </a>
  );
}

/** The little of Markdown that actually shows up in these answers: fenced code,
 *  inline code, bold and links. Headings and tables are left as written — a
 *  renderer that half-understands them reads worse than the raw text does. */
function inline(text: string, keyBase: string) {
  const out: ReactNode[] = [];
  // Code, bold, a Markdown link, and a bare URL — the last two because an
  // answer that hands over a link and does not let it be pressed has handed
  // over half of it.
  const re = /(\[secret [a-z]+ rac-secret-[a-z]+-[0-9a-f]{8}[^\]]*\])|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"'`]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // A sentence that ends on a URL keeps its full stop out of the link.
    let whole = m[0];
    let bare = m[6];
    if (bare) {
      const tail = bare.match(/[.,;:!?)\]]+$/);
      if (tail) { bare = bare.slice(0, -tail[0].length); whole = bare; }
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${m.index}`;
    if (m[1] != null) {
      out.push(...withSecrets(m[1], key));
    } else if (m[2] != null) {
      out.push(
        <code key={key} style={{
          ...mono, fontSize: 13, background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: R.badge, padding: '1px 5px', color: C.text2,
        }}>{m[2]}</code>,
      );
    } else if (m[3] != null) {
      out.push(<strong key={key} style={{ fontWeight: 600 }}>{m[3]}</strong>);
    } else if (m[4] != null) {
      out.push(<Link key={key} href={m[5]}>{m[4]}</Link>);
    } else {
      out.push(<Link key={key} href={bare!}>{bare}</Link>);
    }
    last = m.index + whole.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The words of a message: fenced code as code, the rest as it was written. */
export function Prose({ text }: { text: string }) {
  const parts = text.split(/```/);
  return (
    <>
      {parts.map((part, i) => (
        i % 2 === 1 ? (
          <pre key={i} style={{
            ...mono, fontSize: 13, lineHeight: '19px', background: C.bg,
            border: `1px solid ${C.border}`, borderRadius: R.card, padding: '10px 12px',
            overflowX: 'auto', margin: '8px 0', color: C.text2,
          }}>{part.replace(/^[a-z]*\n/i, '')}</pre>
        ) : (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{inline(part, `p${i}`)}</span>
        )
      ))}
    </>
  );
}
