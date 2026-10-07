import React from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, useT } from '../src/store';
import { useDivanView } from '../src/queue';
import { projectState } from '../src/shell';
import {
  LANDINGS, SUMMARY_MAX, draft, filing, opens, writer, type Landing,
} from '../src/compose';
import { Button, EmptyState, Segments } from '../src/components/divan';
import type { Key } from '../src/i18n';
import { ComposeBar, ComposeFoot, ProjectRow, SentenceBox, TitleBox } from '../src/components/compose';
import { Text } from '../src/components/text';
import { useTokens } from '../src/theme';

/** New ticket (HANDOVER §4.5, Mobile8 S9).
 *
 *  A title and, if there is one, two or three sentences, then where it goes —
 *  Ice Box (the default), Queued or Start now — and Create. That is the whole
 *  screen: no executor picker, no brief, no wizard and nothing to approve. It
 *  opens from `+ ticket` on any board and from the empty board's own button,
 *  in both cases with that product already chosen, and it comes up over the
 *  board rather than replacing it — writing a card down should not lose the
 *  page it was thought of on.
 *
 *  **Everything it decides is in `src/compose.ts`** — which computer takes the
 *  card, what counts as enough to file, and what the request carries — so
 *  `scripts/test-new-ticket.cjs` can hold this screen to all of it without a
 *  phone. What is left here is the arrangement and the one thing that file
 *  cannot do: press the button and say what came back.
 *
 *  Ice Box and Queued are piles; Start now files the card straight into In
 *  Progress, which is what starts the work — the same as dragging it there,
 *  and like the drag it asks nothing first.
 *
 *  A card is written on one machine even where the product is on three. When
 *  that machine does not take it, what was typed stays in the boxes and the
 *  line above the buttons says which computer refused — the alternative is a
 *  screen that closes on a card nobody has. */
/** The words on the segment. */
const LANDING_LABEL: Record<Landing, Key> = { ice_box: 'bdIceBox', queued: 'bdQueued', in_progress: 'ntStartNow' };

export default function NewTicket({ opening = '', sentences = '' }: {
  /** What the two boxes open with. Both empty from every way in that exists —
   *  `+ ticket` and the empty board's button open an empty card — and taken as
   *  props rather than read from nothing so that a check can hand this screen
   *  the words a keyboard would (`scripts/test-new-ticket.cjs`). */
  opening?: string;
  sentences?: string;
}) {
  const router = useRouter();
  const T = useT();
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const view = useDivanView();
  const createCard = useStore((s) => s.createCard);
  const params = useLocalSearchParams<{ project?: string; into?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;

  // Which product, in the address rather than in a `useState`, the way the
  // board keeps its column: a redraw lands on the product somebody picked.
  const project = opens(view, one(params.project));
  // Where it goes, in the address too: Ice Box unless somebody chose.
  const into: Landing = LANDINGS.find((l) => l === one(params.into)) ?? 'ice_box';
  const index = project ? view.projects.findIndex((p) => p.key === project.key) : -1;
  const to = writer(view, project);

  const [title, setTitle] = React.useState(opening);
  const [text, setText] = React.useState(sentences);
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const d = draft(title, text);
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/dashboard');
  };

  /** File it, and land on the column it went into — the card is drawn there,
   *  which is the difference between a screen that says it filed something and
   *  one that shows it. The board is told about the card as it is made (the
   *  store's `createCard`, `compose.filed`), so what comes up has it on it
   *  whatever any machine's next answer is doing. */
  const file = async (into: Landing) => {
    if (!d.ready || !to || !project || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await createCard({ host: to.host, card: filing(to, d, into) });
      router.replace(`/dashboard?project=${project.key}&tab=board&col=${into}`);
    } catch (e: any) {
      setFailed(e?.message || T('ntNotFiled', { machine: to.machine }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ComposeBar cancel={T('cancel')} project={project?.name} index={index < 0 ? null : index}
          open={picking} onCancel={leave}
          onProject={view.projects.length > 1 ? () => setPicking((was) => !was) : undefined} />
        {picking && (
          <ProjectRow value={project?.key ?? null}
            projects={view.projects.map((p) => ({ key: p.key, label: p.name, state: projectState(p) }))}
            onPick={(key) => { setPicking(false); router.setParams({ project: key }); }} />
        )}
        {!project || !to ? (
          <EmptyState title={T('ntNowhere')} body={T('ntNowhereBody')} />
        ) : (
          /* S9's body: `padding:4px 22px 0` with `gap:10`. */
          <View style={{ paddingTop: 4, paddingHorizontal: 22, gap: 10 }}>
            <TitleBox label={T('ntTitle')} value={title} onChangeText={setTitle} placeholder={T('ntTitleHint')} editable={!busy} />
            <SentenceBox label={T('ntSentences')} value={text} onChangeText={setText} placeholder={T('ntSummaryHint')} editable={!busy} />
            <ComposeFoot note={T('ntLater')} count={T('ntCount', { n: d.used, max: SUMMARY_MAX })} />
            {/* One line, and it is the machine's: that this product's only
                computer has been quiet, or that it would not take the card.
                Both are about the same computer, so they take the same slot. */}
            {(!!failed || to.quiet) && (
              <Text style={{ fontSize: 12.5, lineHeight: 12.5 * 1.4, color: failed ? t.red : t.amber }}>
                {failed || T('ntQuiet', { machine: to.machine })}
              </Text>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <Segments value={into} onChange={(key) => router.setParams({ into: key })} style={{ flex: 1 }}
                segments={LANDINGS.map((l) => ({ key: l, label: T(LANDING_LABEL[l]) }))} />
              <Button label={T('ntCreate')} face="ink" onPress={() => void file(into)}
                style={{ height: 44, paddingHorizontal: 18, opacity: d.ready && !busy ? 1 : 0.4 }} />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
