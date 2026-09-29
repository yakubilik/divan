import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useDivanView } from '../src/queue';
import { since } from '../src/tickets';
import {
  across, actions, executorFace, groups, items, source, type Doing, type Item,
} from '../src/waiting';
import { Button, EmptyState, Pill, SectionHeader } from '../src/components/divan';
import { BackRow, WaitingCard } from '../src/components/waiting';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';
import { Shell } from '../src/components/shell';

/** Everything that needs a person, across every project and every computer, in
 *  one place (Mobile6 S3).
 *
 *  The Dashboard answers "how is everything". This answers the other question,
 *  the one that is actually keeping somebody awake at one in the morning: what
 *  is waiting on **me**. A question a worker asked on the mini at midnight, a
 *  ticket that fell over on the studio, a card that nothing runs on because it
 *  is his to write — four kinds of thing, four machines, one list.
 *
 *  Three things are true of everything on it:
 *
 *  **It says where it came from.** Every card carries its product, its own
 *  title and the computer the work is on, because a list gathered off four
 *  machines is unreadable without it — and because the answer goes back to that
 *  machine, not to whichever one this phone happens to hold a socket to.
 *
 *  **What can be answered in one tap is answered here.** The pills on a card
 *  are the question's own words (`src/waiting.ts answers`), and tapping one
 *  sends it to the queue that asked as a note, which re-opens the ticket and
 *  takes the card off this screen. Nothing is invented: a question that offered
 *  no such words gets `Reply…` and the box, which is a screen away.
 *
 *  **The judgements are not in here.** Which kind an item is, what it offers,
 *  what a tap does — all of it is `src/waiting.ts`, so that
 *  `scripts/test-waiting.cjs` can hold this screen to it without a phone. What
 *  is left in this file is the arrangement, and what happens while a request is
 *  out.
 *
 *  It is pushed over the Dashboard rather than being a place of its own: it is
 *  the Needs-you counter opened up, and the frame draws it with the Dashboard
 *  tab still lit and `‹ Overview` at the top. */
export default function Waiting() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const host = useStore((s) => s.host);
  const answerCard = useStore((s) => s.answerCard);
  const moveCard = useStore((s) => s.moveCard);

  const list = items(view);
  const blocks = groups(view);
  const line = across(list);

  /** What a tap on one card is doing right now. Keyed by the card, because two
   *  of them can be answered one after the other without waiting. */
  const [busy, setBusy] = React.useState<Record<string, { sending?: boolean; error?: string }>>({});

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/dashboard');
  };

  const act = async (item: Item, doing: Doing) => {
    if (doing.do === 'open') { go(() => router.push(`/ticket/${doing.ticket}`)); return; }
    const id = item.card.id;
    setBusy((had) => ({ ...had, [id]: { sending: true } }));
    try {
      if (doing.do === 'note') await answerCard({ ticket: doing.ticket, host: doing.host }, doing.text);
      else await moveCard(doing);
      // The board was re-read by the write, so the card is about to leave this
      // list on its own. Nothing to say; the row that said "sending…" goes.
      setBusy((had) => { const next = { ...had }; delete next[id]; return next; });
    } catch (e: any) {
      // A machine that did not answer is the one thing this screen must say out
      // loud. An answer that silently did not arrive is worse than no answer:
      // the card stays, and nobody knows whether it was dealt with.
      setBusy((had) => ({ ...had, [id]: { error: e?.message ?? '' } }));
    }
  };

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      {/* `flexGrow` so that the calm state, which centres itself in what it is
          given, has the page to centre itself in. Mobile6 S3's own body:
          `padding:8px 16px 12px` over a list at `0 16px` with `gap:8`. */}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 24, gap: 12 }}>
        <View style={{ gap: 6 }}>
          <BackRow label={T('overview')} onPress={back} style={{ paddingHorizontal: 4 }} />
          <SectionHeader kind="page" title={T('waitTitle')}
            right={list.length ? String(list.length) : null} tone="amber" />
          {!!line && (
            <Text style={{ fontSize: 13, lineHeight: 13 * 1.4, color: t.ink2, paddingHorizontal: 4 }}>
              {T(line.key, line.params)}
            </Text>
          )}
        </View>
        {blocks.length === 0 ? <Calm view={view} /> : (
          <View style={{ gap: 8 }}>
            {blocks.map((block) => (
              <React.Fragment key={block.kind}>
                <SectionHeader kind="mark" tone={block.tone} count={block.items.length}
                  title={`${block.mark} ${T(block.label)}`.trim()} />
                {block.items.map((item) => (
                  <Row key={item.card.id} item={item} activeHost={host?.id ?? null}
                    state={busy[item.card.id]} onDo={act} />
                ))}
              </React.Fragment>
            ))}
          </View>
        )}
      </ScrollView>
    </Shell>
  );
}

/** One card, and whatever can be done about it.
 *
 *  The mono line under the buttons is the only thing on the card that is not
 *  read off a board: what a tap is doing right now, or why it did not happen.
 *  It comes before the note about a quiet machine, because a request that just
 *  failed is newer news than a machine that went quiet two hours ago. */
function Row({ item, activeHost, state, onDo }: {
  item: Item;
  activeHost: string | null;
  state?: { sending?: boolean; error?: string };
  onDo: (item: Item, doing: Doing) => void;
}) {
  const T = useT();
  const ago = (seconds: number | null) => since(seconds, T);
  const list = actions(item, activeHost);
  const note = state?.sending ? { text: T('waitSending'), tone: 'ink3' as const }
    : state?.error != null ? { text: T('waitNotSent', { machine: item.machine }), tone: 'red' as const }
    // The card came off a machine that has stopped answering: what is on it was
    // true when that machine last spoke, and may have been dealt with since.
    : item.stale ? { text: T('waitStale', { machine: item.machine }), tone: 'amber' as const }
    : null;
  return (
    <WaitingCard face={executorFace(item.card)} who={T(item.who)}
      from={T(source(item).key, source(item).params)}
      age={item.age == null ? null : ago(item.age)}
      said={item.said} asked={item.asked}
      note={note?.text} tone={note?.tone}
      actions={list.length === 0 ? null : list.map((action, i) => {
        const label = action.label ?? T(action.key);
        const press = state?.sending ? undefined : () => onDo(item, action.doing);
        return action.pill
          ? <Pill key={`${action.key}${i}`} label={label} face={action.face} onPress={press} />
          : <Button key={`${action.key}${i}`} label={label} face={action.face} onPress={press}
              style={{ flex: 1, minWidth: 120 }} />;
      })} />
  );
}

/** Nothing is waiting on anybody. A designed state and not an absence: the
 *  structure of the screen stays — the title, the count, the line under it —
 *  and the middle says so in words, with what was finished today under it where
 *  anything can be counted.
 *
 *  It is the same sentence the Dashboard's calm block counts with
 *  (`calmDone`), because it is the same figure: every repository every product
 *  owns, since midnight on the machine that answered. */
function Calm({ view }: { view: { totals: { doneToday: number | null } } }) {
  const T = useT();
  const { doneToday } = view.totals;
  return (
    <EmptyState title={T('waitCalm')} body={T('waitCalmBody')}
      foot={doneToday ? T(doneToday === 1 ? 'calmDoneOne' : 'calmDone', { n: doneToday }) : undefined} />
  );
}
