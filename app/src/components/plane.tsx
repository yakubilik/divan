import React, { useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useColors } from '../theme';
import { useT } from '../store';
import { Button, EmptyState, Spinner } from './ui';

/** A product's board, which is Plane: its page in a web view filling the face.
 *
 *  The sign-in is Plane's own and is kept in the phone's shared cookie jar, so
 *  it is asked for once. Plane is somebody else's web app on another computer,
 *  so the two things that go wrong are said plainly — no Plane configured on
 *  any machine that has this product, and a Plane that does not answer (the
 *  phone off the tailnet, the computer asleep) — each with a way on. */
export function PlaneBoard({ url }: { url: string }) {
  const c = useColors();
  const T = useT();
  const [down, setDown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(0);

  if (!url) return <EmptyState icon="view_agenda" title={T('plNone')} body={T('plNoneBody')} />;
  if (down) {
    return (
      <EmptyState icon="cloud_off" title={T('plDown')} body={T('plDownBody')}
        action={<Button title={T('plRetry')} onPress={() => { setDown(false); setLoading(true); setRound((r) => r + 1); }} />} />
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <WebView key={`${url}#${round}`} source={{ uri: url }} style={{ flex: 1, backgroundColor: c.bg }}
        sharedCookiesEnabled thirdPartyCookiesEnabled domStorageEnabled javaScriptEnabled
        allowsBackForwardNavigationGestures pullToRefreshEnabled
        setSupportMultipleWindows={false}
        onLoadEnd={() => setLoading(false)}
        onError={() => setDown(true)}
        onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setDown(true); }} />
      {loading && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 24, left: 0, right: 0, alignItems: 'center' }}>
          <Spinner size={18} />
        </View>
      )}
    </View>
  );
}
