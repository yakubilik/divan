import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useColors } from '../theme';
import { useT } from '../store';
import { DIAGRAM_ORIGINS, DIAGRAM_TIMEOUT_MS, diagramNavGuard, readDiagramMessage } from '../mermaid';
import { mermaidPage } from '../mermaid-page';
import { CodeBlock } from './code';
import { Text } from './ui';

/** How tall a diagram's box is while it is being drawn, before the page has
 *  said how tall the drawing is. */
export const DIAGRAM_PLACEHOLDER_H = 180;

/** What each diagram came out as, by theme and source: a transcript scrolled
 *  back to a diagram (the list unmounts what is off screen) opens it at its
 *  own size at once instead of growing it out of the placeholder again, and
 *  one that failed does not wait another five seconds to say so. */
const drawn = new Map<string, { w: number; h: number }>();
const failed = new Set<string>();

/** A ```mermaid block, drawn: the bundled mermaid in a WebView of its own,
 *  exactly as tall as the drawing, as wide as the bubble, and scrolled
 *  sideways when the drawing is wider than that. Whatever goes wrong — the
 *  text is not a diagram mermaid knows, the page never answers — it is the
 *  code block it would have been, with one muted line over it. */
export function Diagram({ code }: { code: string }) {
  const c = useColors();
  // A new theme or a new text is a new drawing.
  return <DiagramView key={`${c.scheme}\n${code}`} code={code} />;
}

function DiagramView({ code }: { code: string }) {
  const c = useColors();
  const T = useT();
  const id = `${c.scheme}\n${code}`;
  const [size, setSize] = useState(() => drawn.get(id) ?? null);
  const [broken, setBroken] = useState(() => failed.has(id));
  const [box, setBox] = useState(0);
  // A page iOS throws away is drawn again from scratch, as a fresh WebView —
  // reloading the old one would be a second load, which the guard refuses.
  const [round, setRound] = useState(0);
  const html = useMemo(() => mermaidPage({ code, dark: c.scheme === 'dark', background: c.card }), [code, c.scheme, c.card]);
  const guard = useMemo(() => diagramNavGuard(), [round]);
  const done = useRef(!!(size || broken));

  const fail = () => { done.current = true; failed.add(id); setBroken(true); };

  useEffect(() => {
    if (done.current) return;
    const t = setTimeout(() => { if (!done.current) fail(); }, DIAGRAM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  if (broken) {
    return (
      <View testID="diagram-fallback">
        <Text style={{ fontSize: 12.5, color: c.muted, marginBottom: 5 }}>{T('diagramFailed')}</Text>
        <CodeBlock lang="mermaid" code={code} />
      </View>
    );
  }

  const inner = Math.max(0, box - 2);   // inside the 1pt border
  const h = size?.h ?? DIAGRAM_PLACEHOLDER_H;
  const wide = !!size && inner > 0 && size.w > inner;
  return (
    <View testID="diagram" accessibilityLabel="Diagram"
      onLayout={(e) => setBox(Math.round(e.nativeEvent.layout.width))}
      style={{ alignSelf: 'stretch', height: h + 2, backgroundColor: c.card, borderWidth: 1, borderColor: c.line,
               borderRadius: 10, overflow: 'hidden', marginBottom: 9 }}>
      {inner > 0 && (
        <ScrollView horizontal scrollEnabled={wide} showsHorizontalScrollIndicator={wide} bounces={false}
          contentContainerStyle={{ minWidth: inner }}>
          <WebView
            key={round}
            originWhitelist={DIAGRAM_ORIGINS}
            source={{ html }}
            onShouldStartLoadWithRequest={guard}
            onMessage={(e) => {
              if (done.current && !size) return;
              const m = readDiagramMessage(e.nativeEvent.data);
              if (!m) return;
              if (m.t === 'error') { fail(); return; }
              done.current = true;
              drawn.set(id, { w: m.w, h: m.h });
              setSize({ w: m.w, h: m.h });
            }}
            onError={() => { if (!size) fail(); }}
            onContentProcessDidTerminate={() => setRound((r) => r + 1)}
            style={{ width: Math.max(inner, size?.w ?? 0), height: h, backgroundColor: c.card, opacity: size ? 1 : 0 }}
            containerStyle={{ flex: 0 }}
            scrollEnabled={false}
            bounces={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            setSupportMultipleWindows={false}
            allowsLinkPreview={false}
            dataDetectorTypes="none"
            allowFileAccess={false}
            cacheEnabled={false}
            javaScriptCanOpenWindowsAutomatically={false}
          />
        </ScrollView>
      )}
    </View>
  );
}
