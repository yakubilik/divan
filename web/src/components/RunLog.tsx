/** What the agent on a ticket is printing, as it prints it.
 *
 *  No new visual language: a sentence is drawn the way the chat draws what an
 *  agent says, a tool call is the same card with its answer folded behind it,
 *  and the run's own last line is a rule with a word on it. What is different
 *  is only that nobody typed any of it — it is one side of a conversation,
 *  which is what a run is.
 *
 *  The phone draws the same turns from the same file (`app/app/ticket/[id].tsx`),
 *  and both read it through the same module, so a ticket cannot say one thing
 *  on a phone and another on a desktop.
 *
 *  Every silence gets a sentence rather than a spinner. A ticket nobody has
 *  started, a run whose directory has been cleared away, a computer whose
 *  daemon predates this, a computer with no queue at all: each of those is a
 *  thing to say once, and each was a spinner that never stopped somewhere.
 */
import { useState } from 'react';
import { fileUrl } from '../lib/actions';
import { C, R } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import type { RunRead } from '../lib/run';
import { Lightbox, type Shot } from './Lightbox';
import type { RunSilence, Turn } from '../lib/transcript';
import { Prose } from './Bubble';

const SILENCE: Record<Exclude<RunSilence, null>, { title: string; body: string }> = {
  neverRun: {
    title: 'Nothing has run on this ticket yet.',
    body: 'It is in the queue; the log starts when a worker picks it up.',
  },
  noLog: {
    title: 'That run has been cleared away.',
    body: 'The queue keeps a run directory per attempt, and this one is gone. What was decided is in the conversation.',
  },
  noTicket: {
    title: 'That ticket is not in the queue any more.',
    body: 'It may have been cancelled, or the queue rebuilt.',
  },
  noQueue: {
    title: 'No ticket queue on this computer.',
    body: 'Ustabasi runs on the machine itself; this one does not run it.',
  },
  oldHost: {
    title: 'This computer cannot hand the log over.',
    body: 'Its daemon predates the request. Update it and the run appears here.',
  },
  offline: {
    title: 'That computer did not answer.',
    body: 'The conversation above is what the queue last wrote down.',
  },
};

/** What the run left to look at: the finished state of a screen it changed.
 *
 *  A ticket about a screen is finished when the screen is right, and nothing on
 *  this page could say whether it was. The worker leaves the picture in the
 *  run's own folder (`USTABASI_SHOTS`) and this is where it is read — beside
 *  the step that produced it, small, and full size when pressed.
 *
 *  A file on that computer, served the way every other file on it is: the
 *  panel asks the machine that holds it, with its own token.
 */
function Shots({ shots, hostKey }: { shots: RunRead['shots']; hostKey: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!shots.length) return null;
  const all: Shot[] = shots.map((s) => ({
    src: fileUrl(hostKey, s.path), download: fileUrl(hostKey, s.path, true), name: s.name,
  }));
  return (
    <div style={{ marginRight: 32, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...mono, fontSize: 11, color: C.faint }}>
        {shots.length === 1 ? 'what it looks like' : `what it looks like · ${shots.length}`}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {all.map((shot, i) => (
          <button
            key={shot.src} type="button" onClick={() => setOpen(i)} title={shot.name}
            style={{
              padding: 0, border: `1px solid ${C.border}`, borderRadius: R.card,
              background: C.surface, cursor: 'pointer', overflow: 'hidden', lineHeight: 0,
            }}
          >
            <img
              src={shot.src} alt={shot.name}
              style={{ display: 'block', maxWidth: 220, maxHeight: 160, objectFit: 'cover' }}
            />
          </button>
        ))}
      </div>
      {open != null && <Lightbox shots={all} start={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function RunLog({ run, hostKey }: { run: RunRead; hostKey?: string | null }) {
  if (run.silence) {
    const words = SILENCE[run.silence];
    return (
      <div style={{
        borderRadius: R.card, background: C.surface, border: `1px solid ${C.border}`,
        padding: 12, marginRight: 32, display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.mute }}>{words.title}</span>
        <span style={{ fontSize: 12.5, lineHeight: '18px', color: C.faint }}>{words.body}</span>
      </div>
    );
  }
  if (run.loading && !run.turns.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Spinner size={12} />
        <span style={{ ...mono, fontSize: 11, color: C.faint }}>reading the run…</span>
      </div>
    );
  }
  const shots = hostKey && run.shots.length
    ? <Shots shots={run.shots} hostKey={hostKey} />
    : null;
  // A run that printed nothing but produced a screen is still worth drawing.
  if (!run.turns.length) return shots;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {run.jumped && (
        <div style={{ ...mono, fontSize: 11, color: C.faint, textAlign: 'center' }}>
          the run moved on — this is the end of it
        </div>
      )}
      {run.turns.map((turn) => <RunTurn key={turn.id} turn={turn} />)}
      {shots}
      {run.live && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Spinner size={11} />
          <span style={{ ...mono, fontSize: 11, color: C.mute }}>working…</span>
        </div>
      )}
    </div>
  );
}

function RunTurn({ turn }: { turn: Turn }) {
  if (turn.kind === 'say') {
    return (
      <div style={{ paddingRight: 32, fontSize: 15, lineHeight: '23px', color: C.text2, minWidth: 0 }}>
        <Prose text={turn.text} />
      </div>
    );
  }
  if (turn.kind === 'thought') {
    return (
      <div style={{
        paddingRight: 32, fontSize: 13, lineHeight: '19px', color: C.mute, fontStyle: 'italic',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{turn.text}</div>
    );
  }
  if (turn.kind === 'did') return <ToolTurn turn={turn} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 32 }}>
      <span style={{ flex: 1, height: 1, background: C.border }} />
      <span style={{ ...mono, fontSize: 11, color: turn.failed ? C.danger : C.faint }}>
        {turn.failed ? 'the run stopped' : 'the run ended'}
      </span>
      <span style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

/** One tool call: its name, the one thing it was called on, and — behind the
 *  chevron — what it answered. A call with nothing attached is a call that is
 *  still running, which is the commonest thing on screen while a worker
 *  works. */
function ToolTurn({ turn }: { turn: Extract<Turn, { kind: 'did' }> }) {
  const [open, setOpen] = useState(false);
  const running = turn.output == null;
  const bad = !!turn.failed;
  const border = bad ? C.dangerLine : C.border;
  return (
    <div style={{
      borderRadius: R.card, background: C.surface, border: `1px solid ${border}`,
      marginRight: 32, overflow: 'hidden',
    }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 38,
          padding: '0 12px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}
      >
        {running ? <Spinner size={13} />
          : bad ? <Icon path={P.x} size={13} color={C.danger} width={2.6} />
          : <Icon path={P.check} size={13} color={C.ok} width={2.6} />}
        <span style={{ ...mono, fontSize: 13, color: C.mute, flexShrink: 0 }}>{turn.tool}</span>
        <span style={{
          ...mono, fontSize: 13, color: C.text2, flex: 1, textAlign: 'left',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{turn.summary}</span>
        <Icon path={open ? P.chevronDown : P.chevronRight} size={13} color={C.faint} />
      </button>
      {open && (
        <pre style={{
          ...mono, fontSize: 12, lineHeight: '18px', margin: 0, padding: '10px 12px',
          borderTop: `1px solid ${C.border}`, color: bad ? C.danger : C.mute,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto',
        }}>{turn.output ?? 'running…'}</pre>
      )}
    </div>
  );
}
