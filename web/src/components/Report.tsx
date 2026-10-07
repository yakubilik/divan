/** What a ticket came back with, for a person to read.
 *
 *  A finished ticket used to end on the worker's report and nothing else, and
 *  the documents a ticket was asked to produce — a rotation list, an audit —
 *  sat in a folder on the Mac that nobody was pointed at. The daemon now reads
 *  them back (`ustabasi.report`, masked on the way out) and this draws them on
 *  the ticket's own page: the summary, the verdict, then each document, open.
 *
 *  The documents are Markdown, and the ones that matter are mostly tables, so
 *  `Doc` reads headings, lists, tables and fenced code; everything inline goes
 *  through `Prose`'s own reading (code, bold, links, masked keys).
 */
import { useEffect, useState } from 'react';
import { ticketReport, type TicketReport } from '../lib/actions';
import { T } from '../lib/theme';
import { mono } from '../ui/kit';
import { Prose } from './Bubble';

export function Report({ host, ticket, status }: { host: string; ticket: number; status: string }) {
  const [rep, setRep] = useState<TicketReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mine = true;
    ticketReport(host, ticket)
      .then((r) => { if (mine) { setRep(r); setError(null); } })
      .catch((e) => { if (mine) setError(e?.message ?? 'That did not reach the computer'); });
    return () => { mine = false; };
  }, [host, ticket, status]);

  if (error) {
    return <div style={{ ...mono, fontSize: 11.5, color: T.ink3 }}>the report did not come: {error}</div>;
  }
  if (!rep || (!rep.summary && !rep.verdict_summary && !rep.files?.length)) return null;
  return (
    <section style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-.01em' }}>Report</div>
      {!!rep.summary && (
        <div style={{ fontSize: 15, lineHeight: '24px', color: T.ink }}><Prose text={rep.summary} /></div>
      )}
      {!!rep.verdict_summary && (
        <div style={{
          fontSize: 14, lineHeight: '22px', color: T.ink2, padding: '10px 14px',
          borderRadius: 12, background: T.s1, boxShadow: `0 0 0 1px ${T.line}`,
        }}>
          <span style={{ ...mono, fontSize: 11, color: T.ink3, marginRight: 8 }}>
            verifier · {rep.verdict || '—'}
          </span>
          <Prose text={rep.verdict_summary} />
        </div>
      )}
      {(rep.files ?? []).map((f) => (
        <details key={f.path} open style={{
          borderRadius: 12, background: T.s1, boxShadow: `0 0 0 1px ${T.line}`, overflow: 'hidden',
        }}>
          <summary style={{
            cursor: 'pointer', padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'baseline',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{f.name}</span>
            <span style={{ ...mono, fontSize: 11, color: T.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.path}{f.cut ? ' · cut short' : ''}
            </span>
          </summary>
          <div style={{ padding: '4px 16px 14px', borderTop: `1px solid ${T.line}`, overflowX: 'auto' }}>
            <Doc text={f.text} />
          </div>
        </details>
      ))}
    </section>
  );
}

/** Markdown as these reports write it: headings, lists, tables, fenced code,
 *  and paragraphs. A line it does not know is a paragraph. */
export function Doc({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  const cell: React.CSSProperties = { padding: '5px 10px', borderBottom: `1px solid ${T.line}`, textAlign: 'left', verticalAlign: 'top' };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(<pre key={i} style={{ ...mono, fontSize: 12, lineHeight: '18px', background: T.bg, padding: '8px 10px', borderRadius: 8, overflowX: 'auto' }}>{body.join('\n')}</pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const size = [0, 19, 16, 14.5, 14][h[1].length];
      out.push(<div key={i} style={{ fontSize: size, fontWeight: 600, margin: '12px 0 4px' }}><Prose text={h[2]} /></div>);
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <table key={i} style={{ borderCollapse: 'collapse', fontSize: 12.5, lineHeight: '18px', margin: '6px 0' }}>
          <thead><tr>{head.map((c, k) => <th key={k} style={{ ...cell, fontWeight: 600, color: T.ink2 }}><Prose text={c} /></th>)}</tr></thead>
          <tbody>{body.map((r, n) => (
            <tr key={n}>{r.map((c, k) => <td key={k} style={cell}><Prose text={c} /></td>)}</tr>
          ))}</tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
      }
      out.push(
        <ul key={i} style={{ margin: '4px 0', paddingLeft: 20, fontSize: 14, lineHeight: '22px' }}>
          {items.map((t, k) => <li key={k}><Prose text={t} /></li>)}
        </ul>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    // A line no rule above took and the stop pattern refuses is still text.
    if (!para.length) para.push(lines[i++]);
    out.push(<p key={i} style={{ fontSize: 14, lineHeight: '22px', margin: '6px 0' }}><Prose text={para.join(' ')} /></p>);
  }
  return <>{out}</>;
}
