// Where `divan://share?url=…` lands: the share extension's hand-over (#333).
//
// Nothing is drawn here. The link goes into the pen (`src/share.ts`) and the
// screen steps out of the way at once — back to whatever was open, or to the
// app's first place on a cold start. The root layout takes the link out of the
// pen when the app can act on it and opens its chat; a share with no link in
// it is turned away here, out loud, and opens nothing.
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useT } from '../src/store';
import { useColors } from '../src/theme';
import { alert } from '../src/components/overlay';
import { receive, shares } from '../src/share';

export default function Share() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const router = useRouter();
  const T = useT();
  const c = useColors();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    receive(shares, params, () => alert(T('shareNoLink'), T('shareNoLinkBody')));
    if (router.canGoBack()) router.back(); else router.replace('/');
  }, [params, router, T]);
  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}
