/** The box a person types in, and everything that goes with it.
 *
 *  It was inside the chat screen, which is where it is mostly used and where
 *  it was written. It is out here because it is used in two places now: the
 *  chat screen, and the window a chat opens in on the Dashboard
 *  (`ChatPanel.tsx`). Those two had *different* boxes for a while — the window
 *  had the design system's one-line field, with no send button, no attachments
 *  and no way to stop a turn — and a chat that can do less depending on which
 *  window it is in is two chats.
 *
 *  So: one composer. `compact` is the only thing the window asks for, and it
 *  is a size rather than a feature — the same buttons, the same keys, the same
 *  drag-and-drop, drawn for 350 pt instead of 900.
 *
 *  The microphone is the panel's own, not the phone's. A voice note is a file
 *  the agent is handed; this is dictation — the words go in the box, you read
 *  them, and you press send yourself. `lib/dictate.ts` is the engine and the
 *  reasoning; what is here is the button, the counter and where the live words
 *  land.
 */
import { useEffect, useRef, useState } from 'react';
import { draftAttached, draftKey, draftText, useDrafts } from '../lib/drafts';
import { C, R } from '../lib/theme';
import { Icon, P, Spinner, mono } from '../ui/kit';
import { fileUrl } from '../lib/actions';
import { appendSpeech, dictateLang, langName } from '../lib/dictate';
import { MicButton, useMic } from './Mic';
import type { Chat } from '../lib/protocol';

export function Tray({ items, hostKey, busy, onRemove }: {
  items: any[]; hostKey: string; busy: boolean; onRemove: (path: string) => void;
}) {
  const src = (a: any) => {
    try { return fileUrl(hostKey, a.view || a.path); } catch { return ''; }
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
      {items.map((a) => (
        <div key={a.path} style={{ position: 'relative' }}>
          {a.kind === 'image' ? (
            <img
              src={src(a)} alt=""
              style={{
                width: 56, height: 56, objectFit: 'cover', display: 'block',
                borderRadius: R.btn, border: `1px solid ${C.border}`, background: C.bg,
              }}
            />
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px',
              borderRadius: R.btn, background: C.surface2, border: `1px solid ${C.border}`,
              maxWidth: 200,
            }}>
              <Icon path={a.kind === 'audio' ? P.mic : P.copy} size={13} color={C.mute} />
              <span style={{
                ...mono, fontSize: 12, color: C.text2, minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{a.name}</span>
            </div>
          )}
          <button
            type="button" onClick={() => onRemove(a.path)} title="Remove"
            style={{
              position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              background: C.surface, border: `1px solid ${C.border}`, padding: 0,
            }}
          >
            <Icon path={P.x} size={10} color={C.text2} />
          </button>
        </div>
      ))}
      {busy && <Spinner size={14} />}
    </div>
  );
}

/** Seconds as `0:07`. A dictation is never long enough to need an hour in it. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function ChatComposer({ chat, hostKey, busy, sending, compact,
                               onSend, onInterrupt, onUpload }: {
  chat: Chat; hostKey: string; busy: boolean; sending: boolean;
  /** Drawn for a 350 pt window: the same parts, one size down, and the line of
   *  keyboard hints dropped — there is no room for it and nobody reads it
   *  twice. */
  compact?: boolean;
  onSend: (text: string, attachments: any[]) => void;
  onInterrupt: () => void;
  onUpload: (file: File) => Promise<any>;
}) {
  // What is typed and what is attached belong to the chat, not to this box:
  // the box stays mounted while the chat under it changes (`lib/drafts.ts`).
  const key = draftKey(hostKey, chat.id);
  const text = useDrafts((s) => draftText(s, key));
  const pending = useDrafts((s) => draftAttached(s, key));
  const setText = (next: string | ((was: string) => string)) =>
    useDrafts.getState().setText(key, next);
  const setPending = (next: any[] | ((was: any[]) => any[])) =>
    useDrafts.getState().setAttached(key, next);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const mic = useMic({
    hostKey, folder: chat.cwd.split(/[/\\]/).pop(),
    onCommit: (chunk) => setText((prev) => appendSpeech(prev, chunk)),
  });
  const listening = mic.state === 'listening';
  // The words the engine has not committed yet are shown where they are going
  // to land rather than beside it, so there is one place to read. Typing takes
  // them over: `onChange` writes whatever is in the box, interim included.
  const shown = mic.interim ? appendSpeech(text, mic.interim) : text;

  // Dictation appends, so the end of the box is the part worth looking at.
  useEffect(() => {
    if (!listening) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [listening, shown]);
  // dragenter/dragleave also fire crossing between children, so the highlight
  // follows a depth count rather than the first leave it sees.
  const depth = useRef(0);

  // Attaching is an upload now and a send later, so the pictures can be looked
  // at — and a caption typed — before the agent is handed them.
  const addFiles = async (files: FileList) => {
    setUploading(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        const a = await onUpload(f);
        setPending((p) => [...p, a]);
      }
    } catch (e: any) { setError(e?.message ?? 'Upload failed'); }
    finally { setUploading(false); }
  };

  // A screenshot on the clipboard is a file, not text — nothing lands in the
  // textarea on its own. Rich copies (a spreadsheet cell, a styled snippet)
  // carry both a rendering and the text that was actually meant, so only a
  // paste with no text of its own becomes an upload.
  const onPaste = (e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (!files?.length) return;
    if (e.clipboardData.getData('text/plain').trim()) return;
    e.preventDefault();
    addFiles(files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  // Grow with the text, up to a point. Measured from 0 rather than 'auto' so a
  // second pass cannot read back the height the first pass just set.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(36, Math.min(200, el.scrollHeight))}px`;
  }, [shown]);

  const submit = () => {
    // Pressing send with the microphone open means "that was the message":
    // stop it and let the last words land rather than sending without them.
    if (mic.state !== 'idle') { mic.stop(); return; }
    const t = text.trim();
    if (!t && !pending.length) return;
    // A voice note carries its own words; anything else gets a line that says
    // why it is there, because a message with no text at all reads as a glitch.
    const caption = t
      || pending.map((a) => a.transcript).filter(Boolean).join('\n')
      || 'Have a look at this.';
    onSend(caption, pending);
    useDrafts.getState().clear(key);
  };

  const folder = chat.cwd.split(/[/\\]/).pop();
  const ready = !!text.trim() || pending.length > 0;
  // The disc takes a colour only when pressing it would do something: red to
  // send, red to stop, and at rest the quiet fill. What is drawn on it follows
  // — `onAccent` is the white that belongs on a filled colour and nothing else,
  // so a resting button gets an ink instead. (It used to be white at half
  // opacity on `surface2`, which in the light theme is white on off-white: the
  // send button looked empty until you typed.)
  const armed = busy || ready || sending || mic.state !== 'idle';
  /** The two discs at either end of the box. The frames draw them at 36; a
   *  window 350 wide has room for 30 and not for 36. */
  const disc = compact ? 30 : 36;
  const sendFace = busy && !ready ? C.danger : armed ? C.accent : C.surface2;
  const sendGlyph = armed ? C.onAccent : C.mute;
  return (
    <div
      style={{ padding: compact ? '6px 10px 10px' : '8px 20px 16px', flexShrink: 0 }}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={onDrop}
    >
      {(pending.length > 0 || uploading) && (
        <Tray
          items={pending} hostKey={hostKey} busy={uploading}
          onRemove={(p) => setPending((list) => list.filter((a) => a.path !== p))}
        />
      )}
      {(error || mic.error) && (
        <div style={{ fontSize: 12, color: C.danger, marginBottom: 6 }}>{error || mic.error}</div>
      )}
      {mic.state === 'installing' && (
        <div style={{ fontSize: 12, color: C.text2, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Spinner size={12} />
          {`Fetching the ${langName(dictateLang())} speech model. This happens once, and then it runs on this computer.`}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8, padding: 6,
        borderRadius: R.composer, background: C.surface,
        border: `1px solid ${dragging ? C.accent : C.border}`,
      }}>
        <input
          ref={file} type="file" multiple name="attachments" style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
        />
        <button
          type="button" onClick={() => file.current?.click()} title="Attach a file" aria-label="Attach a file"
          style={{
            width: disc, height: disc, borderRadius: disc / 2, flexShrink: 0, cursor: 'pointer',
            background: C.surface2, border: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon path={P.plus} size={compact ? 15 : 18} color={C.text} />
        </button>
        <textarea
          ref={ref} name="composer" aria-label="Message" value={shown} rows={1}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
            // ⌥Space, which in a text field types a space nothing can break a
            // line at — so there is nothing to lose by taking it, and it is
            // the one chord neither the browser nor the panel already has.
            if (e.code === 'Space' && e.altKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              mic.state === 'idle' ? mic.start() : mic.stop();
            }
          }}
          placeholder={listening ? 'Listening…'
            : busy ? 'You can already type the next message…' : `Message ${folder}…`}
          style={{
            flex: 1, boxSizing: 'border-box', maxHeight: compact ? 120 : 200, resize: 'none',
            background: 'transparent', border: 'none', outline: 'none',
            fontSize: compact ? 13.5 : 15, lineHeight: compact ? '19px' : '22px',
            padding: compact ? '6px 4px' : '7px 6px', color: C.text, overflowY: 'auto',
          }}
        />
        <MicButton mic={mic} size={disc} />
        <button
          type="button" onClick={busy && !ready ? onInterrupt : submit}
          disabled={!busy && !ready && mic.state === 'idle'}
          title={busy && !ready ? 'Stop' : 'Send'} aria-label={busy && !ready ? 'Stop' : 'Send'}
          style={{
            width: disc, height: disc, borderRadius: disc / 2, flexShrink: 0,
            cursor: busy || ready ? 'pointer' : 'default',
            background: sendFace, color: sendGlyph, border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {sending ? <Spinner size={compact ? 12 : 14} color={sendGlyph} />
            : busy && !ready ? <Icon path={P.stop} size={compact ? 12 : 14} color={sendGlyph} fill />
            : <Icon path={P.send} size={compact ? 14 : 16} color={sendGlyph} width={2.4} />}
        </button>
      </div>
      {!compact && (
        <div style={{ ...mono, fontSize: 11, color: C.faint, marginTop: 6, display: 'flex', gap: 16 }}>
          {listening ? (
            <>
              {/* Not a hint any more: while it is listening this line is the one
                  place that says it still is, and for how long. */}
              <span style={{ color: C.accent }}>
                {`recording ${clock(mic.seconds)}`}
                {mic.writing ? ' · writing…' : mic.engine === 'whisper' ? ' · on the computer' : ''}
              </span>
              <span>⏎ or ⌥Space to stop</span>
              <span>esc discards</span>
            </>
          ) : (
            <>
              <span>⏎ {busy ? 'queue' : 'send'}</span>
              <span>⇧⏎ newline</span>
              {mic.availability && mic.availability !== 'none' && <span>⌥Space dictate</span>}
              <span>⌘K command palette</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
