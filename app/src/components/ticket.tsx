import React from 'react';
import { Pressable, View } from 'react-native';
import { useColors, type Palette } from '../theme';
import { useT } from '../store';
import { answerable, cardLine, commitCount, first, roundAge, since, STATUS_KEY, stepLine,
         totalAge } from '../tickets';
import { Dot, Icon, Spinner, Text } from './ui';
import type { Ticket, TicketStatus } from '../protocol';

/** The colour a status is read by, in the app's palette rather than the panel's.
 *
 *  The two warm ones mean on this wall what they mean in a chat: the app's red
 *  is "this is waiting for you to say something", which is exactly a blocked
 *  ticket, and clay is a failure. Everything that is merely working is ink, so
 *  that on a wall of twenty cards the eye still goes to the two that need a
 *  person. Blocked and failed say the same word — the ticket is not moving
 *  until he answers — and are told apart by these two colours and by the line
 *  under the title. */
export function tone(c: Palette, status: TicketStatus | string): { color: string; tint: string } {
  switch (status) {
    case 'blocked': return { color: c.accentText, tint: c.accentTint };
    case 'failed': return { color: c.danger, tint: c.dangerBg };
    case 'running': return { color: c.ink, tint: c.fill };
    case 'done': return { color: c.ok, tint: c.okBg };
    default: return { color: c.faint, tint: c.fill };
  }
}

/** The (i), which is the whole reason the card has room for so little.
 *
 *  Its own tap target, a thumb's width from the card's — 40pt of it, hanging
 *  off the right of the title row where nothing else is, with the card's own
 *  press handler stopped at its edge. Everything a card used to carry and could
 *  not read — which pid, which model, which account, which step of which round,
 *  what the verifier made of which criterion — is behind it. */
function About({ onPress, color }: { onPress: () => void; color: string }) {
  const T = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={T('ticketAbout')}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ width: 40, height: 40, marginVertical: -12, marginRight: -10,
                                 alignItems: 'center', justifyContent: 'center' },
                               pressed && { opacity: 0.45 }]}>
      <Icon name="info" size={19} color={color} />
    </Pressable>
  );
}

/** One ticket on the wall.
 *
 *  Four things and no more: whose colour it is and its number; its title; what
 *  is happening, in words; and how long — since it was opened first, then this
 *  round. The pid, the model and the account are not on it. They were, and they
 *  were the widest thing on the card and the only thing on it nobody could act
 *  on; they are behind the (i) now, where somebody looking for them will look.
 *
 *  No percentage and no "3 of 8 done". Nothing in the queue knows how far along
 *  a ticket is — the criteria are answered once, at the end, by the verifier —
 *  so either would be a drawn guess. */
export function TicketCard({ t, now, onPress, onAbout }: {
  t: Ticket; now: number; onPress: () => void; onAbout: () => void;
}) {
  const T = useT();
  const c = useColors();
  const ph = tone(c, t.status);
  const wants = answerable(t.status);
  const round = roundAge(t, now, T);
  const commits = commitCount(t, T);
  const asked = t.ask || t.escalation;
  const line = wants && asked ? first(asked, 180)
                                     : first(cardLine(t), 140) || T('ticketNoEvents');

  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: pressed ? c.fill : c.card, borderWidth: 1, borderColor: wants ? ph.color : c.line,
                                 borderRadius: 14, padding: 14, gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {t.status === 'running' ? <Spinner size={11} color={c.ink} /> : <Dot color={ph.color} size={7} />}
        <Text mono style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>#{t.id}</Text>
        {/* The status, in a word, in its own colour, at the size of something
            meant to be read rather than filed. It used to be grey mono type in
            the far corner, which is where a machine token goes. */}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600', color: ph.color }}>
          {T(STATUS_KEY[t.status] ?? 'tsQueued')}
        </Text>
        <About onPress={onAbout} color={c.faint} />
      </View>
      <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', lineHeight: 15 * 1.3 }}>{t.title}</Text>
      <Text numberOfLines={3} style={{ fontSize: 13, color: wants ? c.text2 : c.muted, lineHeight: 13 * 1.4 }}>{line}</Text>
      {/* How long it has been a ticket, first and on its own: it is the figure
          anybody means by "how long has this been going", and the smaller one
          under it was being read as that. */}
      <Text mono style={{ fontSize: 12, color: c.text2 }}>{totalAge(t, now, T)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {!!round && <Text mono style={{ fontSize: 11, color: c.faint }}>{round}</Text>}
        {!!commits && <Text mono style={{ fontSize: 11, color: c.faint }}>{round ? '· ' : ''}{commits}</Text>}
        {t.note_count > 0 && (
          <Text mono style={{ fontSize: 11, color: c.faint }}>
            {round || commits ? '· ' : ''}{t.note_count === 1 ? T('ticketOneNote') : T('ticketNoteCount', { n: t.note_count })}
          </Text>
        )}
      </View>
      {!!t.git?.subject && (
        <Text numberOfLines={1} style={{ fontSize: 12, color: c.muted }}>{t.git.subject}</Text>
      )}
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

/** The header both of a ticket's pages wear: its colour, its number, its title
 *  and the word for what it is doing. Drawn once so the two pages cannot drift
 *  apart, and so that moving between them does not move anything on screen. */
export function TicketHeader({ t, now, onBack, right }: {
  t: Ticket; now: number; onBack: () => void; right?: React.ReactNode;
}) {
  const T = useT();
  const c = useColors();
  const ph = tone(c, t.status);
  const held = since(now - (t.created_at || now), T);
  return (
    <View style={{ paddingHorizontal: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
                   borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Pressable accessibilityLabel={T('back')} onPress={onBack} hitSlop={6}
        style={({ pressed }) => [{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.5 }]}>
        <Icon name="chevron_left" size={26} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {t.status === 'running' ? <Spinner size={11} color={c.ink} /> : <Dot color={ph.color} size={7} />}
          <Text mono style={{ fontSize: 12, fontWeight: '600', color: ph.color }}>#{t.id}</Text>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '600' }}>{t.title}</Text>
        </View>
        <Text mono numberOfLines={1} style={{ fontSize: 11, color: ph.color }}>
          {T(STATUS_KEY[t.status] ?? 'tsQueued')}
          <Text mono style={{ color: c.faint }}> · {stepLine({ stage: t.stage, round: t.round, at: 0 }, T)}
            {held ? ` · ${T('ticketOpen', { d: held })}` : ''}</Text>
        </Text>
      </View>
      {right}
    </View>
  );
}
