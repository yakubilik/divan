import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { useDivanView } from '../src/queue';
import { short } from '../src/compose';
import {
  actions, buckets, executorFace, headline, source, type Bucketed, type Doing, type Entry, type Item,
  type OpenEntry,
} from '../src/waiting';
import { Button, Pill, SectionHeader } from '../src/components/divan';
import { BackRow, WaitingCard } from '../src/components/waiting';
import { SayBox } from '../src/components/card';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';
import { Shell } from '../src/components/shell';

/** Waiting on you (HANDOVER §4.6): everything that needs a person, across every
 *  project and every computer, on one page.
 *
 *  The title says the counts (`2 answers, 1 task.`), and under it three groups,
 *  oldest first: An agent is asking · A decision · On your plate. Everything
 *  that can be answered in one press is: an answer the question offers in its
 *  own words is a pill that sends the note to the queue that asked, on the
 *  machine that asked; a card that is yours is `Mark done`; a Still open item
 *  is `Mark done` and `Comment`. Every item can be opened as its ticket. With
 *  nothing waiting the page is one sentence.
 *
 *  What is in which group, what each item offers and the title are
 *  `src/waiting.ts`, where `scripts/test-waiting.cjs` reaches them without a
 *  phone. This file is the arrangement, and what happens while a request is
 *  out. */
export default function Waiting() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const answerCard = useStore((s) => s.answerCard);
  const moveCard = useStore((s) => s.moveCard);
  const openItem = useStore((s) => s.openItem);

  const groups = buckets(view);
  const title = headline(groups).map((p) => T(p.key, p.params)).join(', ');
  const empty = !groups.length;

  /** What a press on one item is doing right now. Keyed by the item, because
   *  two of them can be answered one after the other without waiting. */
  const [busy, setBusy] = React.useState<Record<string, { sending?: boolean; error?: string; done?: string }>>({});

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/dashboard');
  };

  const run = async (id: string, machine: string, work: () => Promise<unknown>, done?: string) => {
    setBusy((had) => ({ ...had, [id]: { sending: true } }));
    try {
      await work();
      // The board was re-read by the write, so the item is about to leave this
      // list on its own; a comment stays, and says it went.
      setBusy((had) => {
        const next = { ...had };
        if (done) next[id] = { done }; else delete next[id];
        return next;
      });
    } catch (e: any) {
      // A machine that did not answer is the one thing this page must say out
      // loud: an answer that silently did not arrive is worse than none.
      setBusy((had) => ({ ...had, [id]: { error: e?.message ?? machine } }));
    }
  };

  const act = (entry: Entry, item: Item, doing: Doing) => {
    if (doing.do === 'open') {
      go(() => router.push(`/card/${doing.card}?host=${doing.host}&from=waiting`));
      return;
    }
    void run(entry.id, item.machine, () => (doing.do === 'note'
      ? answerCard({ ticket: doing.ticket, host: doing.host }, doing.text)
      : moveCard(doing)));
  };

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16, paddingBottom: 24, gap: 24 }}>
        <View style={{ gap: 8 }}>
          <BackRow label={T('overview')} onPress={back} style={{ paddingHorizontal: 4 }} />
          <Text style={{ fontSize: 30, lineHeight: 34, fontWeight: '500', letterSpacing: -1, paddingHorizontal: 4 }}>
            {empty ? title : `${title}.`}
          </Text>
          {!empty && (
            <Text style={{ fontSize: 15, lineHeight: 22, color: t.ink2, paddingHorizontal: 4 }}>{T('waitOldest')}</Text>
          )}
        </View>
        {groups.map((g) => (
          <Group key={g.bucket} group={g}>
            {g.entries.map((entry) => (entry.kind === 'card' ? (
              <CardRow key={entry.id} entry={entry} item={entry.item} state={busy[entry.id]} onDo={act} />
            ) : (
              <OpenRow key={entry.id} entry={entry.open} state={busy[entry.id]}
                onDone={() => void run(entry.id, entry.open.project, () => openItem(
                  { host: entry.open.host, project: entry.open.projectId, item: entry.open.id }, { set: { state: 'done' } }))}
                onComment={(text) => run(entry.id, entry.open.project, () => openItem(
                  { host: entry.open.host, project: entry.open.projectId, item: entry.open.id }, { comment: text }),
                  T('waitCommented'))} />
            )))}
          </Group>
        ))}
      </ScrollView>
    </Shell>
  );
}

function Group({ group, children }: { group: Bucketed; children: React.ReactNode }) {
  const T = useT();
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title={T(group.label)}
        right={group.bucket === 'plate' ? T('wgPlateNote') : String(group.entries.length)} />
      {children}
    </View>
  );
}

/** The mono line under a press: what it is doing, or why it did not happen. */
function noteFor(T: ReturnType<typeof useT>, machine: string, stale: boolean,
                 state?: { sending?: boolean; error?: string; done?: string }) {
  return state?.sending ? { text: T('waitSending'), tone: 'ink3' as const }
    : state?.error != null ? { text: T('waitNotSent', { machine }), tone: 'red' as const }
    : state?.done ? { text: state.done, tone: 'ink3' as const }
    : stale ? { text: T('waitStale', { machine }), tone: 'amber' as const }
    : null;
}

/** A question, a decision, or a card that is yours. */
function CardRow({ entry, item, state, onDo }: {
  entry: Entry;
  item: Item;
  state?: { sending?: boolean; error?: string; done?: string };
  onDo: (entry: Entry, item: Item, doing: Doing) => void;
}) {
  const T = useT();
  const list = actions(item);
  const note = noteFor(T, item.machine, item.stale, state);
  return (
    <WaitingCard face={executorFace(item.card)} who={T(item.who)}
      from={T(source(item).key, source(item).params)}
      age={item.age == null ? null : short(item.age)}
      said={item.kind === 'yours' ? item.card.title : item.said} asked={item.asked}
      stuck={item.kind === 'stuck' ? T('stStuck') : null}
      note={note?.text} tone={note?.tone}
      actions={list.map((action, i) => {
        const label = action.label ?? T(action.key);
        const press = state?.sending ? undefined : () => onDo(entry, item, action.doing);
        return action.pill
          ? <Pill key={`${action.key}${i}`} label={label} face={action.face} onPress={press} />
          : <Button key={`${action.key}${i}`} label={label} face={action.face} onPress={press}
              style={{ flex: 1, minWidth: 120 }} />;
      })} />
  );
}

/** A Still open item that is yours: Mark done, and a line in its thread. */
function OpenRow({ entry, state, onDone, onComment }: {
  entry: OpenEntry;
  state?: { sending?: boolean; error?: string; done?: string };
  onDone: () => void;
  onComment: (text: string) => Promise<void>;
}) {
  const T = useT();
  const router = useRouter();
  // Which item's comment box is open is in the address, and what is typed in
  // it is a draft in the store: neither is lost to a redraw.
  const params = useLocalSearchParams<{ comment?: string }>();
  const key = `${entry.host}:${entry.id}`;
  const writing = params.comment === key;
  const words = useStore((s) => s.drafts?.[`comment:${key}`]?.text ?? '');
  const keep = useStore((s) => s.setDraft);
  const setWords = (text: string) => keep(`comment:${key}`, { text });
  const note = noteFor(T, entry.project, false, state);
  return (
    <WaitingCard face="you" who={T('exYou')}
      from={T('waitStillOpen', { project: entry.project })}
      age={entry.age == null ? null : short(entry.age)}
      said={entry.item.title} note={note?.text} tone={note?.tone}
      body={entry.item.body || null}
      actions={(
        <>
          <Button label={T('waitDone')} face="ink" onPress={state?.sending ? undefined : onDone}
            style={{ flex: 1, minWidth: 120 }} />
          <Button label={T('waitComment')} face="outline" onPress={() => router.setParams({ comment: writing ? '' : key })}
            style={{ flex: 1, minWidth: 120 }} />
        </>
      )}
      after={writing ? (
        <SayBox value={words} onChangeText={setWords} busy={state?.sending}
          placeholder={T('waitCommentBox')} foot="" label={T('waitCommentBox')}
          onSend={() => {
            const text = words.trim();
            if (!text) return;
            setWords('');
            router.setParams({ comment: '' });
            void onComment(text);
          }} />
      ) : null} />
  );
}
