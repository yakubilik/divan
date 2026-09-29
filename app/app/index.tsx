import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { useStore } from '../src/store';
import { HOME } from '../src/shell';
import { useColors } from '../src/theme';

export default function Index() {
  const ready = useStore((s) => s.ready);
  const host = useStore((s) => s.host);
  const c = useColors();
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  // Divan opens on the Dashboard: every project on every machine, rather than
  // one computer's chats.
  return <Redirect href={host ? HOME : '/welcome'} />;
}
