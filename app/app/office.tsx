import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useStore, useT } from '../src/store';
import { httpBase } from '../src/ws';
import { useColors } from '../src/theme';
import { BackBar, Button, EmptyState, Spinner } from '../src/components/ui';

/** The office: every agent on the computer as a pixel character at a desk.
 *
 *  The page is the daemon's own (daemon/divan/office_page, pixtuoid's web
 *  build fed the hook lines office.py taps), so this screen is only a web view
 *  over it with the token in its address, as /screen.jpg takes it. The canvas
 *  is an office at night in both themes; there is no light version of it. */
export default function OfficeScreen() {
  const router = useRouter();
  const T = useT();
  const c = useColors();
  const host = useStore((s) => s.host);
  const [down, setDown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(0);
  const url = host ? `${httpBase(host.host, host.port)}/office/?token=${encodeURIComponent(host.token)}` : '';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <BackBar onPress={() => router.back()} />
      {!url || down ? (
        <EmptyState icon="cloud_off" title={T('officeDown')} body={T('officeDownBody')}
          action={<Button title={T('plRetry')} onPress={() => { setDown(false); setLoading(true); setRound((r) => r + 1); }} />} />
      ) : (
        <View style={{ flex: 1 }}>
          <WebView key={`${url}#${round}`} source={{ uri: url }} style={{ flex: 1, backgroundColor: '#1b1a24' }}
            javaScriptEnabled scrollEnabled={false} bounces={false} setSupportMultipleWindows={false}
            onLoadEnd={() => setLoading(false)}
            // A character tapped in the office names its chat (office.js).
            onMessage={(e) => {
              try {
                const d = JSON.parse(e.nativeEvent.data);
                if (d?.type === 'office-open' && typeof d.chat === 'string') router.push(`/chat/${d.chat}`);
              } catch { /* not ours */ }
            }}
            onError={() => setDown(true)}
            onHttpError={(e) => { if (e.nativeEvent.statusCode >= 400) setDown(true); }} />
          {loading && (
            <View pointerEvents="none" style={{ position: 'absolute', top: 24, left: 0, right: 0, alignItems: 'center' }}>
              <Spinner size={18} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
