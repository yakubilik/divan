import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useNow, useQueue } from '../src/queue';
import { LOCALE } from '../src/i18n';
import { useColors } from '../src/theme';
import { Dot, EmptyState, Skeleton, Text } from '../src/components/ui';
import { LargeTitlePage } from '../src/components/page';
import { TicketCard } from '../src/components/ticket';
import { redCount, since, sortTickets, TICK_STALE_S } from '../src/tickets';

/** The ustabasi wall, on the phone.
 *
 *  A ticket queue on the computer hands its tickets to a worker, a check and an
 *  independent verifier, and the loop runs for hours with nobody in the room.
 *  That is the point of it, and also its one failure: when a worker stops to ask
 *  something only a person can answer, the ticket goes red and stays red until
 *  someone notices. The desktop panel has this wall already — but the person who
 *  has to answer is holding a phone, not sitting at the Mac, so the noticing has
 *  to happen here.
 *
 *  Nothing on this screen is a second source of truth. The daemon reads the
 *  queue's own database, and the one write — answering a ticket — is that queue's
 *  own CLI run by the daemon, so a note sent from this phone and a note typed on
 *  the computer are the same note. Everything else the queue can do (starting
 *  work, cancelling it, editing a card) stays on the other side of that CLI. */
export default function Ustabasi() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const c = useColors();
  const now = useNow();
  const { snapshot, tickets, state, error } = useQueue();
  const hostInfo = useStore((s) => s.hostInfo);
  const host = useStore((s) => s.host);
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  const shown = useMemo(() => sortTickets(tickets), [tickets]);
  const red = redCount(tickets);
  const running = tickets.filter((t) => t.status === 'running').length;

  // Whether the queue is alive at all. The cards cannot tell you this: a
  // supervisor that died leaves every one of them exactly as it was.
  const tickAge = snapshot?.queue?.last_tick ? now - snapshot.queue.last_tick : null;
  const stale = tickAge == null || tickAge > TICK_STALE_S;
  const paused = snapshot?.queue?.paused_until && snapshot.queue.paused_until > now
    ? new Date(snapshot.queue.paused_until * 1000) : null;

  let body: React.ReactNode;
  if (state === 'loading') {
    body = (
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 14, gap: 9, opacity: 1 - i * 0.2 }}>
            <Skeleton width={54} height={11} />
            <Skeleton width="80%" height={13} />
            <Skeleton width="60%" height={11} color={c.fill} />
          </View>
        ))}
      </View>
    );
  } else if (state === 'offline') {
    body = <Empty icon="cloud_off" title={T('cantConnect', { host: hostName })} body={T('hintOffline')} />;
  } else if (state === 'oldHost') {
    // Not a failure to retry or to dress up: this computer simply predates the
    // two requests this screen is made of.
    body = <Empty icon="info" title={T('queueOld')} body={T('queueOldBody')} />;
  } else if (state === 'error') {
    body = <Empty icon="error" title={T('queueUnreachable')} body={error ?? undefined} />;
  } else if (state === 'noQueue') {
    body = <Empty icon="terminal" title={T('queueNone')} body={T('queueNoneBody')} />;
  } else if (state === 'empty') {
    body = <Empty icon="terminal" title={T('queueEmpty')} body={T('queueEmptyBody')} />;
  } else {
    body = (
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {shown.map((t) => (
          <TicketCard key={t.id} t={t} now={now} onPress={() => go(() => router.push(`/ticket/${t.id}`))} />
        ))}
      </View>
    );
  }

  return (
    <LargeTitlePage title={T('ustabasi')} titleStyle={{ paddingTop: 4, paddingBottom: 10 }}>
      {state === 'tickets' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 14, flexWrap: 'wrap' }}>
          <Text mono style={{ fontSize: 12, color: red ? c.accentText : c.muted, fontWeight: red ? '600' : '400' }}>
            {red ? T('queueRed', { n: red }) : T('queueNothingRed')}
          </Text>
          <Text mono style={{ fontSize: 12, color: c.faint }}>· {T('queueRunning', { n: running })}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Dot color={stale ? c.danger : c.ok} size={6} />
            <Text mono style={{ fontSize: 12, color: stale ? c.danger : c.faint }}>
              {tickAge == null ? T('queueNeverTicked')
                : stale ? T('queueSilent', { d: since(tickAge, T) })
                : T('queueTicked', { d: since(tickAge, T) })}
            </Text>
          </View>
          {paused && (
            <Text mono style={{ fontSize: 12, color: c.warn }}>
              · {T('queuePaused', { time: paused.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }) })}
            </Text>
          )}
        </View>
      )}
      {body}
    </LargeTitlePage>
  );
}

/** `EmptyState` fills what it is given, and this page is a scroll view — which
 *  gives it nothing. Stand it in a box tall enough to read as a page. */
function Empty(props: React.ComponentProps<typeof EmptyState>) {
  return <EmptyState {...props} style={{ minHeight: 360, paddingBottom: 0 }} />;
}
