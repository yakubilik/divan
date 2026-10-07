/** New ticket (HANDOVER §4.5): the scope chips — the product, and which of its
 *  branches — a Title, two or three sentences, and where it goes: Ice Box (the
 *  default), Queued or Start now. Then Create. No other field is asked for and
 *  there is no second step; the executor and the agent face are filled in
 *  later, or by an agent.
 *
 *  The card is written on one machine that has the product (`lib/compose.ts`
 *  `writer`). Until that machine answers the form keeps what was typed, and a
 *  refusal is said under it in the machine's own words.
 */
import { useEffect, useState } from 'react';
import { createCard } from '../lib/actions';
import { writer } from '../lib/compose';
import { useDivanStore, type DivanView, type MergedProject } from '../lib/divan';
import type { DivanColumn } from '../lib/protocol';

/** The segment, in the frame's order. */
export const LANDINGS: { key: DivanColumn; label: string }[] = [
  { key: 'ice_box', label: 'Ice Box' },
  { key: 'queued', label: 'Queued' },
  { key: 'in_progress', label: 'Start now' },
];

const CROSS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

export function NewTicket({ view, project: p, onClose, onCreated }: {
  view: DivanView;
  project: MergedProject;
  onClose: () => void;
  /** The card is on the machine: show the column it went into. */
  onCreated: (column: DivanColumn) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [into, setInto] = useState<DivanColumn>('ice_box');
  const fallback = p.branches.find((b) => b.kind === 'engineering') ?? p.branches[0] ?? null;
  const [branch, setBranch] = useState<string | null>(fallback?.kind ?? null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const on = p.branches.find((b) => b.kind === branch) ?? fallback;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(false); else onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [menu, onClose]);

  const create = async () => {
    const line = title.trim();
    if (!line || busy) return;
    const w = writer(view, p);
    if (!w) { setFailed('No computer of this product is paired, so there is nowhere to put it.'); return; }
    setBusy(true);
    setFailed(null);
    try {
      await createCard(w.host, {
        project_id: w.project, title: line, summary: body.trim(), column: into,
        // The daemon files under engineering when no branch is named.
        ...(on && on.kind !== 'engineering' ? { branch: on.kind } : {}),
      });
      void useDivanStore.getState().load(w.host);
      onCreated(into);
    } catch (e: any) {
      setFailed(e?.message ?? 'That did not reach the computer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, width: '100%', margin: '0 auto', padding: '48px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: '30px', fontWeight: 600, letterSpacing: '-0.02em' }}>New ticket</h1>
        <button type="button" className="dv-icon-btn" aria-label="Close" onClick={onClose}
          style={{ marginLeft: 'auto', width: 44, height: 44 }}>{CROSS}</button>
      </div>
      <form className="dv-glass-strong" aria-label="New ticket"
        style={{ borderRadius: 'var(--radius-xl)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
        onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className="dv-scope" style={{ margin: 0 }} data-menu-root="">
          <span className="dv-chip dv-chip--locked" data-locked="true">
            <span className="dv-mono dv-mono--sm" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>{p.name}
          </span>
          {!!on && (
            <span style={{ position: 'relative' }}>
              <button type="button" className="dv-chip dv-hit" aria-haspopup="menu" aria-expanded={menu}
                aria-label={`Branch: ${on.name || on.kind}`} onClick={() => setMenu(!menu)}>
                {on.name || on.kind}
              </button>
              {menu && (
                <div role="menu" aria-label="Branches" className="dv-menu">
                  {p.branches.map((b) => (
                    <button key={b.kind} type="button" role="menuitemradio" aria-checked={b.kind === on.kind}
                      onClick={() => { setBranch(b.kind); setMenu(false); }}>
                      <span>{b.name || b.kind}</span>
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
        <div className="dv-field">
          <label htmlFor="nt-title">Title</label>
          <input id="nt-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="dv-field">
          <label htmlFor="nt-body">Two or three sentences</label>
          <textarea id="nt-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
          <div className="dv-seg" role="group" aria-label="Put it in">
            {LANDINGS.map((l) => (
              <button key={l.key} type="button" aria-pressed={into === l.key} onClick={() => setInto(l.key)}>{l.label}</button>
            ))}
          </div>
          <button type="submit" className="dv-btn dv-btn--primary dv-hit" disabled={busy || !title.trim()}
            style={{ marginLeft: 'auto', height: 38, padding: '0 18px' }}>Create</button>
        </div>
        {!!failed && <p className="dv-meta" role="status" style={{ margin: 0, color: 'var(--red)' }}>{failed}</p>}
      </form>
      <p className="dv-meta" style={{ margin: 0, padding: '0 8px' }}>
        {busy ? 'filing the card…' : "That's all it needs. Executor and the agent face can be filled later, or by an agent."}
      </p>
    </div>
  );
}
