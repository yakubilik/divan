import React, { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useColors } from '../theme';
import { useT } from '../store';
import { Text, TextInput } from './ui';
import { approvalFields, approvalResponse, approvalUrl, type ApprovalResponse } from '../approval-input';

export function ApprovalForm({ input, onDecide }: { input: any; onDecide: (decision: 'allow' | 'deny', response?: ApprovalResponse) => void | Promise<void> }) {
  const c = useColors();
  const T = useT();
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
    try { await onDecide(decision, decision === 'allow' ? response! : undefined); }
    catch { setError('Could not send. Please try again.'); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 10 }}>
    {!!input.serverName && <Text style={{ color: c.muted }}>{input.serverName}</Text>}
    {!!input.message && <Text>{input.message}</Text>}
    {input.mode === 'url' ? url ? <>
      <Text>Open the link, finish the request, then confirm below.</Text>
      <Pressable onPress={() => void Linking.openURL(url).catch(() => setError('Could not open this link.'))}><Text selectable style={{ color: c.accentText }}>{url}</Text></Pressable>
    </> : <Text style={{ color: c.danger }}>Unsupported or unsafe link. Deny this request.</Text>
      : fields ? fields.map((f) => <View key={f.id} style={{ gap: 6 }}>
        <Text>{f.label}{f.required ? ' *' : ''}</Text>
        {!!f.description && <Text style={{ color: c.muted }}>{f.description}</Text>}
        {f.choices?.map((option, index) => {
          const selected = f.type === 'array' ? values[f.id]?.includes(option.value) : values[f.id] === option.value;
          return <Pressable key={index} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: !!selected }}
            onPress={() => choose(f.id, f.type === 'array' ? (selected ? values[f.id].filter((v: any) => v !== option.value) : [...(values[f.id] ?? []), option.value]) : option.value)}
            style={{ padding: 9, borderRadius: 8, borderWidth: 1, borderColor: selected ? c.accentText : c.line }}>
            <Text>{selected ? '● ' : '○ '}{option.label}</Text>
          </Pressable>;
        })}
        {(!f.choices?.length || (f.type === 'answer' && f.allowOther)) && <TextInput accessibilityLabel={f.label} value={String(values[f.id] ?? '')}
          onChangeText={(v) => choose(f.id, v)} editable={!busy} secureTextEntry={f.secret} autoCorrect={false} autoCapitalize="none"
          placeholder={f.type === 'answer' ? 'Choose an option or type your answer' : undefined}
          keyboardType={['number', 'integer'].includes(f.type) ? 'numbers-and-punctuation' : 'default'}
          style={{ padding: 10, borderWidth: 1, borderColor: c.line, borderRadius: 8 }} />}
      </View>) : <Text style={{ color: c.danger }}>Unsupported input form. Deny this request and ask the agent to use a supported form.</Text>}
    {!!error && <Text style={{ color: c.danger }}>{error}</Text>}
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Pressable disabled={busy} onPress={() => void submit('deny')} style={{ padding: 10 }}><Text>{T('deny')}</Text></Pressable>
      <Pressable disabled={busy || !response} onPress={() => void submit('allow')} style={{ padding: 10, opacity: busy || !response ? 0.4 : 1 }}><Text>{input.mode === 'url' ? 'I have completed the request' : 'Submit answers'}</Text></Pressable>
    </View>
  </View>;
}
