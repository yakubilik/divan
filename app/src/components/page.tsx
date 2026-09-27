import React, { useState } from 'react';
import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme';
import { BackBar, CompactBar, LargeTitle } from './ui';

/** A pushed screen with a large title that folds into a centred one once it
 *  has scrolled out of sight, the way the design draws Settings and Pool. */
export function LargeTitlePage({ title, children, backIcon, onBack, contentStyle, titleStyle, ...scroll }: {
  title: string; children: React.ReactNode; backIcon?: string; onBack?: () => void;
  contentStyle?: ScrollViewProps['contentContainerStyle']; titleStyle?: any;
} & Omit<ScrollViewProps, 'contentContainerStyle'>) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useColors();
  const [folded, setFolded] = useState(false);
  const back = onBack ?? (() => router.back());
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ height: 42 }}>
        {folded
          ? <View style={{ position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, backgroundColor: c.bg }}><CompactBar title={title} onBack={back} /></View>
          : <BackBar onPress={back} icon={backIcon} />}
      </View>
      <ScrollView scrollEventThrottle={16} onScroll={(e) => setFolded(e.nativeEvent.contentOffset.y > 34)}
        contentContainerStyle={[{ paddingBottom: insets.bottom + 24 }, contentStyle as any]} {...scroll}>
        <LargeTitle style={[{ paddingTop: 2, paddingBottom: 12 }, titleStyle]}>{title}</LargeTitle>
        {children}
      </ScrollView>
    </View>
  );
}
