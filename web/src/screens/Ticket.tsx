/** One card, with all three of its faces on screen at once.
 *
 *  Web14 W8 is this page, and the desktop is why it is one page: on a phone the
 *  human face, the agent brief and the live log are three screens you swipe
 *  between, and here they are the left column, the block under it and the right
 *  column. Left: what a person wrote, in the fixed box the frame draws, with the
 *  brief open below it. Right: the details panel and the live log with its
 *  one-line input.
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
import { useEffect, useState } from 'react';
import { cardGet, ticketNote } from '../lib/actions';
import { COLUMN_LABEL } from '../lib/overview';
import { uptime } from '../lib/format';
import { brief, details, human, live, liveHead, nowMark, sayTo } from '../lib/ticket';
import { executorFace } from '../lib/sessions';
import { RADIUS, STATE_MARK, T, stateColour } from '../lib/theme';
import type { MergedCard, MergedProject } from '../lib/divan';
import type { DivanCardFull } from '../lib/protocol';
import type { Ticket as QueueTicket } from '../lib/ustabasi';
import {
  Card, Composer, ExecutorBadge, FieldRow, Monogram, Pill, SectionHeader, StampRow, StatusDot, Tag,
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
  const [open, setOpen] = useState(true);
  const [sent, setSent] = useState<string | null>(null);

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
        <span style={{ color: T.ink3 }}>/</span>
        <span style={{
          ...mono, flex: 'none', fontSize: 12, fontWeight: 600, color: T.ink,
          background: T.s2, padding: '3px 7px', borderRadius: 6, whiteSpace: 'nowrap',
        }}>{card.ustabasi_id == null ? card.id.slice(0, 8) : `#${card.ustabasi_id}`}</span>
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
          <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-.02em' }}>
            {face.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Pill face="ink" label={column?.label ?? card.column} />
            {!!mark && <Tag mark={STATE_MARK[mark.state]} label={mark.label}
              tone={mark.state === 'stuck' ? 'red' : mark.state === 'asking' ? 'amber' : 'run'} />}
            <span style={{ ...mono, fontSize: 12, color: T.ink3, whiteSpace: 'nowrap' }}>
              #{card.position + 1} in column
            </span>
          </div>
          <Card radius={RADIUS.tile} style={{ maxWidth: 720, padding: '16px 18px 12px' }}>
            <div style={{ fontSize: 17, lineHeight: '26px', minHeight: 78, color: face.bare ? T.ink3 : T.ink }}>
              {face.bare
                ? 'Nobody has written the sentences for this one yet.'
                : face.summary}
            </div>
            <div style={{
              display: 'flex', ...mono, fontSize: 11, color: T.ink3,
              borderTop: `1px solid ${T.line}`, paddingTop: 8, marginTop: 6,
            }}>
              <span style={{
                minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{face.label}</span>
              <span style={{ marginLeft: 'auto', flex: 'none', paddingLeft: 8 }}>{face.count}</span>
            </div>
          </Card>

          <SectionHeader
            title="Agent brief"
            note={got.error ? card.machine
              : said.empty ? 'nothing written on this face'
              : `${said.lines} line${said.lines === 1 ? '' : 's'}`}
          >
            {!said.empty && !got.error && (
              <button type="button" onClick={() => setOpen((o) => !o)}
                style={{
                  marginLeft: 'auto', background: 'transparent', border: 'none', padding: 0,
                  font: 'inherit', fontSize: 13, fontWeight: 500, color: T.ink, cursor: 'pointer',
                }}>{open ? 'Collapse' : 'Open'}</button>
            )}
          </SectionHeader>
          {got.error ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>
              {card.machine} did not hand the brief over: {got.error}
            </div>
          ) : said.empty ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2 }}>
              This card is a line somebody wrote down. A goal, what done means and a test are
              written on it when there is an agent to hand it to.
            </div>
          ) : open && (
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
          <Card radius={RADIUS.tile} inset={false} style={{ padding: '4px 16px' }}>
            {details(card, project, now, uptime).map((d, i) => (
              <FieldRow key={d.label} label={d.label} value={d.value} note={d.note}
                first={i === 0}
                lead={d.label === 'Executor'
                  ? <ExecutorBadge executor={executorFace(card)} size={22} />
                  : undefined} />
            ))}
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
 *  It is the conversation the wall reads (`lib/ustabasi.ts`), cut to what there
 *  is room for and stamped: the ticket is the card that opened it, what came
 *  back, and where it stands now. The whole run — everything the worker printed
 *  — is the wall's, and this page does not open it: a second reader of the same
 *  stream is a second thing to keep in step.
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0, overflowY: 'auto' }}>
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
