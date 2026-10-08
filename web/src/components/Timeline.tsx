import { ApprovalForm } from './ApprovalForm';
import { structuredInput, type ApprovalResponse } from '../lib/approval-input';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { C, R } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import { cost, duration, tokens, toolSummary, clock } from '../lib/format';
import type { Item } from '../lib/timeline';
import { Bubble, Prose, withSecrets } from './Bubble';
import { Lightbox, type Shot } from './Lightbox';
import { fileUrl } from '../lib/actions';
import { filedBy, type Filed } from '../lib/filed';
import { blocks, counted, langOf, tell, type Lang, type Step } from '../lib/steps';

const OK_BG = C.okBg;
const BAD_BG = C.dangerBg;

function Divider({ ts }: { ts: number }) {
  const d = new Date(ts * 1000);
  const today = new Date().toDateString() === d.toDateString();
  const label = `${today ? 'Today' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
      <div style={{ flex: 1, height: 1, background: C.border }} />
      <span style={{ fontSize: 11, color: C.faint }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

/** A picture that will not load. Shown as a picture-shaped thing, never as its
 *  file name: an `<img>` left to fail falls back to its `alt`, and a file name
 *  where a screenshot should be is the most confusing thing on the screen. */
function Missing({ name }: { name: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, textAlign: 'center',
    }}>
      <Icon path={P.image} size={20} color={C.faint} />
      <span style={{ fontSize: 11, color: C.faint, wordBreak: 'break-all' }}>{name}</span>
      <span style={{ fontSize: 10, color: C.faint }}>no longer on the computer</span>
    </div>
  );
}

/** What the phone sent up: photos, a voice note, a document. The daemon has
 *  already shrunk images and transcribed audio, so this only has to show them. */
/** Save this file, whichever computer it is on. */
function Download({ href }: { href: string }) {
  return (
    <a
      href={href} download title="Download"
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 26, height: 26, borderRadius: R.btn, flexShrink: 0,
        background: C.surface2, border: `1px solid ${C.border}`, textDecoration: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon path={P.download} size={13} color={C.mute} />
    </a>
  );
}

function Attachments({ list, hostKey }: { list: any[]; hostKey: string }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [shot, setShot] = useState<number | null>(null);
  if (!list?.length) return null;
  const media = list.filter((a) => a?.kind === 'image' || a?.kind === 'video');
  const rest = list.filter((a) => a?.kind !== 'image' && a?.kind !== 'video');
  // fileUrl needs the computer's token; if that computer is gone the bubble
  // still has to render, just without a working link. A picture is drawn from
  // the copy the daemon kept (`view`) so that it survives the original being
  // deleted; the link still opens the file the message named.
  const src = (a: any, viewing = false) => {
    try { return fileUrl(hostKey, (viewing && a.view) || a.path); } catch { return ''; }
  };
  // Saving hands over the file the message named, not the copy kept for
  // showing it — the same thing the link used to open.
  const dl = (a: any) => {
    try { return fileUrl(hostKey, a.path, true); } catch { return ''; }
  };
  const name = (a: any) => a.name ?? a.path?.split(/[/\\]/).pop() ?? 'file';

  // Every picture in this message, so one can be opened and the rest stepped
  // through without closing anything. Videos sit in the same grid but play in
  // place, so they are not part of it — hence the index of its own.
  const shots: Shot[] = [];
  const shotOf = new Map<number, number>();
  media.forEach((a, i) => {
    if (a.kind !== 'image') return;
    shotOf.set(i, shots.length);
    shots.push({ src: src(a, true), download: dl(a), name: name(a) });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: media.length || rest.length ? 8 : 0 }}>
      {media.length > 0 && (
        <div style={{
          display: 'grid', gap: 4, width: media.length > 1 ? 232 : 200,
          gridTemplateColumns: media.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
        }}>
          {media.map((a, i) => (
            <div key={i} style={{
              position: 'relative', height: media.length > 1 ? 114 : 150,
              borderRadius: R.media, overflow: 'hidden', background: C.bg,
              border: `1px solid ${C.border}`,
            }}>
              {a.kind === 'image' ? (
                broken[a.path] ? <Missing name={a.name ?? ''} /> : (
                  <button
                    type="button" title={name(a)}
                    onClick={() => setShot(shotOf.get(i) ?? 0)}
                    style={{
                      display: 'block', width: '100%', height: '100%', padding: 0,
                      border: 'none', background: 'transparent', cursor: 'zoom-in',
                    }}
                  >
                    <img
                      src={src(a, true)} alt=""
                      onError={() => setBroken((b) => ({ ...b, [a.path]: true }))}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                )
              ) : <video src={src(a, true)} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
          ))}
        </div>
      )}
      {rest.map((a, i) => (
        a.kind === 'audio' ? (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <audio src={src(a)} controls style={{ flex: 1, minWidth: 0, height: 32 }} />
              <Download href={dl(a)} />
            </div>
            {a.transcript && (
              <div style={{ fontSize: 13, lineHeight: '19px', color: C.mute }}>“{a.transcript}”</div>
            )}
          </div>
        ) : (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 4px 0 10px',
              borderRadius: R.btn, background: C.bg, border: `1px solid ${C.border}`,
              color: C.text2, maxWidth: 300,
            }}
          >
            <Icon path={P.copy} size={13} color={C.mute} />
            <a
              href={src(a)} target="_blank" rel="noreferrer" title={name(a)}
              style={{
                ...mono, fontSize: 12, flex: 1, minWidth: 0, color: 'inherit',
                textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{name(a)}</a>
            <Download href={dl(a)} />
          </div>
        )
      ))}
      {shot != null && <Lightbox shots={shots} start={shot} onClose={() => setShot(null)} />}
    </div>
  );
}

function UserBubble({ item, hostKey }: { item: Extract<Item, { kind: 'user' }>; hostKey: string }) {
  return (
    <Bubble>
      {item.queued && (
        <div style={{ ...mono, fontSize: 11, color: C.mute, marginBottom: 4 }}>queued</div>
      )}
      <Attachments list={item.attachments} hostKey={hostKey} />
      {withSecrets(item.text)}
    </Bubble>
  );
}

/** The agent named a file by its path in the text and the daemon lifted it
 *  into `attachments`; once it is a picture or a link, the path is noise. */
function stripLocalRefs(text: string, atts: any[]): string {
  if (!atts?.length) return text;
  const paths = new Set(atts.map((a) => a.path));
  return text.replace(/!?\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|((?:file:\/\/)?[^)\s]+))\s*\)/g, (m, label, angled, bare) => {
    const raw = (angled || bare || '').replace(/^file:\/\//, '');
    if (!paths.has(raw)) return m;
    return m.startsWith('!') ? '' : label;
  }).replace(/\n{3,}/g, '\n\n').trim();
}

function Assistant({ item, hostKey }: { item: Extract<Item, { kind: 'assistant' }>; hostKey: string }) {
  const atts = item.attachments ?? [];
  return (
    // `text-wrap: pretty` re-breaks the whole block to balance its last lines.
    // Worth it for a finished answer; on one still streaming it is that work
    // again for every token that arrives.
    <div style={{
      paddingRight: 32, fontSize: 15, lineHeight: '23px',
      textWrap: (item.done ? 'pretty' : 'wrap') as any,
    }}>
      <Prose text={stripLocalRefs(item.text, atts)} />
      {atts.length > 0 && <div style={{ marginTop: 8 }}><Attachments list={atts} hostKey={hostKey} /></div>}
      {!item.done && (
        <span style={{
          display: 'inline-block', width: 7, height: 15, marginLeft: 2, background: C.accent,
          verticalAlign: 'text-bottom', animation: 'rac-caret 1s step-end infinite',
        }} />
      )}
    </div>
  );
}

function Thinking({ item }: { item: Extract<Item, { kind: 'thinking' }> }) {
  return (
    <div style={{
      display: 'flex', gap: 8, paddingRight: 32, fontSize: 13, lineHeight: '19px',
      color: C.mute, fontStyle: 'italic',
    }}>
      <Icon path={P.bolt} size={13} color={C.faint} />
      <span style={{ whiteSpace: 'pre-wrap' }}>{item.text}</span>
    </div>
  );
}

/** A cheap line diff: trim the shared head and tail, call the rest changed.
 *  Enough to show what an Edit touched without pretending to be a diff engine. */
function lineDiff(oldText: string, newText: string) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return {
    context: a.slice(0, head),
    removed: a.slice(head, a.length - tail),
    added: b.slice(head, b.length - tail),
    after: a.slice(a.length - tail),
  };
}

function DiffBody({ input }: { input: any }) {
  const oldText = typeof input?.old_string === 'string' ? input.old_string : null;
  const newText = typeof input?.new_string === 'string' ? input.new_string : null;
  if (oldText == null || newText == null) return null;
  const d = lineDiff(oldText, newText);
  const row = (text: string, sign: '-' | '+' | ' ') => (
    <div style={{
      display: 'flex', gap: 10, padding: '1px 12px',
      background: sign === '-' ? BAD_BG : sign === '+' ? OK_BG : 'transparent',
      color: sign === '-' ? C.danger : sign === '+' ? C.ok : C.mute,
    }}>
      <span style={{ width: 8, flexShrink: 0, opacity: sign === ' ' ? 0 : 1 }}>{sign}</span>
      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{text || ' '}</span>
    </div>
  );
  return (
    <div style={{ ...mono, fontSize: 12, lineHeight: '18px', borderTop: `1px solid ${C.border}`, padding: '8px 0' }}>
      {d.context.slice(-2).map((l, i) => <div key={`c${i}`}>{row(l, ' ')}</div>)}
      {d.removed.map((l, i) => <div key={`r${i}`}>{row(l, '-')}</div>)}
      {d.added.map((l, i) => <div key={`a${i}`}>{row(l, '+')}</div>)}
      {d.after.slice(0, 2).map((l, i) => <div key={`f${i}`}>{row(l, ' ')}</div>)}
    </div>
  );
}

function Tool({ item }: { item: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const bad = item.isError;
  const border = bad ? C.dangerLine : C.border;
  const summary = toolSummary(item.tool, item.input);
  const isEdit = item.tool === 'Edit' || item.tool === 'Write';
  const counts = isEdit && typeof item.input?.new_string === 'string'
    ? lineDiff(String(item.input.old_string ?? ''), item.input.new_string)
    : null;

  return (
    <div style={{
      borderRadius: R.card, background: C.surface, border: `1px solid ${border}`,
      marginRight: 32, overflow: 'hidden',
    }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44,
          padding: '0 12px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}
      >
        {item.running ? <Spinner size={13} />
          : bad ? <Icon path={P.x} size={13} color={C.danger} width={2.6} />
          : <Icon path={P.check} size={13} color={C.ok} width={2.6} />}
        <span style={{ ...mono, fontSize: 13, color: C.mute, flexShrink: 0 }}>{item.tool}</span>
        <span style={{
          ...mono, fontSize: 13, color: C.text2, flex: 1, textAlign: 'left',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{summary}</span>
        {counts && (
          <span style={{ ...mono, fontSize: 11, flexShrink: 0 }}>
            <span style={{ color: C.ok }}>+{counts.added.length}</span>{' '}
            <span style={{ color: C.danger }}>−{counts.removed.length}</span>
          </span>
        )}
        {bad && (
          <span style={{
            ...mono, fontSize: 10, color: C.danger, background: BAD_BG,
            border: `1px solid ${border}`, borderRadius: R.badge, padding: '2px 6px', flexShrink: 0,
          }}>error</span>
        )}
        <Icon path={open ? P.chevronDown : P.chevronRight} size={13} color={C.faint} />
      </button>
      {open && (isEdit ? <DiffBody input={item.input} /> : (
        <pre style={{
          ...mono, fontSize: 12, lineHeight: '18px', margin: 0, padding: '10px 12px',
          borderTop: `1px solid ${C.border}`, color: bad ? C.danger : C.mute,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto',
        }}>{item.output ?? (item.running ? 'running…' : '(no output)')}</pre>
      ))}
      {!open && bad && item.output && (
        <div style={{
          ...mono, fontSize: 12, lineHeight: '18px', padding: '8px 12px',
          borderTop: `1px solid ${border}`, color: C.danger, background: BAD_BG,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 60, overflow: 'hidden',
        }}>{item.output.split('\n').slice(0, 2).join('\n')}</div>
      )}
    </div>
  );
}

function Approval({ item, onRespond }: {
  item: Extract<Item, { kind: 'approval' }>;
  onRespond: (d: 'allow' | 'allow_session' | 'deny', response?: ApprovalResponse) => unknown;
}) {
  const [error, setError] = useState('');
  async function decide(d: 'allow' | 'allow_session' | 'deny') {
    try { await onRespond(d); setError(''); } catch { setError('Could not send. Please try again.'); }
  }
  const settled = item.decision != null;
  const word = item.decision === 'allow' ? 'allowed'
    : item.decision === 'allow_session' ? 'always allowed this session'
    : item.decision === 'deny' ? 'denied'
    : item.decision === 'expired' ? 'timed out' : '';
  return (
    <div style={{
      marginRight: 32, borderRadius: R.card, background: C.surface,
      border: `1px solid ${settled ? C.border : C.warnLine}`, padding: 12,
    }}>
      {/* An answered approval drops its colour rather than fading behind it:
          the same "zero is grey" the counters follow, and at 0.7 opacity its
          own labels read at 2.6:1 on a light page. What is left saying it
          happened is the word at the end of the line. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon path={item.danger ? P.warn : P.shield} size={14}
          color={settled ? C.mute : item.danger ? C.danger : C.warn} />
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: settled ? C.mute : item.danger ? C.danger : C.warn,
        }}>
          {item.danger ? 'Dangerous command' : 'Permission needed'}
        </span>
        <span style={{ ...mono, fontSize: 12, color: C.mute }}>{item.tool}</span>
        {settled && <span style={{ marginLeft: 'auto', fontSize: 12, color: C.mute }}>{word}</span>}
      </div>
      <div style={{
        ...mono, fontSize: 12, lineHeight: '18px', background: C.bg, borderRadius: R.btn,
        border: `1px solid ${C.border}`, padding: '8px 10px', color: C.text2,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto',
      }}>{item.preview || toolSummary(item.tool, item.input)}</div>
      {item.reason && (
        <div style={{ fontSize: 12, color: C.mute, marginTop: 6 }}>{item.reason}</div>
      )}
      {error && <div role="alert">{error}</div>}
      {!settled && structuredInput(item.input) && <ApprovalForm key={item.requestId} input={item.input} onDecide={onRespond} />}
      {!settled && !structuredInput(item.input) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button type="button" onClick={() => void decide('deny')} style={btn('ghost')}>Deny</button>
          <button type="button" onClick={() => void decide('allow')} style={btn('primary')}>Allow</button>
          <button type="button" onClick={() => void decide('allow_session')} style={btn('ghost')}>
            Always allow this session
          </button>
        </div>
      )}
    </div>
  );
}

function btn(kind: 'ghost' | 'primary') {
  return {
    height: 32, padding: '0 14px', borderRadius: R.btn, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${kind === 'primary' ? C.accent : C.border}`,
    background: kind === 'primary' ? C.accent : C.surface2,
    color: kind === 'primary' ? C.onAccent : C.text,
  } as const;
}

function TurnSummary({ item }: { item: Extract<Item, { kind: 'turn' }> }) {
  const bits = [
    duration(item.durationMs),
    item.usage ? `${tokens((item.usage.input_tokens ?? 0) + (item.usage.output_tokens ?? 0))} token` : null,
    cost(item.costUsd),
    item.stopReason && item.stopReason !== 'end_turn' ? item.stopReason : null,
  ].filter(Boolean);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.faint }}>
      <div style={{ width: 24, height: 1, background: C.border }} />
      <Icon path={P.clock} size={12} color={C.faint} />
      <span style={{ ...mono, fontSize: 11 }}>{bits.join('  ·  ')}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function Failure({ item }: { item: Extract<Item, { kind: 'error' }> }) {
  return (
    <div style={{
      marginRight: 32, borderRadius: R.card, background: BAD_BG,
      border: `1px solid ${C.dangerLine}`, padding: '10px 12px',
      display: 'flex', gap: 8, alignItems: 'flex-start',
    }}>
      <Icon path={P.warn} size={14} color={C.danger} />
      <div style={{ fontSize: 13, lineHeight: '19px', color: C.danger, whiteSpace: 'pre-wrap' }}>
        {item.message}
      </div>
    </div>
  );
}

type Respond = (requestId: string, d: 'allow' | 'allow_session' | 'deny', response?: ApprovalResponse) => unknown;

/** One thing in the conversation, and the only part of it that redraws.
 *
 *  A streaming turn changes exactly one item several times a second; folding
 *  an event returns the same object for every item it did not touch. Without
 *  this, all of them re-rendered anyway — every tool card re-diffed, every
 *  answer re-parsed its Markdown, thousands of nodes reconciled per token —
 *  and a long chat simply stopped answering the mouse. That is the panel that
 *  "freezes" and wants a refresh: the refresh does not fix anything, it just
 *  gives it a shorter conversation to redraw.
 */
/** A card the conversation filed, as the small link under the message that
 *  filed it: which column it is in and its title, and a press opens it. */
export interface TicketLink {
  open: (id: number) => void;
  /** What the board says about that ticket now, where it has a card for it. */
  describe: (id: number) => { column: string; title: string } | null;
}

function CardLink({ filed, link }: { filed: Filed; link: TicketLink }) {
  const known = link.describe(filed.id);
  return (
    <a href={`#ticket-${filed.id}`} className="dv-glass dv-cardlink" data-ticket={filed.id}
      onClick={(e) => { e.preventDefault(); link.open(filed.id); }}>
      <span className="dv-meta">{known?.column ?? 'Queued'}</span>
      <span className="t">{known?.title ?? filed.title}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </a>
  );
}

const Row = memo(function Row({ item, prevTs, hostKey, onRespond }: {
  item: Exclude<Item, Step>; prevTs: number | null; hostKey: string; onRespond: Respond;
}) {
  const gap = prevTs == null || item.ts - prevTs > 1800;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {gap && <Divider ts={item.ts} />}
      {item.kind === 'user' && <UserBubble item={item} hostKey={hostKey} />}
      {item.kind === 'assistant' && <Assistant item={item} hostKey={hostKey} />}
      {item.kind === 'approval' && (
        <Approval item={item} onRespond={(d, response) => onRespond(item.requestId, d, response)} />
      )}
      {item.kind === 'turn' && <TurnSummary item={item} />}
      {item.kind === 'error' && <Failure item={item} />}
    </div>
  );
});

/** Everything the agent did between two things it said, as one quiet line.
 *
 *  The sentence is `lib/steps.ts`; the cards it stands for are behind the
 *  chevron. A card this run filed stays out in the open under the line: it is
 *  a result, not a step.
 *
 *  Redrawn only when one of its own steps changed. The run is a new array on
 *  every fold, so it is compared step by step: a streaming answer further
 *  down must not re-diff forty cards a second.
 */
const Steps = memo(function Steps({ steps, live, lang, prevTs, link }: {
  steps: Step[]; live: boolean; lang: Lang; prevTs: number | null; link: TicketLink | null;
}) {
  const [open, setOpen] = useState(false);
  const told = tell(steps, live, lang);
  const gap = prevTs == null || steps[0].ts - prevTs > 1800;
  const filed = link ? steps.flatMap((s) => {
    const f = s.kind === 'tool' && !s.isError ? filedBy(s.output) : null;
    return f ? [f] : [];
  }) : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-steps={steps.length}>
      {gap && <Divider ts={steps[0].ts} />}
      <button
        type="button" className="dv-hit" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%',
          minHeight: 28, padding: '0 8px 0 0', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', color: C.mute, fontSize: 13, lineHeight: '19px',
        }}
      >
        {live ? <Spinner size={13} /> : <Icon path={P.check} size={13} color={C.faint} width={2.6} />}
        <span style={{
          minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: live ? C.text2 : C.mute,
        }}>{told.text}</span>
        {told.count > 1 && (
          <span style={{ flexShrink: 0, color: C.faint }}>· {counted(told.count, lang)}</span>
        )}
        <Icon path={open ? P.chevronDown : P.chevronRight} size={12} color={C.faint} />
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((s) => (s.kind === 'tool' ? <Tool key={s.id} item={s} /> : <Thinking key={s.id} item={s} />))}
        </div>
      )}
      {!!link && filed.map((f) => <CardLink key={f.id} filed={f} link={link} />)}
    </div>
  );
}, (a, b) => a.live === b.live && a.lang === b.lang && a.prevTs === b.prevTs && a.link === b.link
  && a.steps.length === b.steps.length && a.steps.every((s, i) => s === b.steps[i]));

export function Timeline({ items, hostKey, onRespond, tickets, busy = false }: {
  items: Item[];
  hostKey: string;
  onRespond: Respond;
  /** Where a card this conversation filed is opened. Absent, no link is drawn. */
  tickets?: TicketLink | null;
  /** A turn is running: the last run of steps is still going, even in the
   *  moment between one tool finishing and the next one starting. */
  busy?: boolean;
}) {
  const ticketsNow = useRef(tickets);
  ticketsNow.current = tickets;
  const link = useMemo<TicketLink | null>(() => (tickets ? {
    open: (id) => ticketsNow.current?.open(id),
    describe: (id) => ticketsNow.current?.describe(id) ?? null,
  } : null), [!!tickets]);
  // The handler is rebuilt on every render of the screen above; a row must not
  // redraw because of that, so what the rows hold is a stable stand-in for it.
  const latest = useRef(onRespond);
  latest.current = onRespond;
  const respond = useCallback<Respond>((rid, d, response) => latest.current(rid, d, response), []);

  const rows = useMemo(() => blocks(items), [items]);
  const lang = useMemo(() => langOf(items), [items]);

  // `anywhere`, not `break-word`: a link or a path with no space in it has to
  // be allowed to break, or it is the width of the whole conversation and the
  // chat scrolls sideways under it.
  let prevTs: number | null = null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, overflowWrap: 'anywhere' }}>
      {rows.map((b, i) => {
        const before = prevTs;
        if (b.kind === 'steps') {
          prevTs = b.steps[b.steps.length - 1].ts;
          const live = b.steps.some((s) => s.kind === 'tool' && s.running)
            || (busy && i === rows.length - 1);
          return <Steps key={b.id} steps={b.steps} live={live} lang={lang} prevTs={before} link={link} />;
        }
        prevTs = b.item.ts;
        return <Row key={b.item.id} item={b.item} hostKey={hostKey} onRespond={respond} prevTs={before} />;
      })}
    </div>
  );
}

export { clock };
