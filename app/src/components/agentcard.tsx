import React from 'react';
import { Pressable, View } from 'react-native';
import { useColors } from '../theme';
import { useT } from '../store';
import { Text } from './ui';
import type { Agent } from '../protocol';

/** #rgb / #rrggbb -> #rrggbb; anything else falls back to the accent. */
export function hex6(color: string | null | undefined, fallback = '#FF5A48'): string {
  let h = (color || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  return h.length === 6 && !/[^0-9a-f]/i.test(h) ? `#${h}` : fallback;
}

/** An agent's mark: its initial, in its own colour, on a tint of that colour. */
export function AgentGlyph({ label, color, size = 40, radius = 12, font = 18 }: { label: string; color: string; size?: number; radius?: number; font?: number }) {
  const col = hex6(color);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: col + '22', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: font, fontWeight: '600', color: col }}>{(label.trim()[0] || '?').toUpperCase()}</Text>
    </View>
  );
}

/** One agent as a square card: its mark at the top, its name and what it is
 *  for at the bottom. */
export function AgentCard({ agent, onPress, onLongPress, disabled, busy }:
  { agent: Agent; onPress: () => void; onLongPress?: () => void; disabled?: boolean; busy?: boolean }) {
  const T = useT();
  const c = useColors();
  // The one agent that ships with the app speaks the app's language.
  const isCreator = agent.id === 'builtin:agent-creator';
  const label = isCreator ? T('creatorLabel') : agent.label;
  const desc = isCreator ? T('creatorDesc') : agent.description;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled}
      style={({ pressed }) => [{ width: '48.5%', aspectRatio: 1, backgroundColor: pressed ? c.fill : c.card, borderWidth: 1, borderColor: c.line,
                                 borderRadius: 16, padding: 14, gap: 6 }]}>
      <AgentGlyph label={label} color={agent.color} />
      <View style={{ flex: 1 }} />
      <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>{busy ? '…' : label}</Text>
      {!!desc && <Text numberOfLines={2} style={{ fontSize: 12, color: c.muted, lineHeight: 12 * 1.35 }}>{desc}</Text>}
    </Pressable>
  );
}
