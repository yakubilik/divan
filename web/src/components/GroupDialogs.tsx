import { useState } from 'react';
import { C, R } from '../lib/theme';
import { Btn } from '../ui/kit';
import { Modal } from './Modal';

/** A group's name, asked for: when one is made and when one is renamed. The
 *  list and a chat's own menu both ask it, so it is one dialog rather than two
 *  that drift. It stays up until the computer has answered — a name that was
 *  refused is said here, next to the field it was typed in. */
export function GroupNameDialog({ title, initial = '', confirm, onSubmit, onClose }: {
  title: string;
  initial?: string;
  confirm: string;
  onSubmit: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim().slice(0, 60);

  const submit = async () => {
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clean);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={440}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{title}</div>
        <input
          autoFocus name="group-name" placeholder="Group name" maxLength={60}
          value={name} onChange={(e) => setName(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px',
            background: C.bg, border: `1px solid ${C.border}`, borderRadius: R.input,
            outline: 'none', fontSize: 14, color: C.text, marginBottom: error ? 8 : 16,
          }}
        />
        {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" disabled={!clean || busy}>{confirm}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/** Deleting a group takes the heading away and nothing under it, which is the
 *  one thing worth saying before it happens. */
export function DeleteGroupDialog({ name, onDelete, onClose }: {
  name: string;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={440}>
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Delete group</div>
        <div style={{ fontSize: 13, color: C.mute, lineHeight: '19px', marginBottom: 16 }}>
          “{name}” is removed. Its chats are kept, just ungrouped.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="danger" onClick={() => { onDelete(); onClose(); }}>Delete</Btn>
        </div>
      </div>
    </Modal>
  );
}
