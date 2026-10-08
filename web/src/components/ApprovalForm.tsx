import { useEffect, useState } from 'react';
import { approvalFields, approvalResponse, approvalUrl, type ApprovalResponse } from '../lib/approval-input';
import { C, R } from '../lib/theme';

const controlStyle = { padding: '8px 10px', borderRadius: R.btn, border: `1px solid ${C.border}`, background: C.bg, color: C.text, font: 'inherit' };

export function ApprovalForm({ input, onDecide }: {
  input: any;
  onDecide: (decision: 'allow' | 'deny', response?: ApprovalResponse) => unknown | Promise<unknown>;
}) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setValues({}); setError(''); }, [input]);
  const fields = approvalFields(input);
  const url = input.mode === 'url' ? approvalUrl(input.url) : null;
  const response = approvalResponse(input, fields, values);
  const choose = (id: string, value: any) => setValues((old) => ({ ...old, [id]: value }));
  async function submit(decision: 'allow' | 'deny') {
    if (busy || (decision === 'allow' && !response)) return;
    setBusy(true);
    setError('');
    try {
      await onDecide(decision, decision === 'allow' ? response! : undefined);
      setValues({});
    } catch {
      setError('Could not send. Please try again.');
    } finally { setBusy(false); }
  }
  return <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void submit('allow'); }} style={{ display: 'grid', gap: 10, marginTop: 10 }}>
    {input.serverName && <div style={{ color: C.mute }}>{input.serverName}</div>}
    {input.message && <div>{input.message}</div>}
    {input.mode === 'url' ? url ? <>
      <div>Open the link, finish the request, then confirm below.</div>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>{url}</a>
    </> : <div role="alert">Unsupported or unsafe link. Deny this request.</div>
      : fields ? fields.map((f) => <fieldset key={f.id} disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        <legend>{f.label}{f.required ? ' *' : ''}</legend>
        {f.description && <div style={{ color: C.mute }}>{f.description}</div>}
        {f.choices?.map((option, index) => {
          const selected = f.type === 'array' ? values[f.id]?.includes(option.value) : values[f.id] === option.value;
          return <button type="button" key={index} aria-pressed={!!selected} style={{ ...controlStyle, textAlign: 'left', cursor: 'pointer', borderColor: selected ? C.accent : C.border }}
            onClick={() => choose(f.id, f.type === 'array' ? (selected ? values[f.id].filter((v: any) => v !== option.value) : [...(values[f.id] ?? []), option.value]) : option.value)}>
            {selected ? '● ' : '○ '}{option.label}
          </button>;
        })}
        {(!f.choices || f.freeText) && <input aria-label={f.label} value={String(values[f.id] ?? '')}
          onChange={(e) => choose(f.id, e.target.value)} type={f.secret ? 'password' : ['number', 'integer'].includes(f.type) ? 'number' : 'text'}
          style={{ ...controlStyle, width: '100%', boxSizing: 'border-box' }} step={f.type === 'integer' ? 1 : 'any'} autoComplete="off" spellCheck={false}
          placeholder={f.type === 'answer' ? 'Choose an option or type your answer' : undefined} />}
      </fieldset>) : <div role="alert">Unsupported input form. Deny this request and ask the agent to use a supported form.</div>}
    {error && <div role="alert" style={{ color: C.danger }}>{error}</div>}
    <div style={{ display: 'flex', gap: 12 }}>
      <button type="button" style={controlStyle} disabled={busy} onClick={() => void submit('deny')}>Deny</button>
      <button type="submit" style={{ ...controlStyle, background: C.accent, color: C.onAccent, opacity: busy || !response ? 0.5 : 1 }} disabled={busy || !response}>{input.mode === 'url' ? 'I have completed the request' : 'Submit answers'}</button>
    </div>
  </form>;
}
