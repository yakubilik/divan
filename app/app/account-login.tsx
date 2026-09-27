import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { errText } from '../src/i18n';
import { useStore, useT } from '../src/store';
import { em, useColors } from '../src/theme';
import { BackBar, Button, Eyebrow, Icon, Label, LinkText, Note, Text, TextInput, WaitBars } from '../src/components/ui';
import { alert } from '../src/components/overlay';
import type { Provider } from '../src/protocol';

const NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

export default function AccountLogin() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { id, provider, method } = useLocalSearchParams<{ id: string; provider: Provider; method?: string }>();
  const { loginPrompt, loginDone, startLogin, submitLoginCode, cancelLogin } = useStore();
  const submitting = useStore((st) => st.loginSubmitting);
  const account = useStore((st) => st.accounts.find((a) => a.id === id));
  const hostInfo = useStore((st) => st.hostInfo);
  const host = useStore((st) => st.host);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  // What this method needs from the phone before it can start: an address to
  // pre-fill, a key to send, or nothing at all.
  const tools = useStore((st) => st.tools);
  const spec = tools.find((t) => t.provider === (provider ?? 'claude'))
    ?.login_methods?.find((m) => m.id === (method || ''));
  const needsKey = !!spec?.needs_key;
  const needsEmail = !needsKey && (spec ? !!spec.wants_email : (provider ?? 'claude') === 'claude');
  const hostName = hostInfo?.name?.replace('.local', '') || host?.name || T('computer');

  // The computer runs the sign-in; the phone only supplies the address and
  // hands back the code. Each run produces a fresh link, so a link that has
  // gone stale is fixed by starting again rather than by reloading the page.
  async function begin() {
    setFailed(null); setCode(''); setStarted(true);
    try { await startLogin(id!, { email: email.trim() || undefined, method, api_key: apiKey.trim() || undefined }); }
    catch (e: any) { setFailed(e.message); setStarted(false); }
  }
  // Only the account may re-run this. Adding any changing value to the list
  // makes React run the previous cleanup, and that cleanup cancels the sign-in
  // that has just started.
  useEffect(() => {
    if (!needsEmail && !needsKey) void begin();
    return () => { void cancelLogin(id!); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loginDone && !loginDone.ok) setFailed(errText(loginDone.error_code, loginDone.error));
  }, [loginDone, T]);
  // A success needs a beat to be read, then gets out of the way on its own.
  useEffect(() => {
    if (loginDone?.account_id !== id || !loginDone?.ok) return;
    const t = setTimeout(() => router.back(), 1400);
    return () => clearTimeout(t);
  }, [loginDone?.account_id, loginDone?.ok, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const prompt = loginPrompt?.account_id === id ? loginPrompt : null;
  // The sign-in page opens inside the app: the service sends the authorization
  // code back to a callback URL, so the app can read it off the address bar and
  // the code never has to be carried by hand. Codex has no such page — it shows
  // a device code instead — so it is left alone.
  const opened = useRef<string | null>(null);
  const openPage = useCallback(() => {
    if (!prompt?.url) return;
    router.push({ pathname: '/login-web',
                  params: { id: id!, url: prompt.url,
                            ...(prompt.code ? { code: prompt.code } : {}),
                            // which account to pick, for a page that no longer
                            // knows: the sign-in opens with an empty cookie jar
                            ...(email.trim() ? { email: email.trim() } : {}) } });
  }, [prompt?.url, prompt?.code, id, email]); // eslint-disable-line react-hooks/exhaustive-deps
  // Codex needs its one-time code on screen before the page is any use, so it
  // waits for the code; Claude has nothing to wait for.
  useEffect(() => {
    if (!prompt?.url || opened.current === prompt.url) return;
    if (!prompt.needs_code && !prompt.code) return;
    opened.current = prompt.url;
    if (!prompt.code) openPage();
  }, [prompt?.url, prompt?.needs_code, prompt?.code, openPage]);
  const done = loginDone?.account_id === id ? loginDone : null;
  /** A long press on the page link hands the address over, for a browser
   *  somewhere else. Each run makes a fresh link; "New link" is how to get one. */
  const copyLink = () => { if (prompt?.url) void Clipboard.setStringAsync(prompt.url); };

  /** The e-mailed code is short and usually digits; the authorization code the
   *  page hands back is long. Catch the mix-up before it burns the session. */
  function looksLikeEmailCode(v: string): boolean {
    const t = v.trim();
    return t.length > 0 && (t.length < 20 || /^[0-9\s-]+$/.test(t));
  }

  async function submit() {
    setBusy(true);
    try { await submitLoginCode(id!, code.trim()); }
    catch (e: any) { alert(T('error'), e.message); }
    finally { setBusy(false); }
  }

  /** Adding an account now lands straight on its default sign-in, so the list
   *  of methods has to stay reachable from here — console keys and SSO are the
   *  whole reason it exists. */
  const otherWay = () => router.replace({ pathname: '/login-method', params: { id: id!, provider: provider ?? 'claude' } });

  const who = account ? (account.is_default ? T('ownShort') : account.label) : '';
  const eyebrow = [NAMES[provider ?? 'claude'], who].filter(Boolean).join(' · ');
  // Plain functions, not components: a component made in render is a new
  // type every render, and React would rebuild the buttons under a finger.
  const title = (children: string) => (
    <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 8 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Text style={{ fontSize: 28, fontWeight: '600', letterSpacing: em(28, -0.02) }}>{children}</Text>
    </View>
  );
  const foot = ({ primary, onPrimary, disabled, other = true }: { primary?: string; onPrimary?: () => void; disabled?: boolean; other?: boolean }) => (
    <View style={{ marginTop: 'auto', paddingTop: 24, paddingHorizontal: 16, paddingBottom: insets.bottom + 10, alignItems: 'center', gap: 14 }}>
      {!!primary && <Button title={primary} onPress={onPrimary!} disabled={disabled} />}
      {other && <LinkText title={T('otherWay')} onPress={otherWay} />}
    </View>
  );

  let body: React.ReactNode;
  if (done?.ok) {
    body = (
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 80 }}>
        <View style={{ backgroundColor: c.okBg, borderRadius: 18, paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 10 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.ok, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={30} weight={400} color="#FFFFFF" />
          </View>
          <Text style={{ fontSize: 20, fontWeight: '600' }}>{T('loginOk')}</Text>
          <Text style={{ fontSize: 14, color: c.text2, textAlign: 'center' }}>{[who, done.detail].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text style={{ textAlign: 'center', fontSize: 13, color: c.faint, paddingTop: 14 }}>{T('returning')}</Text>
      </View>
    );
  } else if (failed) {
    body = (
      <>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 40 }}>
          <View style={{ backgroundColor: c.dangerBg, borderRadius: 18, paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 10 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={30} weight={400} color="#FFFFFF" />
            </View>
            <Text style={{ fontSize: 20, fontWeight: '600' }}>{T('loginFailed')}</Text>
            <Text mono style={{ fontSize: 12, color: c.text2, textAlign: 'center' }}>{failed}</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 10, alignItems: 'center', gap: 14 }}>
          <Button title={T('tryAgain')} onPress={() => {
            setFailed(null);
            // Tools that sign in by address ask for it again; the others just go.
            if (needsEmail || needsKey) setStarted(false); else void begin();
          }} />
          <LinkText title={T('otherWay')} onPress={otherWay} />
        </View>
      </>
    );
  } else if (needsKey && !started) {
    body = (
      <>
        {title(T('keyTitle'))}
        <View style={{ marginTop: 18, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card,
                       borderWidth: 1.5, borderColor: c.ink, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 }}>
          <TextInput value={apiKey} onChangeText={setApiKey} placeholder={T('keyPlaceholder')} mono autoCapitalize="none" autoCorrect={false}
            secureTextEntry={!showKey} style={{ flex: 1, fontSize: 14, letterSpacing: 1 }} />
          <Pressable onPress={() => setShowKey((v) => !v)} hitSlop={10}>
            <Icon name={showKey ? 'visibility' : 'visibility_off'} size={20} color={c.muted} />
          </Pressable>
        </View>
        <Note icon="info" style={{ marginTop: 10, marginHorizontal: 16 }}>{T('keyWarnHost', { host: hostName })}</Note>
        {foot({ primary: T('signIn'), onPrimary: () => void begin(), disabled: !apiKey.trim() })}
      </>
    );
  } else if (needsEmail && !prompt && !started) {
    body = (
      <>
        {title(T('loginEmailTitle'))}
        <View style={{ paddingTop: 16, paddingHorizontal: 16, gap: 6 }}>
          <Label>{T('emailLabel')}</Label>
          <TextInput value={email} onChangeText={setEmail} placeholder={T('loginEmail')} autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" textContentType="emailAddress" autoFocus
            style={{ backgroundColor: c.card, borderWidth: 1.5, borderColor: c.ink, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, fontSize: 15 }} />
          <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 4 }}>{T('prefillsPage')}</Text>
        </View>
        {foot({ primary: T('loginContinue'), onPrimary: () => void begin(), disabled: !email.trim() })}
      </>
    );
  } else if (!prompt || submitting) {
    body = (
      <>
        {title(submitting ? T('loginFinishingTitle') : T('loginBrowserTitle'))}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 80 }}>
          <WaitBars large />
          <Text style={{ fontSize: 15, color: c.text2 }}>{submitting ? T('loginFinishing') : T('wStarting')}</Text>
        </View>
        {foot({ other: !submitting })}
      </>
    );
  } else if (prompt.needs_code) {
    const suspicious = looksLikeEmailCode(code);
    body = (
      <>
        {title(T('loginFinishTitle'))}
        {!!email.trim() && (
          <View style={{ paddingTop: 16, paddingHorizontal: 16, gap: 6 }}>
            <Label>{T('emailLabel')}</Label>
            <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12 }}>
              <Text style={{ fontSize: 15 }}>{email.trim()}</Text>
            </View>
            <Text style={{ fontSize: 12, color: c.faint, paddingHorizontal: 4 }}>{T('prefillsPage')}</Text>
          </View>
        )}
        <View style={{ paddingTop: 14, paddingHorizontal: 16, gap: 6 }}>
          <Label>{T('authCodeLabel')}</Label>
          <TextInput value={code} onChangeText={setCode} placeholder={T('loginCodeLabel')} mono multiline autoCapitalize="none" autoCorrect={false}
            style={{ backgroundColor: c.card, borderWidth: 1.5, borderColor: c.ink, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, fontSize: 14, minHeight: 81, textAlignVertical: 'top' }} />
          {!!prompt.url && (
            <View style={{ alignSelf: 'flex-start', paddingHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <LinkText title={T('loginOpenAgain')} onPress={openPage} onLongPress={copyLink} size={12} />
                <LinkText title={T('loginNewLink')} onPress={() => void begin()} size={12} />
              </View>
            </View>
          )}
        </View>
        {suspicious && (
          <View style={{ marginTop: 10, marginHorizontal: 16, backgroundColor: c.warnBg, borderRadius: 12, padding: 12, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ paddingTop: 1 }}><Icon name="warning" size={16} color={c.warn} /></View>
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 13 * 1.45, color: c.text2 }}>{T('wrongCodeShort')}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={() => void submit()} style={({ pressed }) => [{ borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.card, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 }, pressed && { opacity: 0.6 }]}>
                <Text style={{ fontSize: 13, fontWeight: '600' }}>{T('sendAnyway')}</Text>
              </Pressable>
            </View>
          </View>
        )}
        {foot({ primary: T('loginSubmit'), disabled: busy || !code.trim(), onPrimary: () => {
          if (!suspicious) { void submit(); return; }
          alert(T('wrongCodeTitle'), T('wrongCodeBody'), [
            { text: T('cancel'), style: 'cancel' },
            { text: T('sendAnyway'), onPress: () => void submit() },
          ]);
        } })}
      </>
    );
  } else if (prompt.code) {
    body = (
      <>
        <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 8 }}>
          <Eyebrow color={c.faint}>{`${NAMES[provider ?? 'claude']} · ${T('deviceCode')}`}</Eyebrow>
          <Text style={{ fontSize: 28, fontWeight: '600', letterSpacing: em(28, -0.02) }}>{T('deviceTitle')}</Text>
          <Text style={{ fontSize: 14, color: c.muted, lineHeight: 21 }}>{T('deviceBody')}</Text>
        </View>
        <Pressable onPress={() => { void Clipboard.setStringAsync(prompt.code!); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          style={{ marginTop: 26, marginHorizontal: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 18,
                   paddingTop: 28, paddingHorizontal: 16, paddingBottom: 18, alignItems: 'center', gap: 14 }}>
          <Text mono style={{ fontSize: 40, fontWeight: '600', letterSpacing: em(40, 0.12) }}>{prompt.code}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name={copied ? 'check' : 'content_copy'} size={16} weight={400} color={copied ? c.ok : c.muted} />
            <Text style={{ fontSize: 13, color: copied ? c.ok : c.muted }}>{copied ? T('copied') : T('tapToCopy')}</Text>
          </View>
        </Pressable>
        <View style={{ marginTop: 28, marginHorizontal: 20, alignItems: 'center', gap: 12 }}>
          <WaitBars />
          <Text style={{ fontSize: 14, color: c.text2 }}>{T('loginWaiting')}</Text>
        </View>
        {foot({ primary: T('openDevicePage'), onPrimary: openPage })}
      </>
    );
  } else {
    body = (
      <>
        {title(T('loginBrowserTitle'))}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 80 }}>
          <WaitBars large />
          <Text style={{ fontSize: 15, color: c.text2 }}>{T('loginWaiting')}</Text>
          {!!prompt.url && (
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <LinkText title={T('loginOpenAgain')} onPress={openPage} onLongPress={copyLink} size={13} />
              <LinkText title={T('loginNewLink')} onPress={() => void begin()} size={13} />
            </View>
          )}
        </View>
        {foot({})}
      </>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <BackBar onPress={() => router.back()} />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">{body}</ScrollView>
    </KeyboardAvoidingView>
  );
}

