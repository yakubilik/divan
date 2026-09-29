import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useTokens } from '../src/theme';
import { Group, ListRow, RowButton } from '../src/components/divan';
import { PageHead } from '../src/components/machine';
import { BackRow } from '../src/components/waiting';
import { ProviderBadge } from '../src/components/ui';
import { Icon } from '../src/components/icon';
import { Text } from '../src/components/text';
import { afterOverlays, alert, measure, openMenu, prompt, type MenuItem } from '../src/components/overlay';
import type { CliAccount, Provider } from '../src/protocol';

const PROVIDERS: Provider[] = ['claude', 'codex'];
const NAMES: Record<Provider, string> = { claude: 'Claude', codex: 'Codex' };

/** Every sign-in this computer has, and what can be done to each of them.
 *
 *  Web15 W16 is the desktop's own version of this page and is what it is drawn
 *  from: one card per tool with its name in mono over it, a row per sign-in
 *  whose leading mark is the tool's badge, the state in a word at the end of the
 *  row, and the one thing that row needs — `Sign in` — as the small button W16
 *  puts there. A tool the computer has not got is the one row that is washed,
 *  the way W16 washes the key that is about to expire: it is the row asking for
 *  something, not the page. */
export default function Accounts() {
  const router = useRouter();
  const T = useT();
  const t = useTokens();
  const { accounts, tools, npmAvailable, defaults, conn, hostInfo, host, loadAccounts, loadTools,
          createAccount, deleteAccount, logoutAccount, renameAccount, installTool, setDefaults } = useStore();
  const [installing, setInstalling] = useState<Provider | null>(null);
  const [creating, setCreating] = useState<Provider | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const accountsLoaded = useStore((s) => s.accountsLoaded);
  const loginPrompt = useStore((s) => s.loginPrompt);
  const busyLogin = useStore((s) => s.loginBusy);
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  const reload = useCallback(() => {
    if (conn !== 'online') return;
    void loadAccounts().catch(() => {});
    void loadTools().catch(() => {});
  }, [conn, loadAccounts, loadTools]);
  useFocusEffect(reload);
  useEffect(reload, [reload]);

  /** Two sign-ins at once produce two browser sessions racing for one pty, and
   *  the second one's code lands in the wrong place. */
  function signIn(a: CliAccount, provider: Provider) {
    if (loginPrompt || busyLogin) { alert(T('accountOptions'), T('loginBusy')); return; }
    router.push({ pathname: '/login-method', params: { id: a.id, provider } });
  }

  /** The name is the only thing anybody types here, so a name already taken
   *  asks again with it still in the box rather than dropping it behind an
   *  alert. Once the account exists the sign-in starts on its own: adding an
   *  account is only ever the first half of signing one in, and the method
   *  list was a tap that landed on its own first entry nearly every time.
   *  It stays one tap away on the next screen. */
  function add(provider: Provider) {
    if (loginPrompt || busyLogin) { alert(T('accountOptions'), T('loginBusy')); return; }
    prompt({
      title: T('addAccount', { p: NAMES[provider] }), message: T('accountNameHint'), placeholder: T('accountName'),
      confirm: T('add'), cancel: T('cancel'),
      submit: async (name) => {
        const label = name.trim();
        setCreating(provider);
        let a: CliAccount;
        try { a = await createAccount(provider, label); }
        catch (e: any) {
          if (e?.code === 'duplicate_label') return T('nameTakenOn', { name: label, host: hostName });
          if (e?.code === 'empty_label') return T('errEmptyLabel');
          throw e;
        } finally { setCreating(null); }
        const method = tools.find((t) => t.provider === provider)?.login_methods?.[0]?.id;
        // The dialog closes when this returns; the next screen comes up after it.
        afterOverlays(() => router.push(method
          ? { pathname: '/account-login', params: { id: a.id, provider, method } }
          : { pathname: '/login-method', params: { id: a.id, provider } }));
      },
    });
  }

  const err = (e: any) => alert(T('error'), e?.message ?? '');

  /** Everything you can do to one account. The computer's own account is not
   *  ours to rename or delete — it is the login the machine already had. */
  function items(a: CliAccount): MenuItem[] {
    const acts: MenuItem[] = [
      { label: T('makeDefault'), icon: 'radio_button_checked', onPress: () => void setDefaults({ byProvider: { ...(defaults.byProvider ?? {}), [a.provider]: { ...(defaults.byProvider?.[a.provider] ?? { model: '', effort: null, perm_mode: '' }), account_id: a.is_default ? null : a.id } } } as any).catch(err) },
    ];
    if (!a.is_default) acts.push({ label: T('renameAccount'), icon: 'edit', onPress: () => rename(a) });
    if (a.logged_in) acts.push({ label: T('signOut'), icon: 'logout', onPress: () => confirmSignOut(a) });
    if (!a.is_default) acts.push({ kind: 'divider' }, { label: T('deleteAccount'), icon: 'delete', danger: true, onPress: () => confirmDelete(a) });
    return acts;
  }

  function rename(a: CliAccount) {
    prompt({
      title: T('renameAccountTitle'), value: a.label, confirm: T('save'), cancel: T('cancel'),
      submit: async (name) => {
        const v = name.trim();
        if (!v || v === a.label) return;
        try { await renameAccount(a.id, v); }
        catch (e: any) { if (e?.code === 'duplicate_label') return T('nameTakenOn', { name: v, host: hostName }); throw e; }
      },
    });
  }

  function confirmSignOut(a: CliAccount) {
    alert(T('signOutAccount'), T('signOutBody'), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('signOut'), style: 'destructive', onPress: () => void logoutAccount(a.id).catch(err) },
    ]);
  }

  function confirmDelete(a: CliAccount) {
    if (a.is_default) return;
    alert(T('removeAccount'), T('removeAccountBody'), [
      { text: T('cancel'), style: 'cancel' },
      { text: T('remove'), style: 'destructive', onPress: () => void deleteAccount(a.id).catch(err) },
    ]);
  }

  async function install(provider: Provider) {
    setInstalling(provider);
    try { await installTool(provider); }
    catch (e: any) { alert(T('error'), e.message); }
    finally { setInstalling(null); }
  }

  const loading = !accountsLoaded && (conn === 'online' || conn === 'connecting');
  const signedIn = accounts.filter((a) => a.logged_in).length;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingHorizontal: 16,
                                           paddingBottom: 32, gap: 10 }}
        style={{ opacity: menuFor ? 0.4 : 1 }}>
        <BackRow label={T('mTitle')} onPress={() => router.back()} style={{ paddingHorizontal: 4 }} />
        <PageHead title={T('accounts')}
          right={accounts.length ? <Text mono style={{ fontSize: 12, color: t.ink3 }}>
            {T('acSignedIn', { n: signedIn, of: accounts.length })}</Text> : undefined}
          style={{ marginBottom: 2 }} />
        {PROVIDERS.map((p) => {
          const tool = tools.find((x) => x.provider === p);
          const missing = tool ? !tool.version : false;
          const list = accounts.filter((a) => a.provider === p);
          const chosen = defaults.byProvider?.[p]?.account_id ?? null;
          return (
            <Group key={p} label={NAMES[p]}>
              {missing ? (
                // The tool itself is not on the computer. One washed row, and the
                // one thing that helps on it — or, with no npm, the sentence
                // saying why nothing here can help.
                <ListRow first boxed chevron={false} wash="amber" icon="warning"
                  title={T('cliMissing', { p: NAMES[p] })}
                  note={npmAvailable ? T('cliInstallHint', { host: hostName, p: NAMES[p] }) : T('needNode')}
                  noteLines={3}
                  right={npmAvailable
                    ? <RowButton label={installing === p ? T('installing') : T('install')} face="ink"
                        busy={!!installing} onPress={() => void install(p)} />
                    : undefined} />
              ) : loading ? (
                <ListRow first boxed chevron={false} title={T('acLoading')} />
              ) : (
                <>
                  {list.map((a, i) => (
                    <AccountRow key={a.id} a={a} first={i === 0}
                      isDefault={chosen === a.id || (!chosen && a.is_default)}
                      onPress={() => void setDefaults({ byProvider: { ...(defaults.byProvider ?? {}),
                        [p]: { ...(defaults.byProvider?.[p] ?? { model: '', effort: null, perm_mode: '' }), account_id: a.is_default ? null : a.id } } })}
                      onSignIn={() => signIn(a, p)}
                      onMenu={(anchor) => { setMenuFor(a.id); openMenu({ anchor, align: 'right', width: 220, items: items(a), onClose: () => setMenuFor(null) }); }} />
                  ))}
                  <ListRow first={list.length === 0} boxed chevron={false} icon="add"
                    title={creating === p ? T('creatingAccount') : T('addAccount', { p: NAMES[p] })}
                    onPress={creating ? undefined : () => add(p)} />
                </>
              )}
            </Group>
          );
        })}
        <ListRow first icon="move_down" title={T('moveFromAnother')} onPress={() => router.push('/move-signin')}
          style={{ marginTop: 4 }} />
      </ScrollView>
    </View>
  );
}

/** One sign-in, as W16 draws a connected service: the tool's badge, the name,
 *  what the sign-in is, whether it is live, and what can be done about it. */
function AccountRow({ a, first, isDefault, onPress, onSignIn, onMenu }: {
  a: CliAccount; first: boolean; isDefault: boolean; onPress: () => void; onSignIn: () => void;
  onMenu: (anchor: any) => void;
}) {
  const T = useT();
  const t = useTokens();
  const more = useRef<View>(null);
  return (
    <ListRow first={first} boxed chevron={false} onPress={onPress}
      onLongPress={() => void measure(more).then(onMenu)}
      lead={<ProviderBadge provider={a.provider} size={34} variant={a.logged_in ? 'filled' : 'dashed'} />}
      title={a.is_default ? T('useDefaultAccount') : a.label}
      note={a.logged_in ? a.detail : null}
      meta={a.logged_in ? T('acSignedInOne') : T('notSignedIn')} tone={a.logged_in ? 'run' : 'ink3'}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {a.logged_in
            ? (isDefault ? <Icon name="check" size={18} color={t.ink} /> : null)
            : <RowButton label={T('signIn')} face="ink" onPress={onSignIn} />}
          <Pressable ref={more} accessibilityLabel={T('accountOptions')}
            onPress={() => void measure(more).then(onMenu)} hitSlop={6}
            style={{ width: 28, height: 32, alignItems: 'flex-end', justifyContent: 'center' }}>
            <Icon name="more_vert" size={18} color={t.ink3} />
          </Pressable>
        </View>
      } />
  );
}
