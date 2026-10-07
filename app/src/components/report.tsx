/** What a ticket came back with, at the end of its page: the worker's summary,
 *  the verifier's verdict, and every document the ticket wrote — a rotation
 *  list, an audit — read back by the daemon (`ustabasi.report`, key-masked)
 *  and drawn as the Markdown it is. Before this the documents sat in a folder
 *  on the Mac that nothing pointed at. */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useStore, useT } from '../store';
import { useColors } from '../theme';
import { AssistantText } from './chat';
import { Icon, Text } from './ui';
import type { TicketReport } from '../protocol';

export function Report({ id, status }: { id: number; status: string }) {
  const T = useT();
  const c = useColors();
  const ticketReport = useStore((s) => s.ticketReport);
  const [rep, setRep] = useState<TicketReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shut, setShut] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mine = true;
    ticketReport(id)
      .then((r) => { if (mine) { setRep(r); setErr(null); } })
      .catch((e) => { if (mine) setErr(e?.message ?? String(e)); });
    return () => { mine = false; };
  }, [id, status, ticketReport]);

  if (err) return <Text mono style={{ fontSize: 11.5, color: c.faint }}>{T('reportFailed', { e: err })}</Text>;
  if (!rep || (!rep.summary && !rep.verdict_summary && !rep.files.length)) return null;
  const box = { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14 } as const;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: c.muted }}>{T('reportTitle')}</Text>
      {!!rep.summary && <AssistantText text={rep.summary} />}
      {!!rep.verdict_summary && (
        <View style={[box, { padding: 12, gap: 4 }]}>
          <Text mono style={{ fontSize: 11, color: c.faint }}>{T('reportVerifier', { v: rep.verdict || '—' })}</Text>
          <AssistantText text={rep.verdict_summary} />
        </View>
      )}
      {rep.files.map((f) => {
        const open = !shut[f.path];
        return (
          <View key={f.path} style={[box, { overflow: 'hidden' }]}>
            <Pressable onPress={() => setShut((s) => ({ ...s, [f.path]: open }))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12 }}>
              <Icon name={open ? 'expand_less' : 'chevron_right'} size={15} color={c.faint} />
              <Text style={{ fontSize: 14, fontWeight: '600' }}>{f.name}</Text>
              <Text mono numberOfLines={1} style={{ flex: 1, fontSize: 10.5, color: c.faint }}>
                {f.cut ? T('reportCut') : ''}
              </Text>
            </Pressable>
            {open && (
              <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingHorizontal: 12, paddingTop: 8 }}>
                <AssistantText text={f.text} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
