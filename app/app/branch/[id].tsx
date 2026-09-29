import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useT } from '../../src/store';
import { useNavGuard } from '../../src/nav';
import { useDivanView } from '../../src/queue';
import { since } from '../../src/tickets';
import { clock, type Ago, type Said } from '../../src/dashboard';
import { oldWords } from '../../src/project';
import {
  OVER_TIME, PULLS, bare, commits, dense, find, head, landedWords, log, logTitle, numbers,
  repos, status, tickets, type Found,
} from '../../src/branch';
import type { DivanView } from '../../src/divan';
import { EmptyState, SectionHeader } from '../../src/components/divan';
import { BranchHead, CommitRow, LogRow, Nothing, NoSource, RepoRow, TicketRow } from '../../src/components/branch';
import { Figures } from '../../src/components/project';
import { BackRow } from '../../src/components/waiting';
import { Text } from '../../src/components/text';
import { useTokens } from '../../src/theme';
import { Shell } from '../../src/components/shell';

/** One branch of one product, opened — Mobile9 S10 and S11.
 *
 *  **There is one page here, not two.** S10 is SEO and S11 is Engineering, and
 *  the frames' own note settles what the difference is: Engineering "adds three
 *  blocks of the same kind between the chart and the log. The layout doesn't
 *  depend on them: without them it's the SEO page." So this file draws one
 *  sequence — who the branch is, how it is, its numbers, its numbers over time,
 *  what its agent did, the cards that belong to it — and slides Engineering's
 *  three blocks into the middle of it. A branch kind nobody has thought of yet
 *  gets the whole page without them, and that is the point of the design.
 *
 *  Three things are true of everything on it:
 *
 *  **Nothing here is invented.** The frames put a branch's own measurements at
 *  the top (`6,412 clicks 28d`, `11.3 avg position`, `212/214 tests`, `v3.18
 *  deployed`) and a thirty-day chart under them, and no source for any of that
 *  is connected yet. What is drawn instead is what exists: the board's own
 *  counts, the repositories the product owns and what git says landed in them,
 *  and the mirror's own words about what ran. Every block whose source is
 *  missing keeps its place and says so — a page that silently dropped its chart
 *  would read as a page that never had one.
 *
 *  **A machine that has gone quiet is said out loud.** A branch's cards can come
 *  off two computers. When one of them stops answering, the sentence under the
 *  title says which and how old this is (the project page's own `oldWords`), and
 *  the clock on a log line from that machine goes amber: it is the last thing
 *  that computer said, not the last thing that happened.
 *
 *  **The judgements are not in here.** What each block says is `src/branch.ts`,
 *  so that the checks in `scripts/test-project.cjs` can hold this screen to it
 *  without a phone. What is left in this file is the arrangement.
 *
 *  It is pushed over the Dashboard, from the branch's card on the product's page
 *  — the frame draws `‹ Quire` at the top and the Dashboard tab still lit. The
 *  branch is addressed by kind and not by id (`/branch/seo?project=quire`): two
 *  computers are two databases and give the same branch two ids, and the pair
 *  that survives the merge is the product's key and the branch's kind. */
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

/** The page itself, once there is a branch to draw. */
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

  const intro = (
    <>
      <BranchHead name={who.name} project={who.project} state={who.state}
        refreshed={who.refreshed ? said(who.refreshed.said) : null}
        tone={who.refreshed?.tone ?? null} />
      {!!stale && (
        <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2, paddingHorizontal: 4 }}>
          {said(stale)}
        </Text>
      )}
      <Text style={{ fontSize: 14.5, lineHeight: 14.5 * 1.4, color: t.ink2, paddingHorizontal: 4 }}>
        {line.said ? said(line.said) : line.text}
      </Text>
    </>
  );

  // A face of a product nobody has used yet: no card, no summary, nothing
  // running. The design's rule for an empty screen is that the structure stays
  // legible, and four empty blocks are not structure — so it keeps its head and
  // says the one thing that is true of it (Mobile7 S6's own shape).
  if (bare(p, b, now)) {
    return (
      <View style={{ flexGrow: 1, gap: 12 }}>
        {intro}
        <EmptyState title={T('bpBareTitle')} body={T('bpBare')} />
      </View>
    );
  }

  const moments = log(view, p, b);
  const rows = tickets(view, p, b, ago);
  const code = dense(b);
  const owned = repos(p);
  const landed = commits(p, now);

  return (
    <View style={{ flexGrow: 1, gap: 12 }}>
      {intro}
      <Figures figures={numbers(b).map((f) => ({ value: f.value, label: T(f.label) }))}
        style={{ paddingHorizontal: 4 }} />
      <NoSource label={T(OVER_TIME.key)} body={T(OVER_TIME.body)} />

      {/* Engineering's three, between the chart and the log (S11). Two of them
          have a source on the machine that holds the checkout; the third is the
          code host's and says so. */}
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
            <SectionHeader title={T(PULLS.key)} />
            <Nothing text={T(PULLS.body)} />
          </View>
        </>
      )}

      <View style={{ gap: 2 }}>
        <SectionHeader title={T(logTitle(moments))} />
        {moments.length === 0
          ? <Nothing text={T('bpLogNothing')} />
          : moments.map((m, i) => (
            <LogRow key={`${m.at}-${i}`} first={i === 0} at={clock(m.at)} stale={m.stale}
              text={m.who ? T('bpDid', { who: T(m.who), what: m.text }) : m.text}
              machine={m.machine} />
          ))}
      </View>

      <View style={{ gap: 2 }}>
        <SectionHeader title={T('bpTickets')} count={rows.length || null} />
        {rows.length === 0
          ? <Nothing text={T('bpNoTickets')} />
          : rows.map((r, i) => (
            <TicketRow key={r.card.id} first={i === 0} face={r.face} title={r.card.title}
              column={T(r.column)} machine={r.machine}
              mark={r.mark ? { text: `${r.mark.mark} ${T(r.mark.key, r.mark.params)}`.trim(), tone: r.mark.tone } : null}
              onPress={() => onOpen(r.card.id, r.card.host)} />
          ))}
      </View>
    </View>
  );
}
