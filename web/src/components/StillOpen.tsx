/** What a product is still waiting on, and the thread under each one.
 *
 *  The third panel of a product's page, under Right now. The two that were
 *  there answer "what is happening" and "how did it get here", and between them
 *  they could not answer the question a person actually opens a product with:
 *  **what is this waiting for.** isghocam read `closed beta` with nothing on the
 *  page saying the payment token had never been made or that the content was
 *  not wired up — both of them things no agent on this computer can do, so
 *  neither was ever a card.
 *
 *  So: not a card, and deliberately not on the board. A card is work an agent
 *  can be handed. These are the other kind — a token somebody has to make in a
 *  browser, a registrar sitting on a domain, a decision nobody has taken — and
 *  putting them in a column would promise a worker that is never coming.
 *
 *  Each is a post: a state, a line, what is actually needed under it, and a
 *  thread. Two voices write in the thread and it says which — a note from
 *  Yakup is a decision ("Bedirhan has the account"), a note from the assistant
 *  is a finding ("the key is still CHANGE_ME in prod"), and a finding read as a
 *  decision is how the wrong thing gets done.
 *
 *  The judgements are `openRows` in `lib/project.ts`; this is the arrangement.
 */
import { useState } from 'react';
import { uptime } from '../lib/format';
import { addOpenItem, commentOpenItem, setOpenItem } from '../lib/actions';
import { NOTHING_OPEN, openLine, openRows, type OpenRow } from '../lib/project';
import { RADIUS, T } from '../lib/theme';
import { useDivanStore, type MergedProject } from '../lib/divan';
import type { DivanOpenState } from '../lib/protocol';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../ui/divan';
import { DictatingComposer } from './Mic';
import { mono } from '../ui/kit';

/** The states a person can move an item between from here, in the order a
 *  thing travels through them. `done` is the press on the card itself. */
const MOVES: { state: DivanOpenState; word: string }[] = [
  { state: 'blocked', word: 'Blocked' },
  { state: 'waiting', word: 'Waiting' },
  { state: 'todo', word: 'To do' },
];

export function StillOpen({ project: p, now }: { project: MergedProject; now: number }) {
  const rows = openRows(p, now, uptime);
  const [writing, setWriting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // A product is one row per machine; a write names the machine that holds it.
  const host = p.hosts[0] ?? null;
  const id = host ? p.ids[host] : null;

  /** Do it, then ask that machine for its board again, so everything else
   *  drawn from the product catches up with the change. */
  const write = async (go: Promise<unknown>) => {
    setFailed(null);
    try {
      await go;
      if (host) void useDivanStore.getState().load(host);
    } catch (e: any) {
      setFailed(e?.message ?? 'That did not reach the computer');
    }
  };

  const open = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <SectionHeader
        title="Still open"
        right={(
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 12 }}>
            {!!openLine(rows) && (
              <span style={{ ...mono, fontSize: 11.5, color: T.ink3 }}>{openLine(rows)}</span>
            )}
            {!!id && (
              <button
                type="button" onClick={() => setWriting((w) => !w)}
                style={{
                  background: 'transparent', border: 'none', padding: 0, font: 'inherit',
                  fontSize: 13, fontWeight: 500, color: T.ink, cursor: 'pointer',
                }}
              >{writing ? 'Cancel' : '+ Add'}</button>
            )}
          </span>
        )}
      />

      {writing && id && host && (
        <Write
          onSave={(fields) => {
            setWriting(false);
            void write(addOpenItem(host, id, fields));
          }}
        />
      )}

      {!rows.length && !writing && (
        <EmptyState
          title="Nothing is waiting — that anybody has said."
          body={NOTHING_OPEN}
          style={{ padding: '4px 0 16px' }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {open.map((r) => (
          <Item key={r.key} row={r} onWrite={write} host={host} projectId={id} />
        ))}
      </div>

      {/* What it was waiting for stays on the page once it is no longer waiting
          for it: a beta is partly described by the list it got through. */}
      {!!done.length && (
        <>
          <div style={{ ...mono, fontSize: 11, color: T.ink3, paddingTop: 4 }}>
            {done.length} settled
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {done.map((r) => (
              <Item key={r.key} row={r} onWrite={write} host={host} projectId={id} />
            ))}
          </div>
        </>
      )}

      {!!failed && (
        <div style={{ ...mono, fontSize: 11, color: T.red }}>{failed}</div>
      )}
    </div>
  );
}

function Item({ row: r, onWrite, host, projectId }: {
  row: OpenRow;
  onWrite: (go: Promise<unknown>) => void;
  host: string | null;
  projectId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  const can = !!host && !!projectId;
  const toggle = () => setOpen((o) => !o);

  return (
    // The whole card is the press, not a word at the bottom of it. A post is
    // opened by pressing the post; a small `say something` under each one was a
    // second thing to aim at and read as a button that did something else.
    //
    // A div with a role rather than the card's own `onClick`, which draws a
    // <button>: this one has buttons inside it, and a button inside a button
    // is not a thing a browser will let either of them be.
    <div
      role="button" tabIndex={0} aria-expanded={open}
      title={open ? 'Close the thread' : 'Open the thread'}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      }}
      style={{ cursor: 'pointer', borderRadius: RADIUS.tile, outline: 'none' }}
    >
    <Card
      radius={RADIUS.tile}
      // The ring carries the state so a blocked item is findable without
      // reading a word of it. Settled ones give it up: the page is about what
      // is left.
      ring={r.done ? 'line' : r.state === 'blocked' ? 'red' : r.state === 'waiting' ? 'amber' : 'line'}
      style={{
        gap: 10, padding: '12px 14px',
        // Grey rather than faint — a fade is the one thing the palette cannot
        // make legible, which is why this frame has none.
        color: r.done ? T.ink2 : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <Tag label={r.label} tone={r.tone} />
        <div style={{
          flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, letterSpacing: '-.01em',
          textDecoration: r.done ? 'line-through' : undefined,
        }}>{r.title}</div>
        {!!r.area && (
          <span style={{ ...mono, flex: 'none', fontSize: 11, color: T.ink3 }}>{r.area}</span>
        )}
      </div>

      {!!r.body && (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>{r.body}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ ...mono, fontSize: 11, color: T.ink3 }}>{r.since}</span>
        {/* How much has been said, as a fact and not as a control: the thread
            is shut until the card is pressed, and this is what says there is
            one to open. */}
        {!!r.thread && (
          <span style={{ ...mono, fontSize: 11, color: T.ink2 }}>{r.thread}</span>
        )}
        {/* The buttons are their own presses. Without this a press on `Done`
            would settle the item and flap the thread open in the same click. */}
        {can && (
          <span
            onClick={(e) => e.stopPropagation()}
            style={{ marginLeft: 'auto', display: 'flex', gap: 6, cursor: 'default' }}
          >
            {!r.done && MOVES.filter((m) => m.state !== r.state).map((m) => (
              <Button
                key={m.state} small face="outline" label={m.word}
                onClick={() => onWrite(setOpenItem(host!, projectId!, r.id, { state: m.state }))}
              />
            ))}
            {!r.done && (
              <Button small face="ink" label="Done"
                onClick={() => onWrite(setOpenItem(host!, projectId!, r.id, { state: 'done' }))} />
            )}
            {r.done && (
              <Button small face="outline" label="Reopen"
                onClick={() => onWrite(setOpenItem(host!, projectId!, r.id, { state: 'todo' }))} />
            )}
          </span>
        )}
      </div>

      {open && (
        // Reading and typing in the thread are not presses on the card.
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex', flexDirection: 'column', gap: 8, cursor: 'default',
            borderTop: `1px solid ${T.line}`, paddingTop: 10,
          }}
        >
          {!r.comments.length && (
            <div style={{ fontSize: 12.5, color: T.ink3 }}>Nothing said about this one yet.</div>
          )}
          {r.comments.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{
                ...mono, flex: 'none', fontSize: 11, fontWeight: 600,
                color: m.who === 'hermes' ? T.ink3 : T.ink2,
              }}>{m.who}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 }}>{m.text}</span>
            </div>
          ))}
          {can && (
            <DictatingComposer
              hostKey={host}
              placeholder="Say something about this one…"
              value={said} onChange={setSaid}
              style={{ margin: 0 }}
              onSend={() => {
                const text = said.trim();
                if (!text) return;
                setSaid('');
                onWrite(commentOpenItem(host!, projectId!, r.id, text, 'you'));
              }}
            />
          )}
        </div>
      )}
    </Card>
    </div>
  );
}

/** Writing one down: the line, what is needed, and which of the three it is.
 *  Nothing else — an item somebody has to fill a form in for is an item nobody
 *  writes down at the moment they notice it. */
function Write({ onSave }: {
  onSave: (fields: { title: string; body: string; state: DivanOpenState; owner: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [owner, setOwner] = useState('');
  const [state, setState] = useState<DivanOpenState>('todo');

  return (
    <Card raised radius={RADIUS.tile} style={{ gap: 10, padding: '12px 14px' }}>
      <input
        autoFocus type="text" value={title} placeholder="What is it, in one line"
        onChange={(e) => setTitle(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', background: T.s2, color: T.ink,
          border: 'none', outline: 'none', borderRadius: 10, padding: '8px 10px',
          font: 'inherit', fontSize: 15, fontWeight: 600,
        }}
      />
      <textarea
        value={body} rows={3} placeholder="What actually has to happen, and by whom"
        onChange={(e) => setBody(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box', background: T.s2, color: T.ink,
          border: 'none', outline: 'none', borderRadius: 10, padding: '8px 10px',
          font: 'inherit', fontSize: 13.5, lineHeight: 1.5, resize: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {MOVES.map((m) => (
          <Button
            key={m.state} small face={state === m.state ? 'ink' : 'outline'} label={m.word}
            onClick={() => setState(m.state)}
          />
        ))}
        <input
          type="text" value={owner} placeholder="on whom (optional)"
          onChange={(e) => setOwner(e.target.value)}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', color: T.ink, border: 'none',
            outline: 'none', font: 'inherit', fontSize: 13, textAlign: 'right',
          }}
        />
        <Button
          small face="ink" label="Add" disabled={!title.trim()}
          onClick={() => onSave({ title: title.trim(), body: body.trim(), state, owner: owner.trim() })}
        />
      </div>
    </Card>
  );
}
