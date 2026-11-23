import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

/** A round grid of dots that says what a call is doing: breathing while it
 *  waits, rippling out while it listens, a light circling while it thinks,
 *  scattered pulses while it speaks. After Rare UI's MatrixOrb (rareui.com,
 *  MIT + Commons Clause + Attribution, © Swami Malode), redrawn with React
 *  Native's own Animated so every dot runs on the native driver.
 *
 *  One clock drives all of it; a dot is that clock shifted by where it sits —
 *  its distance from the middle for a ripple, its angle for the circling. */
export type OrbMode = 'idle' | 'listening' | 'thinking' | 'speaking';

const PERIOD: Record<OrbMode, number> = { idle: 2600, listening: 1500, thinking: 1100, speaking: 800 };

export function MatrixOrb({ mode, color, size = 150, grid = 13 }: {
  mode: OrbMode; color: string; size?: number; grid?: number;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    t.setValue(0);
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: PERIOD[mode], easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [mode, t]);

  const step = size / grid;
  const dot = step * 0.64;
  const dots = useMemo(() => {
    const out: { x: number; y: number; d: number; a: number; r: number }[] = [];
    const mid = (grid - 1) / 2;
    let h = 7;
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const dx = (j - mid) / mid, dy = (i - mid) / mid;
        const d = Math.hypot(dx, dy);
        if (d > 1.02) continue;
        h = (h * 1103515245 + 12345) >>> 0;
        out.push({ x: j * step + (step - dot) / 2, y: i * step + (step - dot) / 2, d: Math.min(1, d), a: (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI), r: ((h >>> 8) % 1000) / 1000 });
      }
    }
    return out;
  }, [grid, step, dot]);

  return (
    <View style={{ width: size, height: size }}>
      {dots.map((p, i) => {
        // Where in the clock's turn this dot peaks.
        const offset = mode === 'listening' ? 1 - p.d * 0.7
          : mode === 'thinking' ? p.a
          : mode === 'speaking' ? p.r
          : p.d * 0.35;
        const local = Animated.modulo(Animated.add(t, offset), 1);
        // The middle stays brighter than the rim, so it reads as a sphere.
        const rim = 1 - p.d * 0.4;
        const lo = mode === 'idle' ? 0.32 * rim : 0.2 * rim;
        const hi = mode === 'idle' ? 0.8 * rim + 0.1 : Math.min(1, rim + 0.1);
        const shape = mode === 'thinking' || mode === 'listening'
          ? { inputRange: [0, 0.18, 0.5, 1], outputRange: [hi, lo, lo, hi] }
          : { inputRange: [0, 0.5, 1], outputRange: [lo, hi, lo] };
        return (
          <Animated.View key={i} style={{
            position: 'absolute', left: p.x, top: p.y, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color,
            opacity: local.interpolate(shape),
            transform: [{ scale: local.interpolate({ ...shape, outputRange: shape.outputRange.map((v) => 0.6 + v * 0.45) }) }],
          }} />
        );
      })}
    </View>
  );
}
