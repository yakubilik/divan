import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useColors } from '../theme';
import { useT } from '../store';
import { Icon, SelectableText, Text } from './ui';

/** A fenced block in an answer: its language over it, a copy button beside
 *  that, and the code itself selectable. Also what a ```mermaid block falls
 *  back to when it cannot be drawn (`diagram.tsx`). */
export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const c = useColors();
  const T = useT();
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ backgroundColor: c.code, borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: 'hidden', marginBottom: 9 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10,
                     borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Text mono style={{ fontSize: 10.5, color: c.faint }}>{lang || 'text'}</Text>
        <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={T('copyCode')}
          onPress={() => { void Clipboard.setStringAsync(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
          <Icon name={copied ? 'check' : 'content_copy'} size={14} color={copied ? c.ok : c.faint} />
        </Pressable>
      </View>
      <SelectableText mono style={{ fontSize: 12, lineHeight: 12 * 1.6, paddingVertical: 8, paddingHorizontal: 10 }}>{code}</SelectableText>
    </View>
  );
}
