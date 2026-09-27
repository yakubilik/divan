import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { useStore, useT } from '../src/store';
import { em, useColors } from '../src/theme';
import { Button, Icon, Spinner, Text } from '../src/components/ui';

/** Where the authorization code comes back. The CLI asks for `code=true`, so
 *  the service redirects here with the code in the query instead of handing it
 *  to a local server — which is why the phone can read it at all. */
const CALLBACK_HOST = 'platform.claude.com';
const CALLBACK_PATH = '/oauth/code/callback';

/** The code as the CLI wants it pasted: the authorization code, then the state
 *  it was issued against.
 *
 *  Matched on host and path, never as text inside the whole address: the
 *  authorize URL carries this very callback as its `redirect_uri`, and iOS
 *  hands back the address decoded — so a substring match fires on the sign-in
 *  page itself and reads `code=true` out of it. */
export function codeFromCallback(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.host !== CALLBACK_HOST || !u.pathname.startsWith(CALLBACK_PATH)) return null;
  const p = new URLSearchParams(
    u.search.replace(/^\?/, '') + '&' + u.hash.replace(/^#/, '').replace(/#/g, '&'));
  const code = p.get('code');
  // `code=true` is the CLI's own request flag, not an authorization code.
  if (!code || code === 'true' || code.length < 10) return null;
  const state = p.get('state');
  return state ? `${code}#${state}` : code;
}

/** Paths a sign-in passes through. Signing out inside the page — which is what
 *  you do when the wrong account is already signed in — navigates off the
 *  authorize URL and lands on the product itself (claude.com/new). No code can
 *  ever come back from there, and the screen used to sit and wait until the CLI
 *  gave up fifteen minutes later. Judged on the path alone, generously: a wrong
 *  guess only offers a button nobody has to press. */
const AUTH_MARKERS = ['oauth', 'login', 'log-in', 'signin', 'sign-in', 'auth', 'device',
  'verify', 'magic', 'consent', 'authorize', 'activate', 'callback', 'account',
  'onboarding', 'join'];

export function isSignInPage(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return true; }     // nothing to judge
  // about:blank and friends are what a WebView reports between pages.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return true;
  const p = u.pathname.toLowerCase();
  if (p === '/' || p === '') return true;              // mid-redirect, no path yet
  return AUTH_MARKERS.some((m) => p.includes(m));
}

export default function LoginWeb() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const T = useT();
  const c = useColors();
  const { id, url, code: oneTime } =
    useLocalSearchParams<{ id: string; url: string; code?: string; email?: string }>();
  const { submitLoginCode } = useStore();
  const authorizeUrl = String(url);
  const [host, setHost] = useState(() => {
    try { return new URL(authorizeUrl).host; } catch { return ''; }
  });
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [strayed, setStrayed] = useState(false);
  // Bumping this remounts the WebView: back to the authorize URL, and with
  // `incognito` a brand-new empty cookie store — the only way to be offered the
  // sign-in form again once a session has been established inside the page.
  const [attempt, setAttempt] = useState(0);
  const sent = useRef(false);
  const web = useRef<WebView>(null);

  const restart = useCallback(() => {
    setStrayed(false);
    setAttempt((a) => a + 1);
  }, []);

  const onNav = useCallback((nav: WebViewNavigation) => {
    try { setHost(new URL(nav.url).host); } catch {}
    if (sent.current) return;
    const code = codeFromCallback(nav.url);
    if (code) {
      sent.current = true;
      setSending(true);
      submitLoginCode(String(id), code)
        .catch(() => {})
        .finally(() => router.back());       // the result arrives as login.done
      return;
    }
    // Only once a page has settled: a redirect chain passes through addresses
    // that mean nothing on their own.
    if (!nav.loading) setStrayed(!isSignInPage(nav.url));
  }, [id, router, submitLoginCode]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, paddingHorizontal: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [sq36, pressed && { opacity: 0.5 }]}>
          <Icon name="close" size={24} />
        </Pressable>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: c.fill, borderRadius: 10, padding: 7 }}>
          <Icon name="lock" size={14} color={c.muted} />
          <Text numberOfLines={1} style={{ fontSize: 13, color: c.text2 }}>{host}</Text>
        </View>
        <Pressable onPress={restart} hitSlop={8} style={({ pressed }) => [sq36, pressed && { opacity: 0.5 }]}>
          <Icon name="refresh" size={22} />
        </Pressable>
      </View>

      {!!oneTime && (
        // Codex signs in with a one-time code typed into the page. It stays in
        // front of the user the whole time, one tap from the clipboard.
        <Pressable onPress={() => { void Clipboard.setStringAsync(String(oneTime)); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: c.code, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <Text style={{ fontSize: 12, color: c.muted }}>{T('codeLabel')}</Text>
          <Text mono style={{ fontSize: 15, fontWeight: '600', letterSpacing: em(15, 0.1), flex: 1 }}>{oneTime}</Text>
          <Icon name={copied ? 'check' : 'content_copy'} size={18} color={copied ? c.ok : c.muted} />
        </Pressable>
      )}

      {/* `incognito`, never shared cookies: the phone is signed in to the
          service as somebody already, and the authorize page honours that
          session without ever showing a form — so a second account came back
          as the first one, with the address only ever a form pre-fill. A
          private store makes the sign-in ask who is signing in. */}
      <WebView key={attempt} ref={web} source={{ uri: authorizeUrl }} incognito
        onNavigationStateChange={onNav}
        style={{ flex: 1, backgroundColor: '#fff' }}
        startInLoadingState renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }]}><Spinner size={18} /></View>
        )} />

      {sending ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, backgroundColor: c.veil }]}>
          <Spinner size={26} width={3} />
          <Text style={{ fontSize: 17, fontWeight: '600' }}>{T('loginCodeCaught')}</Text>
          <Text style={{ fontSize: 13, color: c.muted }}>{T('loginFinishing')}</Text>
        </View>
      ) : strayed ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 16,
                       padding: 16, gap: 10, boxShadow: c.scheme === 'dark' ? '0 24px 56px -20px rgba(0,0,0,.6)' : '0 24px 56px -20px rgba(28,27,22,.3)' }}>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>{T('loginStrayedTitle')}</Text>
          <Text style={{ fontSize: 13, color: c.muted, lineHeight: 13 * 1.45 }}>{T('loginStrayed')}</Text>
          <Button title={T('loginReturn')} onPress={restart} />
        </View>
      ) : null}
    </View>
  );
}

const sq36 = { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' } as const;
