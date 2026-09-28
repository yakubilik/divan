import React from 'react';
import { Pressable, View } from 'react-native';
import { useColors, type Palette } from '../theme';
import { useT } from '../store';
import { answerable, first, since, STATUS_KEY } from '../tickets';
import { Dot, Icon, Spinner, Text } from './ui';
import type { Ticket, TicketStatus } from '../protocol';

/** The colour a status is read by, in the app's palette rather than the panel's.
 *
 *  The two warm ones mean on this wall what they mean in a chat: the app's red
 *  is "this is waiting for you to say something", which is exactly a blocked
 *  ticket, and clay is a failure. Everything that is merely working is ink, so
 *  that on a wall of twenty cards the eye still goes to the two that need a
 *  person. */
export function tone(c: Palette, status: TicketStatus | string): { color: string; tint: string } {
  switch (status) {
    case 'blocked': return { color: c.accentText, tint: c.accentTint };
    case 'failed': return { color: c.danger, tint: c.dangerBg };
    case 'running': return { color: c.ink, tint: c.fill };
    case 'done': return { color: c.ok, tint: c.okBg };
    default: return { color: c.faint, tint: c.fill };
  }
}

/** A heading over a block of the opened ticket. */
export function Section({ title, color, children }: { title: string; color?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 12 * 0.06, textTransform: 'uppercase', color: color ?? c.muted }}>{title}</Text>
      {children}
    </View>
  );
}

/** One ticket on the wall. Everything a glance is owed: whose colour it is, its
 *  number, its title, where the loop has got to, how long it has been there, and
 *  the last thing that happened — or, on a ticket that stopped to ask, the
 *  opening of the question itself, which is the only thing on the card that
 *  matters until it is answered. */
export function TicketCard({ t, now, onPress }: { t: Ticket; now: number; onPress: () => void }) {
  const T = useT();
  const c = useColors();
  const ph = tone(c, t.status);
  const wants = answerable(t.status);
  const held = since(t.updated_at ? now - t.updated_at : null, T);
  const line = wants && t.escalation
    ? first(t.escalation, 180)
    : first(t.last_event?.msg || t.goal, 140) || T('ticketNoEvents');

  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: pressed ? c.fill : c.card, borderWidth: 1, borderColor: wants ? ph.color : c.line,
                                 borderRadius: 14, padding: 14, gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {t.status === 'running' ? <Spinner size={11} color={c.ink} /> : <Dot color={ph.color} size={7} />}
        <Text mono style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>#{t.id}</Text>
        <View style={{ flex: 1 }} />
        <Text mono numberOfLines={1} style={{ fontSize: 11, color: wants ? ph.color : c.muted }}>{T(STATUS_KEY[t.status] ?? 'tsQueued')}</Text>
      </View>
      <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', lineHeight: 15 * 1.3 }}>{t.title}</Text>
      <Text numberOfLines={3} style={{ fontSize: 13, color: wants ? c.text2 : c.muted, lineHeight: 13 * 1.4 }}>{line}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text mono style={{ fontSize: 11, color: c.faint }}>{T('ticketRound', { stage: t.stage, round: t.round })}</Text>
        {!!held && <Text mono style={{ fontSize: 11, color: c.faint }}>· {T('ticketInState', { d: held })}</Text>}
        {t.note_count > 0 && (
          <Text mono style={{ fontSize: 11, color: c.faint }}>
            · {t.note_count === 1 ? T('ticketOneNote') : T('ticketNoteCount', { n: t.note_count })}
          </Text>
        )}
      </View>
      {wants && (
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 2,
                       backgroundColor: ph.tint, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>{T('ticketAnswer')}</Text>
          <Icon name="chevron_right" size={16} color={ph.color} />
        </View>
      )}
    </Pressable>
  );
}
