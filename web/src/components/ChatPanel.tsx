/** A chat you started from the bar, open on the Dashboard.
 *
 *  It is the other half of `lib/tell.ts`: a sentence typed into the command bar
 *  becomes a chat, and a chat started that way is read where it was started.
 *  The window is the design system's own (`Panel`, `PanelHead`, `Composer` —
 *  Web12 W1's bottom right corner), and what is inside it is the panel's real
 *  timeline: the same rows, the same tool calls, the same approvals the chat
 *  screen draws, because half a chat is the thing that sends you to the other
 *  screen anyway.
 *
 *  Unlike the question windows beside it (`Sessions.tsx`), this **is** a chat:
 *  it is in the Chat place's list from the moment it exists, and closing it
 *  here only closes the window.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { interrupt, respond, send, updateChat, upload } from '../lib/actions';
import { useFleet } from '../lib/fleet';
import { clock } from '../lib/format';
import {
  FIELDS, FIELD_LABEL, fieldChip, fieldRows, fieldValue, type Field, type FieldRow,
} from '../lib/fields';
import { RADIUS, SHADOW, T, type Tone } from '../lib/theme';
import { inView, type Place, type Told } from '../lib/tell';
import { emptyLog, logKey, useLogs } from '../lib/timeline';
import { ExecutorBadge, HeadGlyph, Panel, PanelHead } from '../ui/divan';
import { mono } from '../ui/kit';
import { ChatComposer } from './ChatComposer';
import { Timeline } from './Timeline';

/** What the head says the chat is doing, in the words the other windows use. */
function doing(status: string | null, busy: boolean): { badge: string | null; tone: Tone } {
  if (status === 'awaiting_approval') return { badge: 'asks you', tone: 'amber' };
  if (status === 'running' || busy) return { badge: 'working', tone: 'run' };
  return { badge: null, tone: 'ink3' };
}

export function ChatPanel({ told, place, onPlace, big, onBig, onMinimise, onClose }: {
  told: Told;
  /** Where this window stands and how big it is — the dock's own slot until
   *  somebody drags it somewhere else. */
  place: Place;
  onPlace: (place: Place) => void;
  /** Standing in the middle of the screen instead of in the corner: the same
   *  chat, with room to read it. */
  big?: boolean;
  onBig?: (big: boolean) => void;
  onMinimise: () => void;
  onClose: () => void;
}) {
  const slot = useFleet((s) => s.hosts[told.host]);
  const chat = useMemo(
    () => slot?.chats.find((c) => c.id === told.chatId) ?? null,
    [slot?.chats, told.chatId],
  );
  const log = useLogs((s) => s.logs[logKey(told.host, told.chatId)]) ?? emptyLog();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Field | null>(null);
  const foot = useRef<HTMLDivElement | null>(null);
  /** The screen, for the window that is standing in the middle of it. */
  const [view, setView] = useState(() => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));
  useEffect(() => {
    if (!big) return;
    const measure = () => setView({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [big]);

  // The timeline is asked for on the way in, and again the moment that
  // computer answers after a silence: the live feed only ever appends, so an
  // event missed while the socket was down is a hole no later event fills.
  useEffect(() => {
    if (slot?.status !== 'online') return;
    void useLogs.getState().open(told.host, told.chatId);
  }, [told.host, told.chatId, slot?.status]);

  // A window 500 pt tall holds a few turns; what is being read is the end of
  // the conversation, so it is kept there as the turn writes itself.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'nearest' });
  }, [log.items.length, log.busy]);

  const { badge, tone } = doing(chat?.status ?? null, log.busy);
  const machine = slot?.info?.name ?? slot?.cfg.name ?? told.host;
  const stamp = chat?.updated_at ?? told.at;
  const busy = log.busy || chat?.status === 'running';

  // What the chat is set to, and the way to change any of it — the same five
  // settings the chat screen puts in its head, in the room a 350 pt window has:
  // which sign-in it spends, which model, how hard it thinks, what it may do
  // without asking, and which folder it is in.
  const source = chat ? {
    chat, catalog: slot?.catalog ?? null, projects: slot?.projects ?? [],
    accounts: slot?.accounts ?? [], limits: slot?.limits ?? {},
  } : null;
  const rows = picking && source ? fieldRows(picking, source) : [];

  // `account.list` shells out to the CLIs, so it is never asked for on the way
  // in: the head says which sign-in the chat is on out of the chat itself, and
  // the list is fetched when somebody actually opens it.
  useEffect(() => {
    if (picking !== 'account_id' || slot?.status !== 'online') return;
    if (slot.accounts.length || slot.loading.accounts) return;
    useFleet.getState().refreshAccounts(told.host).catch(() => {});
  }, [picking, slot?.status, slot?.accounts.length, slot?.loading.accounts]);

  /** Dragging, by the head to move it and by the top-left corner to resize it.
   *
   *  Both are the same gesture: hold the mouse down, and what it does to the
   *  window is either its place or its size. The window is measured from the
   *  bottom right corner — the corner the dock stands in — so moving left and
   *  up is `right` and `bottom` growing, and the resize grip is the *other*
   *  corner, which is the one that is free to move.
   *
   *  A window is kept inside the viewport (`inView`): one dragged off the edge
   *  is one that cannot be dragged back. The listeners are on the window rather
   *  than on the panel because a fast drag leaves the element behind, and a
   *  drag that stopped tracking halfway is worse than one that never started. */
  const hold = (e: React.MouseEvent, what: 'move' | 'size') => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY, ...place };
    const body = typeof document === 'undefined' ? null : document.body;
    const was = body?.style.userSelect ?? '';
    if (body) body.style.userSelect = 'none';
    const drag = (ev: MouseEvent) => {
      const dx = ev.clientX - from.x;
      const dy = ev.clientY - from.y;
      const next: Place = what === 'move'
        ? { ...place, right: from.right - dx, bottom: from.bottom - dy }
        : { ...place, width: from.width - dx, height: from.height - dy };
      onPlace(inView(next, { width: window.innerWidth, height: window.innerHeight }));
    };
    const drop = () => {
      window.removeEventListener('mousemove', drag);
      window.removeEventListener('mouseup', drop);
      if (body) body.style.userSelect = was;
    };
    window.addEventListener('mousemove', drag);
    window.addEventListener('mouseup', drop);
  };

  const move = async (field: Field, value: string) => {
    if (!chat || value === fieldValue(field, chat)) { setPicking(null); return; }
    // A turn that is running is using all five of these; changing one under it
    // is how a chat ends up half on one model and half on another.
    if (busy) {
      setError('a turn is running on this chat — stop it before changing that');
      setPicking(null);
      return;
    }
    setError(null);
    try {
      // Null rather than '' is how `chat.update` reads "the computer's own".
      await updateChat(told.host, told.chatId,
        { [field]: field === 'account_id' ? (value || null) : value });
      setPicking(null);
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
    }
  };

  const say = async (words: string, attachments: any[] = []) => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await send(told.host, told.chatId, words, attachments);
    } catch (e: any) {
      setError(e?.message ?? 'That did not reach the computer');
    } finally {
      setSending(false);
    }
  };

  // Opened out, the window is as big as the screen sensibly allows rather than
  // the size it was dragged to: what "bigger" is for is reading, and a window
  // somebody had pulled down to 280 pt would open out to 280 pt.
  const room = big ? {
    width: Math.min(1040, Math.max(360, view.width - 64)),
    height: Math.min(880, Math.max(320, view.height - 64)),
  } : place;

  return (
    <Panel
      tone={tone} width={room.width} height={room.height}
      head={(
        <div
          style={{ flex: 'none', position: 'relative', zIndex: 3 }}
          onMouseDown={(e) => {
            // Everything in the head that does something keeps its click: the
            // window buttons, the chips, the list under them. And a window
            // standing in the middle of the screen is not dragged at all —
            // there is nowhere for it to go.
            if (big) return;
            if ((e.target as HTMLElement | null)?.closest('button')) return;
            hold(e, 'move');
          }}
        >
          {/* The corner that is free to move, which is the one to pull on: the
              window is anchored to the bottom right, so the top left is where
              it grows from. */}
          {!big && <span
            role="separator" aria-label="Resize this window"
            onMouseDown={(e) => { e.stopPropagation(); hold(e, 'size'); }}
            style={{
              position: 'absolute', top: 0, left: 0, width: 16, height: 16,
              cursor: 'nwse-resize', zIndex: 5,
            }}
          />}
          {/* What the chat is about, in a box of its own over the head: a
              title is a sentence somebody typed, and beside the window's
              buttons it had a third of a line to be read in. */}
          <div
            title={chat?.title || told.title}
            style={{
              margin: '10px 12px 0', padding: '7px 10px', borderRadius: RADIUS.quote,
              background: T.s2, fontSize: 13, fontWeight: 600, lineHeight: 1.3,
              cursor: big ? undefined : 'grab',
            }}
          >
            {/* Clamped inside the padding: a clamp on the padded box itself
                lets the top of the line it cut show through underneath. */}
            <div style={{
              overflow: 'hidden', overflowWrap: 'anywhere',
              display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: big ? 1 : 2,
            }}>{chat?.title || told.title}</div>
          </div>
          <PanelHead
            lead={<ExecutorBadge executor="divan" />}
            extra={!!onBig && (
              <HeadGlyph
                label={big ? '⤡' : '⤢'}
                title={big ? 'Back to the corner' : 'Open it in the middle of the screen'}
                onClick={() => onBig(!big)}
              />
            )}
            title={machine} badge={badge} tone={tone}
            note={stamp ? clock(stamp) : ''}
            grab={!big}
            onMinimise={onMinimise}
            onClose={onClose}
          />
          {/* The chat's own settings, which the chat screen draws as chips in
              its head and this draws the same way one size down. Every one of
              them is pressable, and what each opens is the list that screen's
              sheet opens — the same rows, the same figures. */}
          {!!chat && (
            <div style={{
              flex: 'none', display: 'flex', flexWrap: 'wrap', gap: 4,
              padding: '0 12px 10px', borderBottom: `1px solid ${T.line}`,
            }}>
              {FIELDS.map((field) => {
                const label = fieldChip(field, source!);
                if (!label) return null;
                const warn = field === 'perm_mode' && label === 'bypass';
                return (
                  <button
                    key={field} type="button"
                    onClick={() => setPicking((p) => (p === field ? null : field))}
                    aria-expanded={picking === field}
                    title={`${FIELD_LABEL[field]} — press to change`}
                    style={{
                      ...mono, flex: 'none', maxWidth: '100%', height: 20, padding: '0 7px',
                      borderRadius: RADIUS.chip, border: 'none', font: 'inherit', fontSize: 10.5,
                      background: picking === field ? T.sLift : T.s2,
                      color: warn ? T.amber : T.ink2, cursor: 'pointer',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >{label}</button>
                );
              })}
            </div>
          )}
          {!!picking && (
            <Options
              field={picking} rows={rows} current={chat ? fieldValue(picking, chat) : ''}
              loading={!!slot?.loading.accounts}
              onPick={(value) => { void move(picking, value); }}
            />
          )}
        </div>
      )}
      foot={chat ? (
        // The chat screen's own box, one size down: the same send, the same
        // attachments, the same stop while a turn is running. A window whose
        // composer could do less than the screen's was two chats.
        <ChatComposer
          chat={chat} hostKey={told.host} busy={!!busy} sending={sending} compact={!big}
          onSend={(words, attachments) => { void say(words, attachments); }}
          onInterrupt={() => { interrupt(told.host, told.chatId).catch(() => {}); }}
          onUpload={(f) => upload(told.host, told.chatId, f)}
        />
      ) : (
        <div style={{ ...mono, flex: 'none', padding: '0 14px 14px', fontSize: 11, color: T.ink3 }}>
          opening…
        </div>
      )}
    >
      {slot?.status !== 'online' && (
        <div style={{ ...mono, fontSize: 11, color: T.ink3 }}>
          {machine} cannot be reached — this is what it last said
        </div>
      )}
      {log.loading && !log.items.length && (
        <div style={{ ...mono, fontSize: 11, color: T.ink3 }}>opening…</div>
      )}
      <Timeline
        items={log.items} hostKey={told.host}
        onRespond={(rid, d) => { respond(told.host, told.chatId, rid, d).catch(() => {}); }}
      />
      {!!log.error && <div style={{ ...mono, fontSize: 11, color: T.red }}>{log.error}</div>}
      {!!error && <div style={{ ...mono, fontSize: 11, color: T.red }}>{error}</div>}
      <div ref={foot} />
    </Panel>
  );
}

/** What this chat can be moved to, under the chip that named where it is.
 *
 *  The chat screen opens a sheet for this; a 350 pt window cannot, so it is the
 *  same list one size down, standing over the conversation rather than over the
 *  page — and it says the same things about each row, because the rows are the
 *  same ones (`lib/fields.ts`): a model's own name and its id, an account's
 *  sign-in and how much of its plan is left, the permission mode that stops
 *  asking and what that means.
 *
 *  What moving an account costs is written on it rather than asked in a dialog:
 *  the agent starts a fresh session on the other sign-in, and what has been said
 *  is handed over as a recap. A sentence somebody can read before pressing is
 *  worth more than a confirm nobody reads. */
function Options({ field, rows, current, loading, onPick }: {
  field: Field;
  rows: FieldRow[];
  current: string;
  loading: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div
      role="listbox" aria-label={FIELD_LABEL[field]}
      style={{
        position: 'absolute', top: '100%', left: 12, right: 12, marginTop: -6, zIndex: 4,
        maxHeight: 260, overflowY: 'auto',
        background: T.s2, borderRadius: RADIUS.tab, boxShadow: SHADOW.drawer,
        padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
      }}
    >
      {!rows.length && (
        <div style={{ ...mono, fontSize: 11, color: T.ink3, padding: 8 }}>
          {loading ? 'asking the computer…' : `nothing to choose — ${FIELD_LABEL[field].toLowerCase()}`}
        </div>
      )}
      {rows.map((r) => {
        const on = r.value === current;
        return (
          <button
            key={r.value} type="button" role="option" aria-selected={on}
            onClick={() => onPick(r.value)}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
              padding: '7px 8px', borderRadius: RADIUS.mark, border: 'none', font: 'inherit',
              textAlign: 'left', cursor: 'pointer',
              background: on ? T.s1 : 'transparent', color: T.ink,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: 'block', fontSize: 13, fontWeight: on ? 600 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{r.label}</span>
              {!!r.hint && (
                <span style={{
                  display: 'block', fontSize: 11, lineHeight: 1.35,
                  color: r.warn ? T.amber : T.ink3,
                }}>{r.hint}</span>
              )}
            </span>
            {!!r.right && (
              <span style={{
                ...mono, flex: 'none', maxWidth: 130, fontSize: 10.5,
                color: r.warn ? T.red : T.ink3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{r.right}</span>
            )}
            {on && <span style={{ ...mono, flex: 'none', fontSize: 11, color: T.ink3 }}>on</span>}
          </button>
        );
      })}
      {field === 'account_id' && rows.length > 1 && (
        <div style={{ ...mono, fontSize: 10.5, lineHeight: 1.45, color: T.ink3, padding: '4px 8px 2px' }}>
          moving starts a fresh session on the other sign-in — what was said is
          handed over as a recap
        </div>
      )}
    </div>
  );
}
