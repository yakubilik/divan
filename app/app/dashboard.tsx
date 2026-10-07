import React from 'react';
import { ScrollView, View, type GestureResponderEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useNavGuard } from '../src/nav';
import { type Key } from '../src/i18n';
import { useDivanView, useQueueBadge } from '../src/queue';
import {
  COLUMNS, project as projectIn, stuck, type DivanView, type MergedCard, type MergedProject,
} from '../src/divan';
import { PLACE_ROUTE } from '../src/shell';
import type { Agent, DivanColumn, Provider } from '../src/protocol';
import { since } from '../src/tickets';
import {
  age, agentRows, clock, dormant, freshness, latest, line, pausedWords, staleness, staleWords, target,
  type Ago, type Said,
} from '../src/dashboard';
import {
  blank, blankBody, branchCards, nowWords, oldWords, quiet, subtitle, waitingWords, type Line,
} from '../src/project';
import {
  COLUMN_LABEL, OPENS_ON, faces, foot, items, spread, tabs, tally, type Face, type Item,
} from '../src/board';
import {
  KIND_TONE, actions, items as waitingItems, type Doing, type Item as WaitItem,
} from '../src/waiting';
import {
  MODES, MODE_COLUMN, NO_DRAFT, accountValues, cardOf, draft as draftOf, filing, greeting, limitsKey,
  lowQuota, mention, modelOptions, modelValue, readModel, short, summary, writer, type Mode,
} from '../src/compose';
import { WARN_AT } from '../src/machine';
import {
  SETTLE_MS, back, carry, foot as dropFoot, hint, says, type Carried, type Landed,
} from '../src/drag';
import { Button, ColumnTabs, EmptyState, ListRow, SectionHeader, Segments, Tap } from '../src/components/divan';
import {
  Greeting, LiveRow, Note, NoteFoot, QuietRow, Rows, Tile, WaitCard,
} from '../src/components/dashboard';
import { Composer } from '../src/components/compose';
import { BranchCard, ProjectHead, QuietNote, StateLines } from '../src/components/project';
import { BoardCard, ColumnLine } from '../src/components/board';
import { DragHint, DropSlot, Float, useDrag } from '../src/components/drag';
import { Text } from '../src/components/text';
import { useTokens, type State } from '../src/theme';
import { Shell } from '../src/components/shell';

/** The Dashboard (HANDOVER §4.1, DashboardPhone): the line over it, a greeting
 *  and one counted sentence, the Composer, what needs you, the products as
 *  tiles — the dormant ones last, as one-line rows — and what is working now.
 *
 *  Nothing here is invented: every figure is counted off the boards, a section
 *  with nothing in it is not drawn, and a zero is said in words. The rules are
 *  `src/dashboard.ts`, `src/waiting.ts` and `src/compose.ts`, where a check can
 *  reach them without a phone.
 *
 *  Selecting a project enters it, in the address (`/dashboard?project=quire`),
 *  so it survives a redraw and can be linked to; the line's left end leads back
 *  out of it. */
export default function Dashboard() {
  const router = useRouter();
  const go = useNavGuard();
  const T = useT();
  const t = useTokens();
  const view = useDivanView();
  const queue = useQueueBadge();
  const now = view.now;
  const host = useStore((s) => s.host);
  const params = useLocalSearchParams<{ project?: string; tab?: string; col?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;
  const selected = one(params.project);
  const picked = selected ? projectIn(view, selected) : null;
  const face: Face = one(params.tab) === 'board' ? 'board' : 'overview';
  const col = COLUMNS.find((c) => c === one(params.col)) ?? OPENS_ON;
  const enter = (key: string | null) => router.setParams({ project: key ?? '' });
  const open = (what: { ustabasi_id: number | null; host: string; projectKey: string }) => {
    const where = target(what, host?.id);
    if ('ticket' in where) go(() => router.push(`/ticket/${where.ticket}`));
    else enter(where.project);
  };
  const ago: Ago = (seconds) => since(seconds, T);
  const old = staleness(view);

  if (picked) {
    const product = (
      <Project project={picked} index={view.projects.findIndex((p) => p.key === picked.key)}
        view={view} now={now} ago={ago} face={face} column={col}
        onFace={(to) => router.setParams({ tab: to })}
        onColumn={(to) => router.setParams({ col: to })}
        onOpen={(c) => go(() => router.push(`/card/${c.id}?host=${c.host}`))} />
    );
    return (
      <Shell place="dashboard" back={{ label: T('tabDashboard'), onPress: () => enter(null) }}>
        {face === 'board' ? product : (
          <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}>
            {product}
          </ScrollView>
        )}
      </Shell>
    );
  }

  const awake = view.projects.filter((p) => !dormant(p, now));
  const asleep = view.projects.filter((p) => dormant(p, now));
  const index = (key: string) => view.projects.findIndex((p) => p.key === key);
  const pairs: MergedProject[][] = [];
  for (let i = 0; i < awake.length; i += 2) pairs.push(awake.slice(i, i + 2));
  const rows = agentRows(view);

  return (
    <Shell place="dashboard">
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 40, gap: 28 }}>
        <View style={{ gap: 8 }}>
          <Greeting hello={T(greeting(new Date().getHours()))}
            said={summary(view).map((x) => ({ key: x.key, n: x.n, text: T(x.said, { n: x.n }) }))} />
          {!!old && (
            <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2 }}>{said(T, staleWords(old, ago))}</Text>
          )}
        </View>
        <DashComposer view={view} />
        <Paused view={view} ago={ago} />
        <Waiting view={view} />
        {view.projects.length === 0 ? <Nothing /> : (
          <View style={{ gap: 12 }}>
            <SectionHeader title={T('projects')}
              right={asleep.length ? T('cmProjectsMeta', { n: view.projects.length, q: asleep.length })
                : String(view.projects.length)} />
            {pairs.map((pair) => (
              <View key={pair.map((p) => p.key).join('+')} style={{ flexDirection: 'row', gap: 12 }}>
                {pair.map((p) => <ProductTile key={p.key} project={p} index={index(p.key)} now={now} ago={ago}
                  onPress={() => enter(p.key)} />)}
                {pair.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            ))}
            {!!asleep.length && (
              <Rows>
                {asleep.map((p, i) => (
                  <QuietRow key={p.key} first={i === 0} name={p.name} index={index(p.key)}
                    meta={T('cmQuiet', { age: short(age(p, now) ?? 0) })} onPress={() => enter(p.key)} />
                ))}
              </Rows>
            )}
          </View>
        )}
        {!!rows.length && (
          <View style={{ gap: 12 }}>
            <SectionHeader title={T('cmWorkingNow')} right={String(rows.length)} />
            <Rows>
              {rows.map((r, i) => {
                const name = view.projects[r.index]?.name ?? r.agent.project;
                const when = r.agent.unknown ? T('pfLastSeen', { time: clock(r.agent.since_contact) })
                  : r.agent.since == null ? '' : short(now - r.agent.since);
                return (
                  <LiveRow key={`${r.agent.host}:${r.agent.card_id}`} first={i === 0}
                    state={r.agent.unknown ? 'asking' : r.tone === 'red' ? 'stuck' : 'running'}
                    title={r.agent.title}
                    meta={[name, T(r.who), r.agent.machine || r.agent.hostName, when].filter(Boolean).join(' · ')}
                    onPress={() => open(r.agent)} />
                );
              })}
            </Rows>
          </View>
        )}
        {/* Work rather than infrastructure: the queue this computer is working
            through, and every conversation it has. */}
        <View>
          {queue.available && (
            <ListRow first icon="terminal" title={T('ustabasi')} note={T('dashQueueNote')}
              meta={queue.red ? T('queueRed', { n: queue.red }) : undefined} tone={queue.red ? 'red' : undefined}
              onPress={() => go(() => router.push('/ustabasi'))} />
          )}
          <ListRow first={!queue.available} icon="chat_bubble" title={T('conversations')}
            note={T('dashChatsNote')} onPress={() => go(() => router.replace(PLACE_ROUTE.chat))} />
        </View>
      </ScrollView>
    </Shell>
  );
}

/** A line the judgements chose, in the reader's language. */
function said(T: ReturnType<typeof useT>, x: Said): string {
  return T(x.key, x.params);
}

/** Out of quota (Mobile5 S2). Red, and not an alarm: what stopped, that nothing
 *  was lost, and exactly when it starts again. */
function Paused({ view, ago }: { view: DivanView; ago: Ago }) {
  const T = useT();
  const words = pausedWords(view, ago);
  if (!words) return null;
  return (
    <Note tone="red" icon="pause" title={said(T, words.title)} body={said(T, words.body)}
      foot={words.foot.length
        ? words.foot.map((x) => <NoteFoot key={x.key} text={said(T, x)} />)
        : null} />
  );
}

/** Needs you: one card per thing waiting, answered in one press with the same
 *  call the Waiting screen sends (`src/waiting.ts actions`). With nothing
 *  waiting the section is not drawn at all. */
function Waiting({ view }: { view: DivanView }) {
  const T = useT();
  const t = useTokens();
  const router = useRouter();
  const go = useNavGuard();
  const host = useStore((s) => s.host);
  const answerCard = useStore((s) => s.answerCard);
  const move = useStore((s) => s.moveCard);
  const [busy, setBusy] = React.useState<Record<string, { sending?: boolean; error?: string; sent?: string }>>({});
  const list = waitingItems(view);
  if (!list.length) return null;
  const openCard = (item: WaitItem) => {
    const where = target({ ustabasi_id: item.card.ustabasi_id, host: item.card.host, projectKey: item.projectKey }, host?.id);
    if ('ticket' in where) go(() => router.push(`/ticket/${where.ticket}`));
    else go(() => router.push(`/card/${item.card.id}?host=${item.card.host}`));
  };
  const act = async (item: WaitItem, doing: Doing, words: string) => {
    if (doing.do === 'open') { go(() => router.push(`/ticket/${doing.ticket}`)); return; }
    const id = item.card.id;
    setBusy((had) => ({ ...had, [id]: { sending: true } }));
    try {
      if (doing.do === 'note') await answerCard({ ticket: doing.ticket, host: doing.host }, doing.text);
      else await move(doing);
      setBusy((had) => ({ ...had, [id]: { sent: words } }));
    } catch (e: any) {
      setBusy((had) => ({ ...had, [id]: { error: e?.message ?? item.machine } }));
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <SectionHeader title={T('needsYou')} count={list.length} style={{ flex: 1 }} />
        {/* The whole list, grouped, with the reply box: the screen the old
            Needs-you counter opened. */}
        <Tap onPress={() => go(() => router.push('/waiting'))}
          style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 12 }}>
          <Text mono style={{ fontSize: 11.5, color: t.ink3 }}>{T('waitTitle')}</Text>
        </Tap>
      </View>
      {list.map((item) => {
        const state = busy[item.card.id];
        const offered = actions(item, host?.id ?? null);
        const buttons: { label: string; face: 'amber' | 'ink' | 'outline' | 'ghost'; onPress?: () => void }[] =
          offered.map((a) => {
            const label = a.doing.do === 'open' ? T('cmOpen') : a.label ?? T(a.key);
            return { label, face: a.face, onPress: state?.sending ? undefined : () => { void act(item, a.doing, label); } };
          });
        if (!offered.some((a) => a.doing.do === 'open')) {
          buttons.push({ label: T('cmOpen'), face: 'ghost', onPress: () => openCard(item) });
        }
        return (
          <WaitCard key={`${item.card.host}:${item.card.id}`} project={item.project}
            index={item.index < 0 ? null : item.index}
            age={item.age == null ? null : short(item.age)}
            question={item.said} word={T(KIND_WORD[item.kind])} tone={KIND_TONE[item.kind]}
            actions={buttons}
            note={state?.sending ? T('waitSending') : state?.error != null ? T('cmNotSent', { text: state.error })
              : state?.sent ? T('cmSent', { text: state.sent }) : item.stale ? T('waitStale', { machine: item.machine }) : null}
            noteTone={state?.error != null ? 'red' : item.stale ? 'amber' : 'ink3'} />
        );
      })}
    </View>
  );
}

/** The word in a wait card's corner (`dv-status`): what this one is doing. */
const KIND_WORD: Record<WaitItem['kind'], Key> = {
  question: 'cmAsking', decision: 'cmYourCall', stuck: 'cmStuckWord', yours: 'cmYours',
};

/** One product's tile: its name, what it is doing now, and the counts under it. */
function ProductTile({ project: p, index, now, ago, onPress }: {
  project: MergedProject; index: number; now: number; ago: Ago; onPress: () => void;
}) {
  const T = useT();
  const fell = p.cards.filter(stuck).length;
  const asking = Math.max(0, p.waiting - fell);
  const ln = line(p, now);
  const fresh = freshness(p);
  const since = age(p, now);
  const counts = [
    ...(p.running > 0 ? [{ state: 'running' as State, n: p.running, word: T('cmWorking', { n: '' }).trim() }] : []),
    ...(asking > 0 ? [{ state: 'asking' as State, n: asking, word: T('cmNeeds', { n: '' }).trim() }] : []),
    ...(fell > 0 ? [{ state: 'stuck' as State, n: fell, word: T('cmStuck', { n: '' }).trim() }] : []),
  ];
  return (
    <Tile name={p.name} index={index} onPress={onPress}
      now={latest(p.cards) || p.summary || T(ln.key, ln.params)} counts={counts}
      when={fresh ? T(fresh.key, fresh.params) : since == null ? null : short(since)} />
  );
}

/** The Composer, wired: Ask opens a chat and goes to it, Ice Box and Start now
 *  write the card. No dialog in any of the three. */
function DashComposer({ view }: { view: DivanView }) {
  const T = useT();
  const router = useRouter();
  const go = useNavGuard();
  const host = useStore((s) => s.host);
  const draft = useStore((s) => s.compose) ?? NO_DRAFT;
  const setCompose = useStore((s) => s.setCompose);
  const catalog = useStore((s) => s.catalog);
  const defaults = useStore((s) => s.defaults);
  const accounts = useStore((s) => s.accounts) ?? [];
  const accountsLoaded = useStore((s) => s.accountsLoaded);
  const loadAccounts = useStore((s) => s.loadAccounts);
  const limits = useStore((s) => s.limits) ?? {};
  const folders = useStore((s) => s.projects) ?? [];
  const conn = useStore((s) => s.conn);
  const listAgents = useStore((s) => s.listAgents);
  const createChat = useStore((s) => s.createChat);
  const send = useStore((s) => s.send);
  const createCard = useStore((s) => s.createCard);
  const [agents, setAgents] = React.useState<Agent[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; red?: boolean } | null>(null);

  const picks = draft.picks;
  const chosen = readModel(picks.model);
  const provider: Provider = chosen?.provider ?? (catalog?.claude ? 'claude' : defaults?.provider ?? 'claude');
  const pc = catalog?.[provider] ?? null;
  const pd = defaults?.byProvider?.[provider];
  const models = modelOptions(catalog);
  const baseModel = pd?.model && pc?.models.some((m) => m.id === pd.model) ? pd.model
    : defaults?.model && pc?.models.some((m) => m.id === defaults.model) ? defaults.model : pc?.models[0]?.id ?? null;
  const model = picks.model ?? (baseModel ? modelValue(provider, baseModel) : undefined);
  const signIns = accountValues(accounts, provider);
  const stored = pd?.account_id ?? '';
  const account = picks.account ?? (signIns.some((a) => a.value === stored) || !accountsLoaded ? stored : '');
  const low = lowQuota(limits[limitsKey(provider, account)], WARN_AT) === true;
  const scope = picks.project ? view.projects.find((p) => p.key === picks.project) ?? null : null;
  const hermes = agents?.find((a) => a.name === 'hermes' || a.id === 'hermes') ?? null;

  React.useEffect(() => { if (!accountsLoaded && conn === 'online') void loadAccounts().catch(() => {}); },
    [accountsLoaded, conn, loadAccounts]);
  React.useEffect(() => {
    if (provider !== 'claude' || conn !== 'online') { setAgents(null); return; }
    let alive = true;
    listAgents(account || null, null)
      .then((list) => { if (alive) setAgents(list.filter((a) => a.installed)); })
      .catch(() => { if (alive) setAgents([]); });
    return () => { alive = false; };
  }, [provider, account, conn, listAgents]);

  const pick = (patch: Partial<typeof picks>) => setCompose({ picks: { ...picks, ...patch } });
  const reset = (key: keyof typeof picks) => {
    const next = { ...picks };
    delete next[key];
    setCompose({ picks: next });
  };
  const type = (value: string) => {
    const m = mention(view, value);
    setCompose({ text: m.text, ...(m.project ? { picks: { ...picks, project: m.project } } : {}) });
    if (note?.red) setNote(null);
  };

  const submit = async () => {
    const m = mention(view, draft.text, true);
    const key = m.project ?? picks.project ?? null;
    const words = m.text.trim();
    if (!words || busy) return;
    if (draft.mode !== 'ask' && !key) { setNote({ text: T('cmNeedsProject'), red: true }); return; }
    setBusy(true);
    setNote(null);
    try {
      const p = key ? projectIn(view, key) : null;
      if (draft.mode === 'ask') {
        if (!host || !model) throw new Error(T('cmNoComputer'));
        const mm = readModel(model)!;
        // The product's own repository, where this computer has it.
        const repo = p && p.ids[host.id] ? p.repos.find((r) => folders.some((f) => f.path === r)) ?? p.repos[0] ?? null : null;
        const cwd = repo ?? defaults?.cwd ?? folders[0]?.path ?? undefined;
        const agent = picks.agent !== undefined ? picks.agent
          : mm.provider !== 'claude' ? null
            : hermes?.id ?? (await listAgents(account || null, cwd ?? null).catch(() => [] as Agent[]))
              .find((a) => a.installed && (a.name === 'hermes' || a.id === 'hermes'))?.id ?? null;
        const pcm = catalog?.[mm.provider] ?? null;
        const pdm = defaults?.byProvider?.[mm.provider];
        const effort = [pdm?.effort, defaults?.effort].find((e) => e && pcm?.efforts.includes(e)) ?? pcm?.efforts[0] ?? null;
        const perm = [pdm?.perm_mode, defaults?.perm_mode].find((x) => x && pcm?.perm_modes.includes(x)) ?? pcm?.perm_modes[0];
        const title = cardOf(words).title;
        const chat = await createChat({
          provider: mm.provider, model: mm.model, effort, perm_mode: perm, cwd,
          account_id: account || undefined, ...(agent ? { agent_id: agent } : {}),
          title: p && !repo ? `${p.name} · ${title}` : title,
        } as any);
        await send(chat.id, p && !repo ? `${words}\n\n${T('cmAbout', { project: p.name })}` : words);
        setCompose({ text: '', picks: {} });
        go(() => router.push(`/chat/${chat.id}`));
      } else {
        const w = writer(view, p);
        if (!p || !w) throw new Error(T('cmNotOnHost', { project: p?.name ?? key ?? '' }));
        const c = cardOf(words);
        await createCard({ host: w.host, card: filing(w, draftOf(c.title, c.summary), MODE_COLUMN[draft.mode]) });
        setCompose({ text: '', picks: {} });
        setNote({ text: T('cmFiled', { col: T(COLUMN_LABEL[MODE_COLUMN[draft.mode]]), project: p.name }) });
      }
    } catch (e: any) {
      setNote({ text: e?.message ?? T('error'), red: true });
    } finally {
      setBusy(false);
    }
  };

  const agentLabel = picks.agent === undefined
    ? (provider !== 'claude' || (agents && !hermes) ? T('cmNoAgent') : T('cmHermes'))
    : picks.agent === null ? T('cmNoAgent') : (agents?.find((a) => a.id === picks.agent)?.label ?? picks.agent);
  const accountLabel = (v: string) => (v ? signIns.find((a) => a.value === v)?.label ?? v : T('cmOwnAccount'));
  const projectOptions = view.projects.map((p) => ({ value: p.key, label: p.name, checked: picks.project === p.key }));

  return (
    <Composer to={T('cmTo')}
      scope={scope ? { name: scope.name, index: view.projects.indexOf(scope) } : null}
      onClearScope={() => reset('project')} clearLabel={T('cmClearScope', { name: scope?.name ?? '' })}
      addLabel={T('cmAddProject')} emptyScope={T('cmEmptyScope')}
      scopeOptions={{ options: projectOptions, empty: T('dashEmpty'), onPick: (v) => pick({ project: v }) }}
      label={T('cmLabel')} placeholder={T('cmPlaceholder')} text={draft.text} onText={type}
      modes={MODES.map((m) => ({ key: m.key, label: T(m.label) }))} mode={draft.mode}
      onMode={(k) => { setCompose({ mode: k as Mode }); setNote(null); }}
      sendLabel={T('cmSend')} onSend={() => void submit()} busy={busy}
      note={busy ? T(draft.mode === 'ask' ? 'cmStarting' : 'cmFiling') : note?.text ?? T(MODES.find((m) => m.key === draft.mode)!.hint)}
      noteTone={note?.red ? 'red' : 'ink3'}
      more={{ label: T('cmMore'), onPress: () => go(() => router.push('/new-chat')) }}
      chips={[
        { name: T('cmProject'), value: scope ? scope.name : T('cmAuto'), changed: !!scope,
          options: [{ value: '', label: T('cmAuto'), checked: !scope }, ...projectOptions], empty: T('dashEmpty'),
          onPick: (v) => (v ? pick({ project: v }) : reset('project')), onReset: () => reset('project'),
          resetLabel: T('cmReset', { name: T('cmProject') }) },
        { name: T('cmAgent'), value: agentLabel, changed: picks.agent !== undefined,
          options: [...(agents ?? []).map((a) => ({ value: a.id, label: a.label || a.name,
            checked: (picks.agent === undefined ? hermes?.id : picks.agent) === a.id })),
          { value: '', label: T('cmNoAgent'), checked: picks.agent === null }],
          empty: T('ncReadingAgents'), onPick: (v) => pick({ agent: v || null }), onReset: () => reset('agent'),
          resetLabel: T('cmReset', { name: T('cmAgent') }) },
        { name: T('cmAccount'), value: accountLabel(account), changed: picks.account !== undefined,
          warn: low ? T('cmLowQuota') : null,
          options: signIns.map((a) => ({ value: a.value, label: accountLabel(a.value), checked: a.value === account })),
          empty: T('notSignedIn'), onPick: (v) => pick({ account: v }), onReset: () => reset('account'),
          resetLabel: T('cmReset', { name: T('cmAccount') }) },
        { name: T('cmModel'), value: models.find((o) => o.value === model)?.label ?? T('cmNoModel'),
          changed: picks.model !== undefined,
          options: models.map((o) => ({ ...o, checked: o.value === model })), empty: T('cmNoModel'),
          onPick: (v) => pick({ model: v }), onReset: () => reset('model'),
          resetLabel: T('cmReset', { name: T('cmModel') }) },
      ]} />
  );
}

/** One product alone (Mobile2 V4, Mobile7 S4): who it is, and then whichever of
 *  its two faces is open — the Overview below, or its board.
 *
 *  The frame puts three tabs over them. Two are drawn: the chats a product owns
 *  are not filed yet, and a tab that dims under a thumb and does nothing is worse
 *  than a tab that is not there.
 *
 *  The two faces scroll differently, which is the one structural difference
 *  between them. The Overview is a page and scrolls as one, inside the
 *  Dashboard's own. The board is a head and a list: its column tabs are the drop
 *  targets of the drag, and a drop target that can be scrolled off the top of the
 *  page is not a drop target — so it is pinned, the cards move under it, and that
 *  face owns its own scrolling (`board` here, and the branch in `Dashboard`).
 */
function Project({ project: p, index, view, now, ago, face, column, onFace, onColumn, onOpen }: {
  project: MergedProject; index: number; view: DivanView; now: number; ago: Ago;
  face: Face;
  column: DivanColumn;
  onFace: (to: Face) => void;
  onColumn: (to: DivanColumn) => void;
  onOpen: (card: MergedCard) => void;
}) {
  const T = useT();
  const t = useTokens();
  const stale = oldWords(p, now, ago);
  const head = (
    <>
      <ProjectHead name={p.name} index={index} note={subtitle(p)}
        right={face === 'board' ? <AddTicket project={p.key} /> : undefined} />
      {!!stale && (
        <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2, paddingHorizontal: 4 }}>
          {T(stale.key, stale.params)}
        </Text>
      )}
      {/* Mobile2 V4's segmented control: the mark on the Board tab is the worst
          thing on the board, so the face that is not open still says whether it
          needs anybody (`src/board.ts boardMark`). */}
      <Segments value={face} onChange={(key) => onFace(key as Face)}
        segments={faces(p).map((f) => ({ key: f.key, label: T(f.label), mark: f.mark, tone: f.tone }))} />
    </>
  );
  if (face === 'board') {
    // The page's own padding, which the Dashboard's scroll view was carrying
    // until this face took the scrolling off it.
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12, gap: 12 }}>{head}</View>
        <Board project={p} view={view} ago={ago} column={column} onColumn={onColumn} onOpen={onOpen} />
      </View>
    );
  }
  return (
    // `flexGrow` so that the empty page, which centres itself in what it is
    // given, has the page to centre itself in. Mobile7 S4's own body: `padding:
    // 14px 16px 0; gap:12`.
    <View style={{ flexGrow: 1, gap: 12 }}>
      {head}
      <Overview project={p} view={view} now={now} ago={ago} />
    </View>
  );
}

/** `+ ticket` at the far end of the board's head (Mobile2 V5, Mobile8 S7): mono
 *  12 in `ink3`, which is the quietest way in this design has. It is the right
 *  weight for it — writing a card down is the thing done most often here and the
 *  one that needs the least ceremony, and the screen it opens is the fastest in
 *  the product (Mobile8 S9). */
function AddTicket({ project }: { project: string }) {
  const T = useT();
  const t = useTokens();
  const router = useRouter();
  const go = useNavGuard();
  return (
    <Tap onPress={() => go(() => router.push(`/new-ticket?project=${project}`))}
      style={{ paddingVertical: 6, paddingLeft: 10 }}>
      <Text mono style={{ fontSize: 12, color: t.ink3 }}>{T('ntAdd')}</Text>
    </Tap>
  );
}

/** The Overview face (Mobile2 V4, Mobile7 S4): what is happening and what it is
 *  waiting for, over its branches as cards.
 *
 *  It carries the two states that are not that. A product nothing has touched in
 *  a fortnight gets Mobile7 S5's block where the two lines would be — "quiet for
 *  23 days", what happened last — because "nothing running, nothing waiting"
 *  said twice over a dead product is true and useless. A product whose board is
 *  still empty gets Mobile7 S6's designed state instead of a page of zeros. Which
 *  of the three it is, is `src/project.ts`'s to decide.
 *
 *  Mobile2 V4 also puts the asking agent's card here, with its two proposed
 *  answers as buttons. Mobile7 S4 draws the same page without it and with the
 *  `waiting` line instead, which is the later of the two and the one followed
 *  here: answering is a screen of its own (Mobile6 S3, reached from the
 *  Dashboard's first counter), every question is on it, and a second place to
 *  answer the same question from would be two places to keep in step.
 *
 *  Nor are the frame's own branch figures: `99.2% crash-free`, `6,412 clicks
 *  28d`, `€1,140 MRR`. Nothing is connected to those sources (the plan puts them
 *  after the screens), and the numbers drawn instead are the board's own — what
 *  is open on a branch, what is in progress, what is done. */
function Overview({ project: p, view, now, ago }: {
  project: MergedProject; view: DivanView; now: number; ago: Ago;
}) {
  const T = useT();
  const router = useRouter();
  const go = useNavGuard();
  const asleep = quiet(p, now, ago);
  const body = blankBody(p);
  const happening = nowWords(view, p);
  const pending = waitingWords(view, p);
  /** One of the two lines: every sentence it is made of, worst first, with the
   *  executor each names put into the reader's language — the same two-step the
   *  Dashboard's questions take. Several sentences where several things are true
   *  at once, which is what keeps "1 agent is running" off a page whose own card
   *  says `⏸ 1 paused`. */
  const line = (x: Line) => x.clauses
    .map((c) => T(c.said.key, c.who ? { ...c.said.params, who: T(c.who) } : c.said.params))
    .join(' ');
  if (blank(p)) {
    return <EmptyState title={T('prNewTitle')} body={T(body.key, body.params)} foot={T('prNewFoot')} />;
  }
  return (
    <View style={{ flexGrow: 1, gap: 12 }}>
      {asleep
        ? <QuietNote title={T(asleep.title.key, asleep.title.params)}
            body={T(asleep.body.key, asleep.body.params)} />
        : <StateLines rows={[
            { label: T('prNow'), text: line(happening), tone: happening.tone },
            { label: T('prWaiting'), text: line(pending), tone: pending.tone, quiet: true },
          ]} />}
      <View style={{ gap: 6 }}>
        <SectionHeader title={T('branches')} count={p.branches.length} />
        {branchCards(p, now).map((b) => (
          <BranchCard key={b.key} name={b.name} state={b.state} dim={b.dim}
            line={b.said ? T(b.said.key, b.said.params) : b.text}
            figures={b.figures.map((f) => ({ value: f.value, label: T(f.label) }))}
            refreshed={b.refreshed ? T(b.refreshed.said.key, b.refreshed.said.params) : null}
            tone={b.refreshed?.tone ?? null}
            /* Each card opens that branch's own page (Mobile9 S10, S11), by the
               kind the merge folded it under rather than by one machine's id. */
            onPress={() => go(() => router.push(`/branch/${b.kind}?project=${p.key}`))} />
        ))}
      </View>
    </View>
  );
}

/** …and the board (Mobile2 V5, Mobile8 S7, Mobile3 D1-D4): four columns as four
 *  tabs, one of them open, the cards in it, and the one gesture on this phone
 *  that changes what a computer is doing.
 *
 *  The column is where a person put a card and the mark on the card is what is
 *  actually happening to it — two facts, kept apart, and `src/board.ts` decides
 *  both. A card that failed at four in the morning is therefore still in the
 *  column it was in, with a red mark and how long it has been like that; nothing
 *  on the computer moves a card, and on this screen only a thumb does.
 *
 *  **The tabs are pinned and the cards scroll under them.** That is the frame's
 *  own layout and it is also what makes the gesture possible: they are the drop
 *  targets, and a drop target that can be scrolled off the top of the page is
 *  not one. It is why this face of the project page owns its own scrolling
 *  instead of sitting inside the Dashboard's.
 *
 *  What a drag *decides* is `src/drag.ts` and what it draws is
 *  `components/drag.tsx`; what is left here is the arrangement and the one thing
 *  neither of them can do — ask a computer to move the card, and say what came
 *  back. Two things can come back short, and the screen tells them apart because
 *  they are not the same news: a machine that did not answer moved nothing and
 *  the board is as it was, while a queue that declined leaves the card where the
 *  thumb put it with nothing running on it.
 *
 *  A board with no card anywhere on it is Mobile7 S6's designed state, with the
 *  four tabs still over it at zero — the design's own rule for an empty screen is
 *  that the structure stays legible. */
function Board({ project: p, view, ago, column, onColumn, onOpen }: {
  project: MergedProject; view: DivanView; ago: Ago;
  column: DivanColumn;
  onColumn: (to: DivanColumn) => void;
  onOpen: (card: MergedCard) => void;
}) {
  const T = useT();
  const t = useTokens();
  const router = useRouter();
  const go = useNavGuard();
  const moveCard = useStore((s) => s.moveCard);
  const list = items(view, p, column, ago);
  const said = foot(p, column, view.now);
  const where = spread(p, list.map((i) => i.card));
  const empty = blankBody(p);

  /** The card that has just been put down, for the five seconds it says so.
   *  Held here and nowhere else: it is a fact about this phone rather than
   *  about any board (Mobile3 D4). */
  const [landed, setLanded] = React.useState<Landed | null>(null);
  const settle = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const put = React.useCallback((l: Landed | null) => {
    if (settle.current) clearTimeout(settle.current);
    setLanded(l);
    if (l) settle.current = setTimeout(() => setLanded(null), SETTLE_MS);
  }, []);
  React.useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  /** Ask the computer the card is on to move it, and say what came back.
   *
   *  Every move this screen makes goes through here — the drop, and the Undo that
   *  takes one back — so that there is one place a machine that has stopped
   *  answering can be caught. A rejected move is the whole reason the card in
   *  Mobile3 D4 has four things it can say rather than one, and the Undo used to
   *  have no catch of its own: a board left showing a card in the column somebody
   *  had just said they did not want it in.
   *
   *  `starts` is what the release promised: a worker was asked for. It is only
   *  true of the drop, never of an Undo. */
  const ask = React.useCallback(async (
    to: { carried: Carried; column: DivanColumn; position: number | null; starts: boolean },
  ) => {
    try {
      const { error } = await moveCard({ card: to.carried.card, host: to.carried.host,
                                         column: to.column, position: to.position });
      put({ carried: to.carried, column: to.column,
            moved: true, started: to.starts && !error, error });
    } catch (e: any) {
      // Nothing moved. The board is exactly as it was, and what says so is the
      // line above the cards rather than the card: the list may by now be showing
      // the column the card was aimed at, where that card is not.
      put({ carried: to.carried, column: to.column,
            moved: false, started: false, error: e?.message ?? '' });
    }
  }, [moveCard, put]);

  const drag = useDrag({
    open: column,
    rows: list.map((i) => ({ card: i.card.id, host: i.card.host })),
    onOpen: onColumn,
    onMove: (to) => { put(null); void ask(to); },
  });

  const carried = drag.drag?.carried ?? null;
  // What the line above the cards says. While a card is in the air it is the
  // gesture's (Mobile3 D1-D3); after it lands it is the card's own line, but only
  // where the card is not on screen to carry it — a move that never arrived left
  // the card in a column this list may no longer be showing, and a board that
  // opened the column the card went to may not have re-read it yet. Otherwise it
  // is the column's own tally.
  const air = drag.drag
    ? hint(drag.drag, { others: list.filter((i) => i.card.id !== carried?.card).length,
                        mixed: p.machines.length > 1 })
    : null;
  // Which of the two surfaces carries what just happened to a card, as one
  // answer read twice: the line below, and the card in the loop under it.
  const told = says(landed, list.map((i) => i.card.id));
  const note = landed && told.line ? dropFoot(landed) : null;
  /** Where the card in the air would land, among the cards that are drawn. */
  const slot = drag.target === column ? drag.drag?.slot ?? null : null;

  // The card in the air is out of the list once a place in this column has been
  // picked: the slot the frame draws is the one it is about to fill, and drawing
  // the hole it left as well would be two holes for one card. Before that — the
  // thumb over another column's tab — its own place is the hole (D2).
  const cards = list
    .filter((item) => !(slot != null && item.card.id === carried?.card))
    .map((item) => (
      <View key={item.card.id} onLayout={drag.list.row(item.card.id)}>
        <BoardRow item={item} onOpen={onOpen}
          hold={drag.hold(carry(item.card, item.face, item.who))}
          held={carried?.card === item.card.id}
          flying={drag.flying}
          landed={landed && told.card === item.card.id ? landed : null}
          onUndo={() => { if (landed) { put(null); void ask({ ...back(landed), starts: false }); } }} />
      </View>
    ));
  if (slot != null) cards.splice(slot, 0, <DropSlot key="slot" landing />);

  return (
    // `flex` rather than `flexGrow`: the cards scroll under the tabs, which is
    // the frame's layout and the gesture's requirement both.
    <View ref={drag.frame.ref} onLayout={drag.frame.onLayout}
      style={{ flex: 1 }} {...drag.pan.panHandlers}>
      {/* The tab strip is the width of the page in the frame, rule and all, and
          the page it is on is inset by 16. */}
      <View ref={drag.strip.ref} onLayout={drag.strip.onLayout}>
        <ColumnTabs value={column} onChange={(key) => onColumn(key as DivanColumn)}
          dragging={!!drag.drag} target={drag.target} onMeasure={drag.strip.onMeasure}
          columns={tabs(p, view.now).map((c) => ({ key: c.key, label: T(c.label), count: c.count }))} />
      </View>
      <ScrollView scrollEnabled={!drag.drag}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 6,
                                 paddingBottom: 24, gap: 6 }}>
        {blank(p) ? (
          /* Mobile7 S6's own state, with its own button on it: a board with
             nothing on it is a board asking for the first card. */
          <EmptyState title={T('prNewTitle')} body={T(empty.key, empty.params)} foot={T('prNewFoot')}
            actions={<Button label={T('ntNew')} icon="add" tall
              onPress={() => go(() => router.push(`/new-ticket?project=${p.key}`))} />} />
        ) : (
          <>
            {air ? <DragHint tone={air.tone} text={words(T, air)} />
             : note ? <DragHint tone={note.tone} text={words(T, note)} />
             : <ColumnLine marks={tally(list.map((i) => i.card), view.now, ago)}
                 machines={where.map((m) => `${m.name} ${m.n}`).join(' · ')} />}
            {/* Measured as one block: a card's place in the column is read off its
                own layout inside this view, and this view's place on the glass. */}
            <View ref={drag.list.ref} onLayout={drag.list.onLayout} style={{ gap: 6 }}>{cards}</View>
            {!!said && (
              <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2,
                             paddingHorizontal: 4, paddingTop: 2 }}>
                {T(said.key, said.params)}
              </Text>
            )}
          </>
        )}
      </ScrollView>
      {/* The card under the thumb, over everything and outside the list that is
          no longer holding it (Mobile3 D2). Where it goes is the hook's own
          answer, in this view's coordinates: the thumb arrives in the window's
          and this view starts a long way down it. */}
      {!!drag.drag && drag.flying && !!drag.float && (
        <Float face={drag.drag.carried.face} who={T(drag.drag.carried.who)}
          title={drag.drag.carried.title} style={drag.float} />
      )}
    </View>
  );
}

/** One sentence out of the drag's own words: a column's name and an executor's
 *  name are keys themselves, and are put into the reader's language before they
 *  are put into the sentence — the same two-step every other line on this screen
 *  takes. */
function words(T: ReturnType<typeof useT>,
               say: { said: Said; col?: Key; who?: Key }): string {
  const params = say.who ? { ...say.said.params, who: T(say.who) }
    : say.col ? { ...say.said.params, col: T(say.col) } : say.said.params;
  return T(say.said.key, params);
}

/** One card of the open column, in whichever of its three states it is: lying
 *  there, held (D1), or newly put down (D4). The card it left behind while it is
 *  in the air is an empty slot rather than the card (D2). */
function BoardRow({ item, onOpen, hold, held, flying, landed, onUndo }: {
  item: Item;
  onOpen: (card: MergedCard) => void;
  hold: { holdMs: number; onLongPress: (e: GestureResponderEvent) => void; onPressOut: () => void };
  held?: boolean;
  flying?: boolean;
  landed?: Landed | null;
  onUndo: () => void;
}) {
  const T = useT();
  if (held && flying) return <DropSlot />;
  const say = landed ? dropFoot(landed) : null;
  return (
    <BoardCard face={item.face} who={T(item.who)} mine={item.mine} hold={hold} lifted={held}
      title={item.card.title} line={item.summary}
      machine={item.machine && { name: item.machine.name,
                                 seen: item.machine.seen == null ? null
                                   : T('pfLastSeen', { time: clock(item.machine.seen) }) }}
      mark={item.mark && { text: `${item.mark.mark} ${T(item.mark.key, item.mark.params)}`,
                           tone: item.mark.tone }}
      landed={say && {
        text: words(T, say),
        tone: say.tone,
        action: say.undo ? T('dgUndo') : undefined,
        onAction: say.undo ? onUndo : undefined,
      }}
      onPress={() => onOpen(item.card)} />
  );
}

/** No product on any machine — every paired computer is either silent or
 *  running a daemon older than this screen. Not an apology, and not a spinner:
 *  the structure stays and the middle of the screen says what is missing
 *  (Mobile7 S6). */
function Nothing() {
  const T = useT();
  return <EmptyState title={T('dashEmpty')} body={T('dashEmptyBody')} style={{ paddingTop: 60 }} />;
}
