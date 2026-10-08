import { permissionFor } from '../src/permissions';
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
  blank, blankBody, branchCards, connected, day, meta, nowWords, oldWords, quiet, subtitle, waitingWords,
  type Line,
} from '../src/project';
import {
  COLUMN_LABEL, DONE_SHOWN, OPENS_ON, counts, faces, foot, inProgress, items, line as cardLine, status, tabs,
  type Face, type Item,
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
import { BoardSummary, BranchRow, ProjectHead, QuietNote, StateLines } from '../src/components/project';
import { BoardCard, statusDot } from '../src/components/board';
import { Icon } from '../src/components/icon';
import { DragHint, DropSlot, Float, useDrag } from '../src/components/drag';
import { Text } from '../src/components/text';
import { POLL_MS as INBOX_POLL_MS, unread, useInbox } from '../src/inbox';
import { em, useTokens, type State } from '../src/theme';
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
  const params = useLocalSearchParams<{ project?: string; tab?: string; col?: string; done?: string }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) || null;
  const selected = one(params.project);
  const picked = selected ? projectIn(view, selected) : null;
  const face: Face = one(params.tab) === 'board' ? 'board' : one(params.tab) === 'chats' ? 'chats' : 'overview';
  const col = COLUMNS.find((c) => c === one(params.col)) ?? OPENS_ON;
  const enter = (key: string | null) => router.setParams({ project: key ?? '' });
  const open = (what: { ustabasi_id: number | null; host: string; projectKey: string }) => {
    const where = target(what, host?.id);
    if ('ticket' in where) go(() => router.push(`/ticket/${where.ticket}?from=dashboard`));
    else enter(where.project);
  };
  const ago: Ago = (seconds) => since(seconds, T);
  const old = staleness(view);

  if (picked) {
    const product = (
      <Project project={picked} index={view.projects.findIndex((p) => p.key === picked.key)}
        view={view} now={now} ago={ago} face={face} column={col} allDone={one(params.done) === 'all'}
        onFace={(to) => router.setParams({ tab: to === 'overview' ? '' : to })}
        onAllDone={() => router.setParams({ done: 'all' })}
        onColumn={(to) => router.setParams({ col: to })}
        onOpen={(c) => go(() => router.push(`/card/${c.id}?host=${c.host}&from=${face === 'board' ? 'board' : 'project'}`))} />
    );
    return (
      <Shell place="dashboard" back={{ label: T('tabDashboard'), onPress: () => enter(null) }}>
        {face === 'board' ? product : (
          <ScrollView keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16, paddingBottom: 24, gap: 24 }}>
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
        <InboxRow onOpen={() => go(() => router.push('/inbox'))} />
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
function Waiting({ view, only = null }: {
  view: DivanView;
  /** One product's, on its own page. */
  only?: string | null;
}) {
  const T = useT();
  const t = useTokens();
  const router = useRouter();
  const go = useNavGuard();
  const host = useStore((s) => s.host);
  const answerCard = useStore((s) => s.answerCard);
  const move = useStore((s) => s.moveCard);
  const [busy, setBusy] = React.useState<Record<string, { sending?: boolean; error?: string; sent?: string }>>({});
  const list = waitingItems(view).filter((i) => !only || i.projectKey === only);
  if (!list.length) return null;
  const openCard = (item: WaitItem) => {
    const where = target({ ustabasi_id: item.card.ustabasi_id, host: item.card.host, projectKey: item.projectKey }, host?.id);
    if ('ticket' in where) go(() => router.push(`/ticket/${where.ticket}?from=dashboard`));
    else go(() => router.push(`/card/${item.card.id}?host=${item.card.host}&from=dashboard`));
  };
  const act = async (item: WaitItem, doing: Doing, words: string) => {
    if (doing.do === 'open') { go(() => router.push(`/card/${doing.card}?host=${doing.host}&from=dashboard`)); return; }
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
function DashComposer({ view, lock = null }: {
  view: DivanView;
  /** The product this Composer belongs to (the foot of a project page): every
   *  send carries it, and its chip cannot be taken off. Its draft is its own. */
  lock?: string | null;
}) {
  const T = useT();
  const router = useRouter();
  const go = useNavGuard();
  const host = useStore((s) => s.host);
  const kept = useStore((s) => (lock ? s.drafts?.[lock] : s.compose)) ?? NO_DRAFT;
  const storeCompose = useStore((s) => s.setCompose);
  const storeDraft = useStore((s) => s.setDraft);
  const draft = kept;
  const setCompose = (patch: Partial<typeof NO_DRAFT>) => (lock ? storeDraft(lock, patch) : storeCompose(patch));
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
  const scoped = lock ?? picks.project ?? null;
  const scope = scoped ? view.projects.find((p) => p.key === scoped) ?? null : null;
  const hermes = agents?.find((a) => a.name === 'hermes' || a.id === 'hermes') ?? null;

  React.useEffect(() => { if (!accountsLoaded && conn === 'online') void loadAccounts().catch(() => {}); },
    [accountsLoaded, conn, loadAccounts]);
  React.useEffect(() => {
    if (conn !== 'online') { setAgents(null); return; }
    let alive = true;
    listAgents(account || null, null, provider)
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
    if (lock) { setCompose({ text: value }); if (note?.red) setNote(null); return; }
    const m = mention(view, value);
    setCompose({ text: m.text, ...(m.project ? { picks: { ...picks, project: m.project } } : {}) });
    if (note?.red) setNote(null);
  };

  const submit = async () => {
    const m = lock ? { project: null, text: draft.text } : mention(view, draft.text, true);
    const key = lock ?? m.project ?? picks.project ?? null;
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
          : hermes?.id ?? (await listAgents(account || null, cwd ?? null, mm.provider).catch(() => [] as Agent[]))
              .find((a) => a.installed && (a.name === 'hermes' || a.id === 'hermes'))?.id ?? null;
        const pcm = catalog?.[mm.provider] ?? null;
        const pdm = defaults?.byProvider?.[mm.provider];
        const effort = [pdm?.effort, defaults?.effort].find((e) => e && pcm?.efforts.includes(e)) ?? pcm?.efforts[0] ?? null;
        const perm = permissionFor(mm.provider, pcm, defaults);
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
    ? ((agents && !hermes) ? T('cmNoAgent') : T('cmHermes'))
    : picks.agent === null ? T('cmNoAgent') : (agents?.find((a) => a.id === picks.agent)?.label ?? picks.agent);
  const accountLabel = (v: string) => (v ? signIns.find((a) => a.value === v)?.label ?? v : T('cmOwnAccount'));
  const projectOptions = view.projects.map((p) => ({ value: p.key, label: p.name, checked: picks.project === p.key }));

  return (
    <Composer to={T('cmTo')} locked={!!lock}
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
        ...(lock ? [] : [{ name: T('cmProject'), value: scope ? scope.name : T('cmAuto'), changed: !!scope,
          options: [{ value: '', label: T('cmAuto'), checked: !scope }, ...projectOptions], empty: T('dashEmpty'),
          onPick: (v: string) => (v ? pick({ project: v }) : reset('project')), onReset: () => reset('project'),
          resetLabel: T('cmReset', { name: T('cmProject') }) }]),
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

/** One product (HANDOVER §4.2, ProjectPhone): the head, the Overview / Board /
 *  Chats segment, and whichever of the three is open — each at its own
 *  address, so a redraw and Back land where somebody was.
 *
 *  The board face owns its scrolling: its column tabs are the drop targets of
 *  the drag, and a drop target that can be scrolled off the top of the page is
 *  not one. The other two scroll inside the Dashboard's own. */
function Project({ project: p, index, view, now, ago, face, column, allDone, onFace, onColumn, onAllDone, onOpen }: {
  project: MergedProject; index: number; view: DivanView; now: number; ago: Ago;
  face: Face;
  column: DivanColumn;
  allDone: boolean;
  onFace: (to: Face) => void;
  onColumn: (to: DivanColumn) => void;
  onAllDone: () => void;
  onOpen: (card: MergedCard) => void;
}) {
  const T = useT();
  const t = useTokens();
  const stale = oldWords(p, now, ago);
  const m = meta(p);
  const metaLine = [
    m.stage ? (m.since ? T('pjSince', { stage: m.stage, date: m.since }) : m.stage) : '',
    m.machines.length ? T('pjRunsOn', { machines: m.machines.join(', ') }) : '',
  ].filter(Boolean).join(' · ');
  const segment = (
    <Segments value={face} onChange={(key) => onFace(key as Face)}
      segments={faces(p).map((f) => ({ key: f.key, label: T(f.label) }))} />
  );
  if (face === 'board') {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 12, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '600', letterSpacing: em(17, -0.015) }}>{p.name}</Text>
            <AddTicket project={p.key} />
          </View>
          {segment}
        </View>
        <Board project={p} view={view} ago={ago} column={column} allDone={allDone}
          onColumn={onColumn} onAllDone={onAllDone} onOpen={onOpen} />
      </View>
    );
  }
  return (
    <View style={{ flexGrow: 1, gap: 20 }}>
      <ProjectHead name={p.name} index={index} meta={metaLine} description={subtitle(p) || undefined} />
      {!!stale && (
        <Text style={{ fontSize: 13.5, lineHeight: 13.5 * 1.45, color: t.ink2 }}>{T(stale.key, stale.params)}</Text>
      )}
      {segment}
      {face === 'chats'
        ? <Chats project={p} />
        : <Overview project={p} view={view} now={now} ago={ago} onBoard={() => onFace('board')} onOpen={onOpen} />}
      {/* The Composer at the foot of a product: locked to it. */}
      <DashComposer view={view} lock={p.key} />
    </View>
  );
}

/** The New ticket button in the board's head (BoardPhone): a 44 pt disc with a
 *  plus, which opens the form with this product already chosen. */
function AddTicket({ project }: { project: string }) {
  const T = useT();
  const t = useTokens();
  const router = useRouter();
  const go = useNavGuard();
  return (
    <Tap onPress={() => go(() => router.push(`/new-ticket?project=${project}`))}
      style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ink }}>
      <View accessibilityLabel={T('ntNew')}><Icon name="add" size={20} color={t.onInk} /></View>
    </Tap>
  );
}

/** The Overview face (ProjectPhone): what in this product needs you, the board
 *  in four numbers with In progress now under it, and the branches as rows. A
 *  product nothing has touched in weeks says so first; one whose board is
 *  empty says that instead of the numbers. */
function Overview({ project: p, view, now, ago, onBoard, onOpen }: {
  project: MergedProject; view: DivanView; now: number; ago: Ago;
  onBoard: () => void; onOpen: (card: MergedCard) => void;
}) {
  const T = useT();
  const t = useTokens();
  const router = useRouter();
  const go = useNavGuard();
  const asleep = quiet(p, now, ago);
  const body = blankBody(p);
  const rows = inProgress(p, now);
  const branches = branchCards(p, now);
  const happening = nowWords(view, p);
  const pending = waitingWords(view, p);
  /** One of the two sentences said where nothing is in progress: every clause
   *  of it, worst first, with the executor it names in the reader's language. */
  const said = (x: Line) => x.clauses
    .map((c) => T(c.said.key, c.who ? { ...c.said.params, who: T(c.who) } : c.said.params))
    .join(' ');
  return (
    <View style={{ gap: 24 }}>
      {!!asleep && (
        <QuietNote title={T(asleep.title.key, asleep.title.params)} body={T(asleep.body.key, asleep.body.params)} />
      )}
      <Waiting view={view} only={p.key} />
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SectionHeader title={T('bdBoard')} style={{ flex: 1 }} />
          <Tap onPress={onBoard} style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 12 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '500', color: t.ink2 }}>{T('pjOpen')}</Text>
          </Tap>
        </View>
        <BoardSummary label={T('bdBoard')} onPress={onBoard}
          counts={counts(p, now).map((c) => ({ key: c.key, label: T(c.label), count: c.count }))} />
        {blank(p) ? (
          <EmptyState title={T('prNewTitle')} body={T(body.key, body.params)} foot={T('prNewFoot')} />
        ) : !rows.length ? (
          // Nothing in progress is a sentence, and so is what it is waiting on —
          // a stopped quota or a quiet machine is said here with its clock.
          asleep ? null : <StateLines rows={[
            { label: T('prNow'), text: said(happening), tone: happening.tone },
            { label: T('prWaiting'), text: said(pending), tone: pending.tone, quiet: true },
          ]} />
        ) : (
          <Rows>
            {rows.map((c, i) => {
              const st = status(c)!;
              const d = statusDot(t, st.kind);
              return (
                <LiveRow key={`${c.host}:${c.id}`} first={i === 0} state={d.colour} hollow={d.hollow}
                  title={c.title} meta={T(st.word)} metaTone={st.kind === 'ask' ? 'amber' : undefined}
                  onPress={() => onOpen(c)} />
              );
            })}
          </Rows>
        )}
      </View>
      {!!branches.length && (
        <View style={{ gap: 12 }}>
          <SectionHeader title={T('branches')} count={branches.length} />
          <Rows>
            {branches.map((b, i) => {
              const fed = connected(p, p.branches.find((x) => x.kind === b.kind)!);
              return (
                <BranchRow key={b.key} first={i === 0} name={b.name}
                  note={fed ? null : T('pjNotConnected')}
                  figures={fed ? b.figures.map((f) => ({ value: f.value, label: T(f.label) })) : []}
                  onPress={() => go(() => router.push(`/branch/${b.kind}?project=${p.key}`))} />
              );
            })}
          </Rows>
        </View>
      )}
    </View>
  );
}

/** The Chats face: the chats on this computer filed under the product, newest
 *  first, each opening the chat. */
function Chats({ project: p }: { project: MergedProject }) {
  const T = useT();
  const router = useRouter();
  const go = useNavGuard();
  const host = useStore((s) => s.host);
  const all = useStore((s) => s.chats) ?? {};
  const mine = host ? p.ids[host.id] : undefined;
  const list = Object.values(all)
    .filter((c) => !c.archived && ((!!mine && c.project_id === mine)
      || p.repos.some((r) => c.cwd === r || (c.cwd || '').startsWith(`${r}/`))))
    .sort((a, b) => b.updated_at - a.updated_at);
  if (!list.length) return <EmptyState title={T('pjNoChats')} />;
  return (
    <Rows>
      {list.map((c, i) => (
        <LiveRow key={c.id} first={i === 0} state={c.status === 'running' ? 'running' : 'quiet'}
          title={c.title || T('emptyChat')} meta={c.status === 'running' ? T('stRunning') : short(Math.max(0, Date.now() / 1000 - c.updated_at))}
          onPress={() => go(() => router.push(`/chat/${c.id}`))} />
      ))}
    </Rows>
  );
}

/** …and the board (BoardPhone, Mobile3 D1-D4): the four columns as four tabs
 *  with their counts, the open column's cards under them, and the one gesture
 *  on this phone that changes what a computer is doing — hold a card and drop
 *  it on a tab to move it; In Progress starts it, asking nothing.
 *
 *  What a drag decides is `src/drag.ts` and what it draws is
 *  `components/drag.tsx`; what is left here is asking a computer to move the
 *  card, and saying what came back. */
function Board({ project: p, view, ago, column, allDone, onColumn, onAllDone, onOpen }: {
  project: MergedProject; view: DivanView; ago: Ago;
  column: DivanColumn;
  allDone: boolean;
  onColumn: (to: DivanColumn) => void;
  onAllDone: () => void;
  onOpen: (card: MergedCard) => void;
}) {
  const T = useT();
  const t = useTokens();
  const router = useRouter();
  const go = useNavGuard();
  const moveCard = useStore((s) => s.moveCard);
  const every = items(view, p, column, ago);
  const list = column === 'done' && !allDone ? every.slice(0, DONE_SHOWN) : every;
  const rest = every.length - list.length;
  const said = foot(p, column, view.now);
  const empty = blankBody(p);

  /** The card that has just been put down, for the five seconds it says so. */
  const [landed, setLanded] = React.useState<Landed | null>(null);
  const settle = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const put = React.useCallback((l: Landed | null) => {
    if (settle.current) clearTimeout(settle.current);
    setLanded(l);
    if (l) settle.current = setTimeout(() => setLanded(null), SETTLE_MS);
  }, []);
  React.useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  /** Ask the computer the card is on to move it, and say what came back. Every
   *  move goes through here — the drop, and the Undo that takes one back. */
  const ask = React.useCallback(async (
    to: { carried: Carried; column: DivanColumn; position: number | null; starts: boolean },
  ) => {
    try {
      const { error } = await moveCard({ card: to.carried.card, host: to.carried.host,
                                         column: to.column, position: to.position });
      put({ carried: to.carried, column: to.column, moved: true, started: to.starts && !error, error });
    } catch (e: any) {
      put({ carried: to.carried, column: to.column, moved: false, started: false, error: e?.message ?? '' });
    }
  }, [moveCard, put]);

  const drag = useDrag({
    open: column,
    rows: list.map((i) => ({ card: i.card.id, host: i.card.host })),
    onOpen: onColumn,
    onMove: (to) => { put(null); void ask(to); },
  });

  const carried = drag.drag?.carried ?? null;
  const air = drag.drag
    ? hint(drag.drag, { others: list.filter((i) => i.card.id !== carried?.card).length,
                        mixed: p.machines.length > 1 })
    : null;
  const told = says(landed, list.map((i) => i.card.id));
  const note = landed && told.line ? dropFoot(landed) : null;
  const slot = drag.target === column ? drag.drag?.slot ?? null : null;

  const cards = list
    .filter((item) => !(slot != null && item.card.id === carried?.card))
    .map((item) => (
      <View key={item.card.id} onLayout={drag.list.row(item.card.id)}>
        <BoardRow item={item} now={view.now} onOpen={onOpen}
          hold={drag.hold(carry(item.card, item.face, item.who))}
          held={carried?.card === item.card.id}
          flying={drag.flying}
          landed={landed && told.card === item.card.id ? landed : null}
          onUndo={() => { if (landed) { put(null); void ask({ ...back(landed), starts: false }); } }} />
      </View>
    ));
  if (slot != null) cards.splice(slot, 0, <DropSlot key="slot" landing />);

  return (
    <View ref={drag.frame.ref} onLayout={drag.frame.onLayout}
      style={{ flex: 1 }} {...drag.pan.panHandlers}>
      <View ref={drag.strip.ref} onLayout={drag.strip.onLayout}>
        <ColumnTabs value={column} onChange={(key) => onColumn(key as DivanColumn)}
          dragging={!!drag.drag} target={drag.target} onMeasure={drag.strip.onMeasure}
          columns={tabs(p, view.now).map((c) => ({ key: c.key, label: T(c.label), count: c.count }))} />
      </View>
      <ScrollView scrollEnabled={!drag.drag}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 10 }}>
        {blank(p) ? (
          <EmptyState title={T('prNewTitle')} body={T(empty.key, empty.params)} foot={T('prNewFoot')}
            actions={<Button label={T('ntNew')} icon="add" tall
              onPress={() => go(() => router.push(`/new-ticket?project=${p.key}`))} />} />
        ) : (
          <>
            {air ? <DragHint tone={air.tone} text={words(T, air)} />
             : note ? <DragHint tone={note.tone} text={words(T, note)} />
             : <Text mono style={{ fontSize: 11.5, lineHeight: 16, color: t.ink3, paddingHorizontal: 4 }}>{T('bdHint')}</Text>}
            <View ref={drag.list.ref} onLayout={drag.list.onLayout} style={{ gap: 10 }}>{cards}</View>
            {rest > 0 && (
              <Tap onPress={onAllDone} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: t.ink2 }}>{T('bdShowMore', { n: rest })}</Text>
              </Tap>
            )}
            {!!said && (
              <Text style={{ fontSize: 13, lineHeight: 13 * 1.45, color: t.ink2, paddingHorizontal: 4, paddingTop: 2 }}>
                {T(said.key, said.params)}
              </Text>
            )}
          </>
        )}
      </ScrollView>
      {!!drag.drag && drag.flying && !!drag.float && (
        <Float face={drag.drag.carried.face} who={T(drag.drag.carried.who)}
          title={drag.drag.carried.title} style={drag.float} />
      )}
    </View>
  );
}

/** One sentence out of the drag's own words, with a column's or an executor's
 *  name put into the reader's language first. */
function words(T: ReturnType<typeof useT>,
               say: { said: Said; col?: Key; who?: Key }): string {
  const params = say.who ? { ...say.said.params, who: T(say.who) }
    : say.col ? { ...say.said.params, col: T(say.col) } : say.said.params;
  return T(say.said.key, params);
}

/** One card of the open column: lying there, held (D1), or just put down (D4).
 *  The place it left while it is in the air is an empty slot (D2). */
function BoardRow({ item, now, onOpen, hold, held, flying, landed, onUndo }: {
  item: Item;
  now: number;
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
  const c = item.card;
  const st = status(c);
  const col = c.column as string;
  const stamp = c.agent_status_at ?? c.moved_at ?? null;
  const meta = col === 'done' ? (c.moved_at || c.updated_at ? day(c.moved_at || c.updated_at) : '')
    : col === 'ice_box' ? (c.created_at ? short(Math.max(0, now - c.created_at)) : '')
      : col === 'queued' ? T(item.who)
        : [item.machine ? (item.machine.seen == null ? item.machine.name
          : `${item.machine.name} · ${T('pfLastSeen', { time: clock(item.machine.seen) })}`) : c.machine,
        stamp != null ? short(Math.max(0, now - stamp)) : ''].filter(Boolean).join(' · ');
  return (
    <BoardCard mine={item.mine} hold={hold} lifted={held}
      title={c.title} line={cardLine(c)} meta={meta}
      status={st && { kind: st.kind, word: T(st.word) }}
      landed={say && {
        text: words(T, say),
        tone: say.tone,
        action: say.undo ? T('dgUndo') : undefined,
        onAction: say.undo ? onUndo : undefined,
      }}
      onPress={() => onOpen(c)} />
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

/** The way in to what the queue sent: one row with the count of what came in
 *  since the list was last opened. The dashboard polls for it while it is on
 *  screen; the push is still how a result arrives, this is where it stays. */
function InboxRow({ onOpen }: { onOpen: () => void }) {
  const T = useT();
  const items = useInbox((s) => s.items);
  const seen = useInbox((s) => s.seen);
  const poll = useInbox((s) => s.poll);
  React.useEffect(() => {
    void poll();
    const t = setInterval(() => { void poll(); }, INBOX_POLL_MS);
    return () => clearInterval(t);
  }, [poll]);
  const n = unread(items, seen);
  return (
    <ListRow boxed first icon="view_agenda" title={T('inboxTitle')}
      note={items[0] ? (items[0].title || items[0].headline) : T('inboxNote')} noteLines={1}
      meta={n ? T('inboxNew', { n }) : T('inboxAllRead')} tone={n ? 'amber' : undefined}
      onPress={onOpen} />
  );
}
