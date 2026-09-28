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
        maxWidth: '72%', background: C.surface2,
        borderRadius: `${R.bubble}px ${R.bubble}px 4px ${R.bubble}px`,
        padding: '10px 14px', fontSize: 15, lineHeight: '22px', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {children}
      </div>
    </div>
  );
}

/** The little of Markdown that actually shows up in these answers: fenced code,
 *  inline code, and bold. Headings, tables and links are left as written — a
 *  renderer that half-understands them reads worse than the raw text does. */
function inline(text: string, keyBase: string) {
  const out: ReactNode[] = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) {
      out.push(
        <code key={`${keyBase}-${m.index}`} style={{
          ...mono, fontSize: 13, background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: R.badge, padding: '1px 5px', color: C.text2,
        }}>{m[1]}</code>,
      );
    } else {
      out.push(<strong key={`${keyBase}-${m.index}`} style={{ fontWeight: 600 }}>{m[2]}</strong>);
    }
    last = m.index + m[0].length;
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
