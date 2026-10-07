import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useT } from '../../src/store';
import { useNavGuard } from '../../src/nav';
import { useDivanView } from '../../src/queue';
import { since } from '../../src/tickets';
import { clock, type Ago, type Said } from '../../src/dashboard';
import { connected, oldWords } from '../../src/project';
import {
  PULLS, checkWords, commits, dense, find, head, landedWords, log,
  numbers, pulls, repos, status, tickets, type Found,
} from '../../src/branch';
import type { DivanView } from '../../src/divan';
import { EmptyState, SectionHeader } from '../../src/components/divan';
import {
  CommitRow, LogRow, Nothing, PullRow, RepoRow, TicketRow,
} from '../../src/components/branch';
import { Figures } from '../../src/components/project';
import { BackRow } from '../../src/components/waiting';
import { Text } from '../../src/components/text';
import { em, useTokens } from '../../src/theme';
import { Shell } from '../../src/components/shell';

/** One branch of one product, opened (HANDOVER §4.7) — the same layout for
 *  every branch.
 *
 *  The title, one sentence about what the branch is doing with how long ago
 *  that was true, two or three figures, then the branch's own list (on
 *  Engineering: its repositories, what landed in them and what is open on the
 *  code host), its tickets, and "What the agent did" — the desktop's side
 *  column, dropped below. A branch nothing feeds says `Source not connected
 *  yet.` and nothing else: no figure, no list. Its cards are still on the board.
 *
 *  **Nothing here is invented.** Every figure is a count off the board; the
 *  frame's own measurements (clicks, test totals, deploys) have no source and
 *  are not drawn. A machine that has gone quiet is said out loud under the
 *  sentence, and a log line from it carries its clock in amber.
 *
 *  The judgements are `src/branch.ts` and `src/project.ts`, held by
 *  `scripts/test-project.cjs`. The branch is addressed by kind and not by id
 *  (`/branch/seo?project=quire`): two computers give the same branch two ids. */
export default function BranchScreen() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const view = useDivanView();
  const params = useLocalSearchParams<{ id?: string; project?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;
  const key = one(params.project);
  const found = find(view, key, one(params.id));
  const ago: Ago = (seconds) => since(seconds, T);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(key ? `/dashboard?project=${key}` : '/dashboard');
  };

  return (
    <Shell place="dashboard" badge={view.totals.needsYou}>
      {/* `flexGrow` so that a branch with nothing on it, which centres itself in
          what it is given, has the page to centre itself in. Mobile9 S10's own
          body: `padding:8px 20px 0; gap:12`. */}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 24, gap: 12 }}>
        <BackRow label={found ? found.project.name : T('overview')} onPress={back}
          style={{ paddingHorizontal: 4 }} />
        {found
          ? <Page view={view} found={found} ago={ago} onOpen={(id, host) =>
              go(() => router.push(`/card/${id}?host=${host}`))} />
          : (
            /* The product is not on this phone, or it has no branch by this
               name: a computer that is not paired, a project that was archived,
               a link somebody kept. Said as what it is. */
            <EmptyState title={T('bpGone')} body={T('bpGoneBody')} />
          )}
      </ScrollView>
    </Shell>
  );
}

/** When anything on this branch was last true: its own summary, or the newest
 *  card on it. Null where nothing has ever been said. */
export function updatedAt(b: { summary_at: number | null; kind: string },
                          cards: { branch: string; agent_status_at: number | null; updated_at: number }[]): number | null {
  const times = [b.summary_at, ...cards.filter((c) => c.branch === b.kind).map((c) => c.agent_status_at ?? c.updated_at)]
    .filter((x): x is number => typeof x === 'number' && x > 0);
  return times.length ? Math.max(...times) : null;
}

/** The page itself, once there is a branch to draw (HANDOVER §4.7): the title,
 *  one sentence and how long ago it was true, two or three figures, the
 *  branch's own list and its tickets, and what the agent did — the side column,
 *  dropped below. A branch nothing feeds says one sentence and nothing else. */
function Page({ view, found, ago, onOpen }: {
  view: DivanView;
  found: Found;
  ago: Ago;
  onOpen: (card: string, host: string) => void;
}) {
  const T = useT();
  const t = useTokens();
  const { project: p, branch: b } = found;
  const now = view.now;
  const who = head(p, b, now);
  const line = status(p, b);
  const stale = oldWords(p, now, ago);
  const said = (x: Said) => T(x.key, x.params);

  const title = (
    <Text style={{ fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: em(28, -0.025), paddingHorizontal: 4 }}>
      {who.name}
    </Text>
  );

  if (!connected(p, b)) {
    return (
      <View style={{ flexGrow: 1, gap: 8 }}>
        {title}
        <Text style={{ fontSize: 15, lineHeight: 22, color: t.ink2, paddingHorizontal: 4 }}>{T('brNoSource')}</Text>
      </View>
    );
  }

  const at = updatedAt(b, p.cards);
  const sentence = (line.said ? said(line.said) : line.text).replace(/[.\s]+$/, '');
  const updated = at == null ? '' : now - at < 60 ? T('brUpdatedNow') : T('brUpdated', { d: T('maAgo', { d: ago(Math.max(0, now - at)) }) });

  const moments = log(view, p, b);
  const rows = tickets(view, p, b, ago);
  const code = dense(b);
  const owned = repos(p);
  const landed = commits(p, now);
  const review = pulls(p);
  const figs = numbers(b).slice(0, 3);

  return (
    <View style={{ flexGrow: 1, gap: 12 }}>
      {title}
      <Text style={{ fontSize: 15, lineHeight: 22, color: t.ink2, paddingHorizontal: 4 }}>
        {[sentence ? `${sentence}.` : '', updated].filter(Boolean).join(' ')}
      </Text>
      {!!stale && (
        <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2, paddingHorizontal: 4 }}>
          {said(stale)}
        </Text>
      )}
      {figs.length > 0 && (
        <Figures figures={figs.map((f) => ({ value: f.value, label: T(f.label) }))}
          style={{ paddingHorizontal: 4 }} />
      )}

      {/* The branch's own list: engineering's repositories, what landed in
          them and what is open on the code host. */}
      {code && (
        <>
          <View style={{ gap: 2 }}>
            <SectionHeader title={T('bpRepos')} count={owned.length || null} />
            {owned.length === 0
              ? <Nothing text={T('bpReposNone')} />
              : owned.map((r, i) => (
                <RepoRow key={r.path} first={i === 0} name={r.name}
                  machines={r.machines.join(', ')} />
              ))}
          </View>
          <View style={{ gap: 2 }}>
            <SectionHeader title={T('bpCommits')} />
            {landed.length === 0
              ? <Nothing text={T('bpCommitsNone')} />
              : landed.map((l, i) => (
                <CommitRow key={l.path} first={i === 0} name={l.name}
                  said={l.said ? said(l.said) : null} tone={l.tone}
                  landed={said(landedWords(l))} />
              ))}
          </View>
          <View style={{ gap: 2 }}>
            <SectionHeader title={T(PULLS.key)} count={review?.length || null} />
            {review == null ? <Nothing text={T(PULLS.body)} />
              : review.length === 0 ? <Nothing text={T('bpPullsNone')} />
              : review.map((x, i) => {
                const checks = checkWords(x);
                return (
                  <PullRow key={`${x.repo}#${x.number}`} first={i === 0} number={x.number}
                    title={x.title}
                    note={[owned.length > 1 ? x.repo : '', x.draft ? T('bpDraft') : '']
                      .filter(Boolean).join(' · ')}
                    checks={checks ? { text: said(checks.said), tone: checks.tone } : null} />
                );
              })}
          </View>
        </>
      )}

      <View style={{ gap: 2 }}>
        <SectionHeader title={T('brTickets')} count={rows.length || null} />
        {rows.length === 0
          ? <Nothing text={T('brNoTickets')} />
          : rows.map((r, i) => (
            <TicketRow key={r.card.id} first={i === 0} face={r.face} title={r.card.title}
              column={T(r.column)} machine={r.machine}
              mark={r.mark ? { text: `${r.mark.mark} ${T(r.mark.key, r.mark.params)}`.trim(), tone: r.mark.tone } : null}
              onPress={() => onOpen(r.card.id, r.card.host)} />
          ))}
      </View>

      <View style={{ gap: 2 }}>
        <SectionHeader title={T('brDid')} />
        {moments.length === 0
          ? <Nothing text={T('brNothingDone')} />
          : moments.map((m, i) => (
            <LogRow key={`${m.at}-${i}`} first={i === 0} at={clock(m.at)} stale={m.stale}
              text={m.who ? T('bpDid', { who: T(m.who), what: m.text }) : m.text}
              machine={m.machine} />
          ))}
      </View>
    </View>
  );
}
