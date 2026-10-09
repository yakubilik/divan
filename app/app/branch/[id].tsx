import React from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useStore } from '../../src/store';
import { HOME } from '../../src/shell';
import { useColors } from '../../src/theme';

/** A branch used to have a page of its own here (`/branch/seo?project=quire`).
 *  It is gone from the phone, and what is left of the route is where a link
 *  somebody kept lands: the product it named, or the Dashboard where it named
 *  none. A product that is no longer on this phone is the Dashboard as well —
 *  that is what the Dashboard draws for a key it does not know. */
export default function BranchScreen() {
  const ready = useStore((s) => s.ready);
  const host = useStore((s) => s.host);
  const c = useColors();
  const params = useLocalSearchParams<{ id?: string; project?: string }>();
  const key = (Array.isArray(params.project) ? params.project[0] : params.project) || null;
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (!host) return <Redirect href="/welcome" />;
  return <Redirect href={key ? `${HOME}?project=${encodeURIComponent(key)}` : HOME} />;
}
