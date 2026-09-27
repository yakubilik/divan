import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useStore, useT } from '../src/store';
import { useColors } from '../src/theme';
import { Card, Icon, IconLine, Label, ProviderBadge, Skeleton, SmallButton, Spinner, Text } from '../src/components/ui';
import { afterOverlays, alert, measure, openMenu, prompt, type MenuItem } from '../src/components/overlay';
import { LargeTitlePage } from '../src/components/page';
import type { CliAccount, Provider } from '../src/protocol';

const PROVIDERS: Provider[] = ['claude', 'codex'];
const NAMES: Record<Provider, string> = { claude: 'Claude', codex: 'Codex' };

export default function Accounts() {
  const router = useRouter();
  const T = useT();
  const c = useColors();
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

  return (
    <LargeTitlePage title={T('accounts')} titleStyle={{ paddingBottom: 14 }}>
      <View style={{ paddingHorizontal: 16, gap: 6, opacity: menuFor ? 0.4 : 1 }}>
        {PROVIDERS.map((p, pi) => {
          const tool = tools.find((t) => t.provider === p);
          const missing = tool ? !tool.version : false;
          const list = accounts.filter((a) => a.provider === p);
          const chosen = defaults.byProvider?.[p]?.account_id ?? null;
          return (
            <View key={p} style={{ gap: 6 }}>
              <Label style={pi > 0 ? { paddingTop: 10 } : undefined}>{NAMES[p]}</Label>
              {missing ? (
                <View style={{ backgroundColor: c.warnBg, borderRadius: 14, padding: 14, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Icon name="warning" size={18} weight={400} color={c.warn} />
                    <Text style={{ fontSize: 15, fontWeight: '600' }}>{T('cliMissing', { p: NAMES[p] })}</Text>
                  </View>
                  <Text style={{ fontSize: 13, color: c.text2, lineHeight: 13 * 1.45 }}>
                    {npmAvailable ? T('cliInstallHint', { host: hostName, p: NAMES[p] }) : T('needNode')}
                  </Text>
                  {npmAvailable && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <SmallButton title={installing === p ? T('installing') : T('install')} onPress={() => void install(p)} disabled={!!installing} padH={16} padV={8} />
                      {installing === p && <Spinner />}
                    </View>
                  )}
                </View>
              ) : (
                <>
                  <Card>
                    {loading ? (
                      [0, 1].map((i) => (
                        <View key={i} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 }, i === 0 && { borderBottomWidth: 1, borderBottomColor: c.line }]}>
                          <Skeleton width={30} height={30} radius={8} />
                          <View style={{ flex: 1, gap: 7 }}><Skeleton width="55%" height={11} /><Skeleton width="40%" height={10} color={c.fill} /></View>
                        </View>
                      ))
                    ) : list.map((a, i) => (
                      <AccountRow key={a.id} a={a} last={i === list.length - 1}
                        isDefault={chosen === a.id || (!chosen && a.is_default)}
                        onPress={() => void setDefaults({ byProvider: { ...(defaults.byProvider ?? {}),
                          [p]: { ...(defaults.byProvider?.[p] ?? { model: '', effort: null, perm_mode: '' }), account_id: a.is_default ? null : a.id } } })}
                        onSignIn={() => signIn(a, p)}
                        onMenu={(anchor) => { setMenuFor(a.id); openMenu({ anchor, align: 'right', width: 220, items: items(a), onClose: () => setMenuFor(null) }); }} />
                    ))}
                  </Card>
                  <Pressable onPress={() => add(p)} disabled={!!creating}
                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4 }, pressed && { opacity: 0.6 }]}>
                    {creating === p ? <Spinner /> : <IconLine name="add" size={18} />}
                    <Text style={{ fontSize: 15, fontWeight: '500' }}>{creating === p ? T('creatingAccount') : T('addAccount', { p: NAMES[p] })}</Text>
                  </Pressable>
                </>
              )}
            </View>
          );
        })}
        <Pressable onPress={() => router.push('/move-signin')}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 18, paddingHorizontal: 4 }, pressed && { opacity: 0.6 }]}>
          <IconLine name="move_down" size={18} weight={400} color={c.text2} />
          <Text style={{ fontSize: 14, color: c.text2 }}>{T('moveFromAnother')}</Text>
        </Pressable>
      </View>
    </LargeTitlePage>
  );
}

function AccountRow({ a, last, isDefault, onPress, onSignIn, onMenu }: {
  a: CliAccount; last: boolean; isDefault: boolean; onPress: () => void; onSignIn: () => void; onMenu: (anchor: any) => void;
}) {
  const T = useT();
  const c = useColors();
  const more = useRef<View>(null);
  return (
    <Pressable onPress={onPress} onLongPress={() => void measure(more).then(onMenu)}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 8 },
        !last && { borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { backgroundColor: c.fill }]}>
      <ProviderBadge provider={a.provider} size={30} variant={a.logged_in ? 'filled' : 'dashed'} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '500' }}>{a.is_default ? T('useDefaultAccount') : a.label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: a.logged_in ? c.muted : c.faint }}>{a.logged_in ? a.detail : T('notSignedIn')}</Text>
      </View>
      {a.logged_in
        ? (isDefault ? <Icon name="check" size={20} /> : null)
        : <SmallButton title={T('signIn')} onPress={onSignIn} tone="accent" padH={12} padV={6} />}
      <Pressable ref={more} accessibilityLabel={T('accountOptions')} onPress={() => void measure(more).then(onMenu)} hitSlop={6}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="more_vert" size={20} color={c.faint} />
      </Pressable>
    </Pressable>
  );
}
