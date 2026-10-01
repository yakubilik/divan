/** One card: what a person wrote, what is happening to it, and — a press away —
 *  what the agent was told.
 *
 *  Web14 W8 is this page, and the desktop is why it is one page: on a phone the
 *  human face, the agent brief and the live log are three screens you swipe
 *  between, and here they are the left column, a shut row under it and the right
 *  column. Left: what a person wrote, in the fixed box the frame draws, cut to a
 *  paragraph with the rest on a press. Right: the details panel and the live log
 *  with its one-line input.
 *
 *  **The agent's half is shut.** It used to be open, and the page that made was
 *  the same paragraph three times down one screen: the sentences a person wrote,
 *  the goal the worker was given, and the log repeating it back. The brief is
 *  written for the worker, so it is a detail of the card rather than the subject
 *  of the page, and it is behind `Agent instructions`.
 *
 *  **No agent text on the human face.** The daemon keeps the two apart on the
 *  wire — the board's cards carry `title` and `summary` and the marks, and
 *  `divan.card.get` is the one answer with both faces — and this page keeps them
 *  apart on screen: the box is `human()`, which reads those two fields and
 *  nothing else, and the brief is `brief()`, which reads the other six. A card
 *  nobody has written sentences for says so in the box rather than borrowing the
 *  goal, because a box filled with the agent's goal reads perfectly well and is
 *  the wrong text. Both are `lib/ticket.ts`.
 *
 *  The brief arrives from the machine that holds the card, so it is asked for
 *  when the page opens and again when the board says the card has changed. Until
 *  it comes the page is the human face and the details, which are already in
 *  hand: a screen that waited for a second request to draw the first sentence
 *  would be a spinner over a card you can already read. A machine that cannot be
 *  reached says so where the brief would have been.
 *
 *  Two things the frame draws and this page does not: the chevron on the column
 *  pill, because the column is what a *board* writes and dragging a card is how
 *  it is written (`divan.card.move` is the board's request, and a second place to
 *  move a card from would be a second place to keep in step), and the link and
 *  ellipsis in the corner, which stand for nothing this end can do yet.
 */
import { useEffect, useRef, useState } from 'react';
import { cardGet, setExecutor, ticketNote, updateCard } from '../lib/actions';
import { COLUMN_LABEL, executorWord } from '../lib/overview';
import { uptime } from '../lib/format';
import { brief, details, human, live, liveHead, nowMark, sayTo } from '../lib/ticket';
import { executorFace } from '../lib/sessions';
import { useRun } from '../lib/run';
import { RunLog } from '../components/RunLog';
import { RADIUS, SHADOW, STATE_MARK, STATE_TONE, T, stateColour } from '../lib/theme';
import { useDivanStore, type MergedCard, type MergedProject } from '../lib/divan';
import type { DivanCardFull, DivanExecutor } from '../lib/protocol';
import type { Ticket as QueueTicket } from '../lib/ustabasi';
import {
  Card, Composer, ExecutorBadge, FieldRow, Monogram, Pill, StampRow, StatusDot, Tag,
} from '../ui/divan';
import { mono } from '../ui/kit';

/** What came back from the machine that holds the card, and nothing invented
 *  while it is on its way. */
export interface Opened {
  full: DivanCardFull | null;
  ticket: QueueTicket | null;
  error: string | null;
}

const NOTHING: Opened = { full: null, ticket: null, error: null };

/** How much of the sentences under the title a page opens on. Seven lines is a
 *  paragraph — enough to be the subject of the page, short enough that what is
 *  under it is still on the screen. */
const SUMMARY_LINES = 7;

export interface TicketProps {
  card: MergedCard;
  project: MergedProject | null;
  index: number;
  now: number;
  onProject: () => void;
  onBranch: (kind: string) => void;
}

/** The page, and the one request it makes. Asked for when the page opens and
 *  again when the board says the card has moved on: the live half of a ticket
 *  goes stale in a minute, and the board is re-read on its own timer. */
export function Ticket(props: TicketProps) {
  const { card } = props;
  const [got, setGot] = useState<Opened>(NOTHING);

  useEffect(() => {
    let mine = true;
    setGot((was) => ({ ...was, error: null }));
    cardGet(card.host, card.id)
      .then((answer) => {
        if (!mine) return;
        setGot({ full: answer?.card ?? null, ticket: answer?.ticket ?? null, error: null });
      })
      .catch((e) => {
        if (!mine) return;
        setGot({ full: null, ticket: null, error: e?.message ?? 'That did not reach the computer' });
      });
    return () => { mine = false; };
  }, [card.host, card.id, card.updated_at]);

  return <TicketPage {...props} opened={got} />;
}

/** …and the page itself, which is a render of what is in hand and nothing else:
 *  the human face and the marks are on the board's own card, and the brief and
 *  the live half are whatever the machine has handed over so far. Until it does,
 *  this is the card a person can already read rather than a spinner over it. */
export function TicketPage({
  card, project, index, now, onProject, onBranch, opened: got = NOTHING,
}: TicketProps & { opened?: Opened }) {
  /** The brief starts shut. It is six blocks of mono written for the worker,
   *  and open by default it was the loudest thing on a page whose subject is
   *  the sentence a person wrote at the top: three copies of the same text
   *  down one screen. It is a detail of the card, so it is behind a press. */
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  /** A card is written on from here now — the title, the sentences under it,
   *  and who does it. What was typed is kept until the board comes back with
   *  it: the boards are re-read on a slow timer, and a title that snapped back
   *  to the old one for two seconds reads as an edit that did not take. */
  const [wrote, setWrote] = useState<{ title?: string; summary?: string }>({});
  const [handing, setHanding] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** The sentences under the title are what the page is *about*, and on a
   *  well-written ticket they run to a screenful. Cut to a paragraph with the
   *  rest a press away: a page that opens on six hundred characters of grey is
   *  one nobody reads the first line of. `long` is what the box measured, so
   *  the press is only there on a card that actually has more. */
  const [whole, setWhole] = useState(false);
  const [long, setLong] = useState(false);

  /** Write one face of the card, and ask that machine for the board again so
   *  everything else drawn from it catches up. */
  const write = async (fields: { title?: string; summary?: string }) => {
    setFailed(null);
    setWrote((was) => ({ ...was, ...fields }));
    try {
      await updateCard(card.host, card.id, fields);
      void useDivanStore.getState().load(card.host);
    } catch (e: any) {
      setWrote({});
      setFailed(e?.message ?? 'That did not reach the computer');
    }
  };

  const hand = async (executor: DivanExecutor | null) => {
    setFailed(null);
    setHanding(false);
    try {
      await setExecutor(card.host, card.id, executor);
      void useDivanStore.getState().load(card.host);
    } catch (e: any) {
      setFailed(e?.message ?? 'That did not reach the computer');
    }
  };

  const face = human(card);
  const said = brief(got.full, got.ticket);
  const mark = nowMark(card.agent_status);
  const column = COLUMN_LABEL.find((c) => c.key === card.column);
  const placeholder = sayTo(card);

  const say = async (words: string) => {
    if (card.ustabasi_id == null) return;
    setSent(null);
    try {
      const answer = await ticketNote(card.host, card.ustabasi_id, words);
      setSent(answer?.message || 'Sent.');
    } catch (e: any) {
      setSent(e?.message ?? 'That did not reach the computer');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1, minHeight: 0 }}>
      {/* Where this card is: the product, its board, the face it is on. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: T.ink2,
      }}>
        <Monogram name={project?.name ?? card.machine} index={index} size={20} />
        <Crumb label={project?.name ?? card.machine} onClick={onProject} />
        <span style={{ color: T.ink3 }}>/</span>
        <Crumb label={card.branch || 'engineering'} onClick={() => onBranch(card.branch)} />
        {/* The frame ends the crumb on the ticket's number. A card no ticket was
            filed for has none, and the card's own id is a word nobody reads —
            so the crumb ends on the face it is on. */}
        {card.ustabasi_id != null && (
          <>
            <span style={{ color: T.ink3 }}>/</span>
            <span style={{
              ...mono, flex: 'none', fontSize: 12, fontWeight: 600, color: T.ink,
              background: T.s2, padding: '3px 7px', borderRadius: 6, whiteSpace: 'nowrap',
            }}>#{card.ustabasi_id}</span>
          </>
        )}
        <span style={{ ...mono, marginLeft: 'auto', fontSize: 12, color: T.ink3 }}>
          {card.machine}{card.stale ? ' · not answering' : ''}
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 32,
        flex: 1, minHeight: 0,
      }}>
        {/* ── the human face, and the brief under it ── */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, minHeight: 0,
          overflowY: 'auto',
        }}>
          <Writable
            value={wrote.title ?? face.title} label="the card's title"
            onSave={(text) => write({ title: text })}
            style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-.02em' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Pill face="ink" label={column?.label ?? card.column} />
            {!!mark && <Tag mark={STATE_MARK[mark.state]} label={mark.label}
              tone={STATE_TONE[mark.state]} />}
            <span style={{ ...mono, fontSize: 12, color: T.ink3, whiteSpace: 'nowrap' }}>
              #{card.position + 1} in column
            </span>
          </div>
          {/* 660 and not 720: at seventeen point the wider box ran past eighty
              characters a line, which is past where an eye finds the next one
              without help. */}
          <Card radius={RADIUS.tile} style={{ maxWidth: 660, padding: '16px 18px 12px' }}>
            <Writable
              value={wrote.summary ?? (face.bare ? '' : face.summary)}
              placeholder="Nobody has written the sentences for this one yet."
              label="what this card is about" multiline
              onSave={(text) => write({ summary: text })}
              style={{ fontSize: 17, lineHeight: '26px', minHeight: 78 }}
              clamp={whole ? null : SUMMARY_LINES}
              onOverflow={setLong}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, ...mono, fontSize: 11, color: T.ink3,
              borderTop: `1px solid ${T.line}`, paddingTop: 8, marginTop: 6,
            }}>
              <span style={{
                minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{face.label}</span>
              {long && (
                <button type="button" onClick={() => setWhole((w) => !w)}
                  style={{
                    flex: 'none', background: 'transparent', border: 'none', padding: 0,
                    font: 'inherit', color: T.ink2, cursor: 'pointer',
                  }}>{whole ? 'less' : 'read all'}</button>
              )}
              <span style={{ marginLeft: 'auto', flex: 'none', paddingLeft: 8 }}>{face.count}</span>
            </div>
          </Card>

          {/* The agent's half of the card, shut. A card nobody wrote a brief for
              and a machine that would not hand one over are both a quiet line
              rather than a heading over an explanation: neither is something
              the reader of this page has to do anything about. */}
          {got.error ? (
            <div style={{ ...mono, fontSize: 11.5, lineHeight: 1.5, color: T.ink3 }}>
              {card.machine} did not hand the agent instructions over: {got.error}
            </div>
          ) : said.empty ? (
            <div style={{ ...mono, fontSize: 11.5, lineHeight: 1.5, color: T.ink3 }}>
              no agent instructions on this one yet
            </div>
          ) : (
            <Disclosure
              label="Agent instructions"
              note={`${said.lines} line${said.lines === 1 ? '' : 's'}`}
              open={open} onToggle={() => setOpen((o) => !o)}
            />
          )}
          {open && !got.error && !said.empty && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16,
              ...mono, fontSize: 12.5, lineHeight: 1.6,
            }}>
              {!!said.goal && <Block label="GOAL">{said.goal}</Block>}
              {!!said.criteria.length && (
                <Block label={`DONE WHEN${said.passed ? ` · ${said.passed}` : ''}`}>
                  {said.criteria.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6 }}>
                      <span style={{
                        flex: 'none',
                        color: c.met == null ? T.ink3 : c.met ? T.run : T.red,
                      }}>{c.met == null ? '○' : c.met ? '✓' : '✗'}</span>
                      <span style={{ minWidth: 0 }}>{c.text}</span>
                    </div>
                  ))}
                </Block>
              )}
              {!!said.verify && (
                <Block label="TEST">
                  <div style={{ background: T.s2, borderRadius: 9, padding: '8px 10px' }}>
                    {said.verify}
                  </div>
                </Block>
              )}
              {(!!said.constraints.length || !!said.paths.length || !!said.notes) && (
                <Block label="CONSTRAINTS · FILES">
                  {said.constraints.map((c, i) => <div key={i}>{c}</div>)}
                  {said.paths.map((f) => (
                    <div key={f} style={{ color: T.ink2 }}>{f}</div>
                  ))}
                  {!!said.notes && <div style={{ color: T.ink2 }}>{said.notes}</div>}
                </Block>
              )}
            </div>
          )}
        </div>

        {/* ── the details, and the live half ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
          <Card radius={RADIUS.tile} inset={false} style={{ padding: '4px 16px', position: 'relative' }}>
            {handing && <Hands current={card.executor} onPick={(x) => void hand(x)} />}
            {details(card, project, now, uptime).map((d, i) => (
              <FieldRow key={d.label} label={d.label} value={d.value} note={d.note}
                first={i === 0}
                lead={d.label === 'Executor'
                  ? <ExecutorBadge executor={executorFace(card)} size={22} />
                  : undefined}
                onClick={d.label === 'Executor' ? () => setHanding((h) => !h) : undefined}
                title={d.label === 'Executor' ? 'Hand this card to somebody else' : undefined} />
            ))}
            {!!failed && (
              <div style={{ ...mono, fontSize: 11, color: T.red, padding: '0 0 10px' }}>{failed}</div>
            )}
          </Card>
          <Live card={card} ticket={got.ticket} now={now} placeholder={placeholder} sent={sent}
            onSay={say} />
        </div>
      </div>
    </div>
  );
}

/** A step of the breadcrumb that goes back up one. */
function Crumb({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`Everything on ${label}`}
      style={{
        background: 'transparent', border: 'none', padding: 0, font: 'inherit',
        color: T.ink2, cursor: 'pointer', maxWidth: 240, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</button>
  );
}

/** A shut thing, and the press that opens it.
 *
 *  Not a section heading with a button on the end: a heading is a claim that
 *  what follows is part of the page, and this is a part of the *card* that most
 *  readings of the page do not want. So it is one quiet row the width of its
 *  own words — a caret, what it is, and how much of it there is — and the page
 *  under it stays the sentence somebody wrote. */
function Disclosure({ label, note, open, onToggle }: {
  label: string;
  note?: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button" onClick={onToggle} aria-expanded={open}
      title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
        padding: '6px 12px 6px 10px', borderRadius: RADIUS.chip,
        background: 'transparent', border: `1px solid ${T.line}`,
        font: 'inherit', fontSize: 13, fontWeight: 500, color: T.ink2, cursor: 'pointer',
      }}
    >
      <span style={{
        ...mono, flex: 'none', fontSize: 9, color: T.ink3,
        transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s',
      }}>▶</span>
      {label}
      {!!note && <span style={{ ...mono, fontSize: 11, color: T.ink3 }}>{note}</span>}
    </button>
  );
}

/** One block of the brief: its name in mono capitals, and what it says under. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...mono, fontSize: 10.5, fontWeight: 600, color: T.ink3, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

/** The log in the corner, and the one line you can say into it.
 *
 *  Two things, in the order they are read in. First the conversation the wall
 *  reads (`lib/ustabasi.ts`), cut to what there is room for and stamped: what
 *  was asked for, what came back, where it stands. Then, under it, what the
 *  worker is printing *right now* — the model's own stream, the same reading
 *  the wall's ticket window and the phone both use (`lib/run.ts`), because a
 *  box labelled Live that said `running 1h 12m` and nothing else was a box that
 *  told you the one thing you already knew.
 *
 *  A card with no ticket behind it has no worker listening, and the box says so
 *  instead of pretending to send. */
function Live({ card, ticket, now, placeholder, sent, onSay }: {
  card: MergedCard;
  ticket: QueueTicket | null;
  now: number;
  placeholder: string | null;
  sent: string | null;
  onSay: (words: string) => void;
}) {
  const head = liveHead(ticket, now, uptime);
  const lines = live(ticket);
  const [words, setWords] = useState('');
  const run = useRun(card.host, card.ustabasi_id);
  const foot = useRef<HTMLDivElement | null>(null);
  // The end of a run is the part being read, and it is written to while it is
  // being read. Only ever scrolled for somebody already at the bottom of it.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) foot.current?.scrollIntoView();
  }, [run.turns.length, run.live]);
  return (
    <Card radius={RADIUS.tile} style={{ padding: '12px 14px', gap: 4, flex: 1, minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
        marginBottom: 4,
      }}>
        <StatusDot state={head.state === 'quiet' ? T.line2 : head.state} />
        Live
        <span style={{
          ...mono, marginLeft: 'auto', flex: 'none', fontSize: 11,
          color: head.state === 'quiet' ? T.ink3 : stateColour(head.state),
          whiteSpace: 'nowrap',
        }}>{head.note}</span>
      </div>
      <div
        ref={scroller}
        style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0, overflowY: 'auto' }}
      >
        {lines.length ? lines.map((l, i) => (
          <StampRow key={i} code at={l.at} text={l.text} tone={l.tone} />
        )) : (
          <div style={{ fontSize: 13, lineHeight: 1.45, color: T.ink2 }}>
            {card.ustabasi_id == null
              ? 'Nothing runs on this card yet. Moving it into In Progress with a coding agent on it'
                + ' is what starts a worker.'
              : `Nothing has come back from ${card.machine} about this ticket yet.`}
          </div>
        )}
        {card.ustabasi_id != null && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
            <RunLog run={run} />
          </div>
        )}
        <div ref={foot} />
      </div>
      {!!sent && (
        <div style={{ ...mono, fontSize: 11, color: T.ink3, paddingTop: 6 }}>{sent}</div>
      )}
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        {placeholder
          ? (
            <Composer
              placeholder={placeholder} value={words} onChange={setWords}
              // The box is inside the card the log is in, so it carries the
              // card's padding rather than the panel's own margin.
              style={{ margin: 0 }}
              onSend={() => {
                const text = words.trim();
                if (!text) return;
                setWords('');
                onSay(text);
              }}
            />
          )
          : (
            <div style={{ ...mono, fontSize: 11, lineHeight: 1.5, color: T.ink3 }}>
              no ticket behind this card, so there is nothing to send an answer to
            </div>
          )}
      </div>
    </Card>
  );
}

/** A card's face, written in place.
 *
 *  A board where a card can be dragged but not corrected is a board people keep
 *  a second list beside. So the title and the sentences under it are fields:
 *  press, type, Enter — or ⌘Enter where there are several lines — and Escape
 *  puts back what was there. Nothing else about a card is writable from here;
 *  the column is the drag and the executor is the row in the panel, each with a
 *  request of its own.
 *
 *  It reads as text until it is pressed, because that is what the frames draw:
 *  no box, no pencil, nothing that says "form". */
function Writable({ value, placeholder, label, multiline, onSave, style, clamp, onOverflow }: {
  value: string;
  placeholder?: string;
  /** What is being written, for a reader who cannot see which line was
   *  pressed: "the card's title". */
  label: string;
  multiline?: boolean;
  onSave: (text: string) => void;
  style?: React.CSSProperties;
  /** How many lines of it to draw before cutting it off. Only ever the read
   *  view — what is being typed is never hidden from the person typing it. */
  clamp?: number | null;
  /** Said when there is more text than `clamp` lines will hold, so whatever
   *  drew this can offer the press that opens it. */
  onOverflow?: (over: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const field = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const view = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (!editing) setText(value); }, [value, editing]);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!onOverflow || !clamp) return;
    const el = view.current;
    // Measured rather than counted: where the cut lands depends on the width
    // the column ended up at, which no length of string knows.
    onOverflow(!!el && el.scrollHeight - el.clientHeight > 1);
  }, [value, clamp, editing, onOverflow]);

  const done = () => {
    const words = text.trim();
    setEditing(false);
    if (words === value.trim()) return;
    onSave(words);
  };
  const stop = () => { setText(value); setEditing(false); };

  const shared: React.CSSProperties = {
    ...style, width: '100%', boxSizing: 'border-box', margin: 0,
    background: T.s2, color: T.ink, borderRadius: 10, padding: '6px 8px',
    border: 'none', outline: 'none', font: 'inherit', resize: 'none' as const,
  };

  if (editing) {
    return multiline ? (
      <textarea
        ref={field as any} value={text} aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); stop(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(); }
        }}
        rows={3}
        style={shared}
      />
    ) : (
      <input
        ref={field as any} type="text" value={text} aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); stop(); }
          if (e.key === 'Enter') { e.preventDefault(); done(); }
        }}
        style={shared}
      />
    );
  }

  return (
    <button
      ref={view}
      type="button" onClick={() => setEditing(true)} title={`Write ${label}`}
      style={{
        ...style, width: '100%', textAlign: 'left', background: 'transparent',
        border: 'none', padding: 0, font: 'inherit', cursor: 'text',
        color: value ? (style?.color ?? T.ink) : T.ink3,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        ...(clamp
          ? {
              display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }
          : null),
      }}
    >{value || placeholder || `Write ${label}`}</button>
  );
}

/** Who a card can be handed to. The five the board knows, and `Nobody`, which
 *  is a value rather than the absence of one: a card whose agent was the wrong
 *  guess goes back to having none, not to having a person on it.
 *
 *  A branch agent is named by its branch, so it is not offered here — that is
 *  what the branch page is for. */
const HANDS: { executor: DivanExecutor | null; face: string }[] = [
  { executor: 'coding_agent', face: 'coder' },
  { executor: 'assistant', face: 'research' },
  { executor: 'human', face: 'you' },
  { executor: null, face: 'unassigned' },
];

function Hands({ current, onPick }: {
  current: DivanExecutor | null;
  onPick: (executor: DivanExecutor | null) => void;
}) {
  return (
    <div
      role="listbox" aria-label="Who does this one"
      style={{
        position: 'absolute', top: 44, left: 12, right: 12, zIndex: 5,
        background: T.s2, borderRadius: RADIUS.tab, boxShadow: SHADOW.drawer,
        padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
      }}
    >
      {HANDS.map((h) => {
        const on = h.executor === current;
        return (
          <button
            key={h.face} type="button" role="option" aria-selected={on}
            onClick={() => onPick(h.executor)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '6px 8px', borderRadius: RADIUS.mark, border: 'none', font: 'inherit',
              textAlign: 'left', cursor: 'pointer', color: T.ink,
              background: on ? T.s1 : 'transparent',
            }}
          >
            <ExecutorBadge executor={h.face} size={20} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: on ? 600 : 500 }}>
              {executorWord(h.executor)}
            </span>
            {on && <span style={{ ...mono, fontSize: 11, color: T.ink3 }}>on</span>}
          </button>
        );
      })}
    </div>
  );
}
