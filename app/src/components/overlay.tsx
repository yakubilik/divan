import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View, type TextInput as RNTextInput } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FullWindowOverlay } from 'react-native-screens';
import { Icon } from './icon';
import { Text, TextInput } from './text';
import { useColors } from '../theme';

/* Menus and dialogs are drawn by the app, not by the system: the design has
 * its own menu (icons, a divider before the destructive entry, a submenu that
 * replaces the list) and its own dialog (a hint under the title, a field with
 * an ink border). One host each, mounted once in the root layout, driven from
 * anywhere through the functions below. */

/** Where a menu or dialog is drawn. On iOS it goes straight onto the window:
 *  a React Native Modal is presented by the view controller it lives in, and
 *  from the root that is refused while a sheet or a full-screen sign-in is up
 *  — the dialog never appears and the host thinks it is still showing. The
 *  window has no such rule, and a new layer lands on top of whatever is up. */
export function Layer({ children, onRequestClose }: { children: React.ReactNode; onRequestClose: () => void }) {
  if (Platform.OS === 'ios') {
    return <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{children}</FullWindowOverlay>;
  }
  return (
    <Modal visible transparent animationType="none" onRequestClose={onRequestClose} statusBarTranslucent>
      {children}
    </Modal>
  );
}

// ── menu ────────────────────────────────────────────────────────────────────

export type MenuItem =
  | { kind?: 'item'; label: string; icon?: string; danger?: boolean; submenu?: boolean; checked?: boolean; onPress: () => void }
  | { kind: 'divider' }
  | { kind: 'back'; label: string; onPress: () => void }
  | { kind: 'cancel'; label: string };

export interface Rect { x: number; y: number; width: number; height: number }

export interface MenuSpec {
  items: MenuItem[];
  /** Where the menu hangs from. The menu opens below it, or above if there is no room. */
  anchor: Rect;
  align?: 'left' | 'right';
  width?: number;
  /** A copy of what was long-pressed, lifted above the dim. With a preview the
   *  page is dimmed; without one the menu floats over it. */
  preview?: React.ReactNode;
  previewRect?: Rect;
  onClose?: () => void;
}

let setMenu: ((m: MenuSpec | null) => void) | null = null;
let menuSpec: MenuSpec | null = null;

export function openMenu(spec: MenuSpec) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  menuSpec = spec;
  setMenu?.(spec);
}
/** Swap the items in place — how a submenu opens. */
export function replaceMenu(items: MenuItem[]) {
  if (!menuSpec) return;
  menuSpec = { ...menuSpec, items };
  setMenu?.(menuSpec);
}
export function closeMenu() {
  const cb = menuSpec?.onClose;
  if (menuSpec) noteClosed();
  menuSpec = null;
  setMenu?.(null);
  cb?.();
}

/** A Modal (Android, and anything else drawn as one) will not come up while
 *  another is still going away, and a menu entry that opens a dialog, or a
 *  dialog button that opens the next one, does exactly that. Anything that
 *  closes a layer notes it here; the next one waits it out. */
let lastClose = 0;
export function noteClosed() { lastClose = Date.now(); }
export function afterOverlays(run: () => void) {
  const wait = Platform.OS === 'ios' ? 0 : 320 - (Date.now() - lastClose);
  if (wait > 0) setTimeout(run, wait); else run();
}
const afterMenu = afterOverlays;

/** Measure a view for `anchor` / `previewRect`. */
export function measure(ref: React.RefObject<View | null>): Promise<Rect> {
  return new Promise((resolve) => {
    const v = ref.current as any;
    if (!v?.measureInWindow) { resolve({ x: 0, y: 0, width: 0, height: 0 }); return; }
    v.measureInWindow((x: number, y: number, width: number, height: number) => resolve({ x, y, width, height }));
  });
}

export function MenuHost() {
  const c = useColors();
  const win = useWindowDimensions();
  const [spec, set] = useState<MenuSpec | null>(null);
  const [menuH, setMenuH] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => { setMenu = set; return () => { setMenu = null; }; }, []);
  useEffect(() => {
    // A closed menu forgets its height; the next one is measured afresh.
    if (!spec) { setMenuH(0); return; }
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [spec?.anchor, fade]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!spec) return null;

  const width = spec.width ?? 236;
  const gap = spec.preview ? 12 : 8;
  const below = spec.anchor.y + spec.anchor.height + gap;
  const fitsBelow = below + menuH < win.height - 24;
  const top = fitsBelow ? below : Math.max(56, spec.anchor.y - gap - menuH);
  const left = spec.align === 'right'
    ? Math.max(12, spec.anchor.x + spec.anchor.width - width)
    : Math.min(spec.anchor.x, win.width - width - 12);
  const scrim = !!spec.preview;

  return (
    <Layer onRequestClose={closeMenu}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Pressable style={[StyleSheet.absoluteFill, scrim && { backgroundColor: c.scrim }]} onPress={closeMenu} />
        {spec.preview && spec.previewRect && (
          <View pointerEvents="none" style={{ position: 'absolute', left: spec.previewRect.x, top: spec.previewRect.y, width: spec.previewRect.width }}>
            {spec.preview}
          </View>
        )}
        <View onLayout={(e) => setMenuH(e.nativeEvent.layout.height)}
          style={{ position: 'absolute', left, top, width, backgroundColor: c.card, borderRadius: 14, padding: 6,
                   boxShadow: scrim ? c.shadow.menu : c.shadow.pop, borderWidth: scrim ? 0 : 1, borderColor: c.line,
                   opacity: menuH ? 1 : 0 }}>
          {spec.items.map((it, i) => <MenuRow key={i} item={it} />)}
        </View>
      </Animated.View>
    </Layer>
  );
}

function MenuRow({ item }: { item: MenuItem }) {
  const c = useColors();
  if (item.kind === 'divider') return <View style={{ height: 1, backgroundColor: c.line, marginVertical: 4, marginHorizontal: 6 }} />;
  if (item.kind === 'back') {
    return (
      <Pressable onPress={item.onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8, paddingHorizontal: 8, paddingBottom: 6 }, pressed && { opacity: 0.6 }]}>
        <Icon name="chevron_left" size={18} color={c.muted} />
        <Text style={{ fontSize: 13, color: c.muted }}>{item.label}</Text>
      </Pressable>
    );
  }
  if (item.kind === 'cancel') {
    return (
      <Pressable onPress={closeMenu} style={({ pressed }) => [{ padding: 10, borderRadius: 8, alignItems: 'center' }, pressed && { backgroundColor: c.fill }]}>
        <Text style={{ fontSize: 15, color: c.muted }}>{item.label}</Text>
      </Pressable>
    );
  }
  const color = item.danger ? c.danger : c.ink;
  return (
    <Pressable
      onPress={() => { if (!item.submenu) closeMenu(); item.onPress(); }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8 }, pressed && { backgroundColor: c.fill }]}>
      <View style={{ width: 18 }}>
        {item.checked ? <Icon name="check" size={18} color={color} /> : item.icon ? <Icon name={item.icon} size={18} color={color} /> : null}
      </View>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color }}>{item.label}</Text>
      {item.submenu && <Icon name="chevron_right" size={18} color={c.faint} />}
    </Pressable>
  );
}

// ── dialog ──────────────────────────────────────────────────────────────────

export interface DialogButton { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }

interface DialogSpec {
  title: string;
  message?: string;
  buttons: DialogButton[];
  input?: {
    value: string; placeholder?: string; secure?: boolean;
    /** Resolves to an error message to keep the dialog open with it shown
     *  under the title (a name already taken), or nothing to close it. */
    submit: (v: string) => Promise<string | void> | string | void;
    confirm: string;
  };
}

let setDialog: ((d: DialogSpec | null) => void) | null = null;

/** Alert.alert, drawn in the app's own dialog. */
export function alert(title: string, message?: string, buttons?: DialogButton[]) {
  afterMenu(() => setDialog?.({ title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] }));
}

/** Alert.prompt, drawn in the app's own dialog. */
export function prompt(opts: {
  title: string; message?: string; value?: string; placeholder?: string; confirm: string; cancel: string;
  submit: (v: string) => Promise<string | void> | string | void;
}) {
  afterMenu(() => setDialog?.({
    title: opts.title, message: opts.message,
    buttons: [{ text: opts.cancel, style: 'cancel' }],
    input: { value: opts.value ?? '', placeholder: opts.placeholder, submit: opts.submit, confirm: opts.confirm },
  }));
}

export function DialogHost() {
  const c = useColors();
  const [spec, set] = useState<DialogSpec | null>(null);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const input = useRef<RNTextInput>(null);
  const current = useRef<DialogSpec | null>(null);
  current.current = spec;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => { setDialog = set; return () => { setDialog = null; }; }, []);
  useEffect(() => {
    if (!spec) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    setValue(spec.input?.value ?? '');
    setMessage(spec.message);
    setBusy(false);
    // autoFocus inside a Modal fires before iOS has presented it; ask again
    // once it is on screen.
    if (!spec.input) return;
    const t = setTimeout(() => input.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [spec]);
  if (!spec) return null;

  const close = () => { Keyboard.dismiss(); noteClosed(); set(null); };
  async function confirm() {
    const mine = spec;
    if (!mine?.input || busy) return;
    setBusy(true);
    try {
      const err = await mine.input.submit(value);
      // Another dialog may have taken this one's place while the answer was
      // on its way; this answer is not allowed to close that one.
      if (current.current !== mine) return;
      if (typeof err === 'string' && err) { setMessage(err); setBusy(false); input.current?.focus(); return; }
      close();
    } catch (e: any) {
      if (current.current !== mine) return;
      setMessage(e?.message ?? String(e)); setBusy(false);
    }
  }
  const buttons: DialogButton[] = spec.input
    ? [...spec.buttons, { text: spec.input.confirm, onPress: () => void confirm() }]
    : spec.buttons;

  return (
    <Layer onRequestClose={() => { if (!busy) close(); }}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44 },
        Platform.OS === 'ios' && spec.input ? { paddingBottom: 120 } : null]}>
        <View style={{ width: '100%', backgroundColor: c.card, borderRadius: 16, overflow: 'hidden', boxShadow: c.shadow.menu }}>
          <View style={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 14, gap: 6 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', textAlign: 'center' }}>{spec.title}</Text>
            {!!message && <Text style={{ fontSize: 13, color: c.muted, lineHeight: 13 * 1.4, textAlign: 'center' }}>{message}</Text>}
            {spec.input && (
              <TextInput ref={input} value={value} onChangeText={setValue} autoFocus
                placeholder={spec.input.placeholder} autoCapitalize="none" autoCorrect={false}
                secureTextEntry={spec.input.secure} returnKeyType="done" onSubmitEditing={() => void confirm()}
                style={{ marginTop: 8, borderWidth: 1.5, borderColor: c.ink, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10, fontSize: 15 }} />
            )}
          </View>
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line }}>
            {buttons.map((b, i) => {
              const cancel = b.style === 'cancel';
              const primary = !cancel && (i === buttons.length - 1);
              return (
                <Pressable key={i} disabled={busy}
                  onPress={() => { if (!spec.input || cancel) close(); b.onPress?.(); }}
                  style={({ pressed }) => [{ flex: 1, padding: 13, alignItems: 'center' },
                    i < buttons.length - 1 && { borderRightWidth: 1, borderRightColor: c.line },
                    pressed && { backgroundColor: c.fill }]}>
                  <Text style={{ fontSize: 15, fontWeight: primary ? '600' : '400',
                    color: b.style === 'destructive' ? c.danger : cancel ? c.muted : c.ink,
                    opacity: busy ? 0.5 : 1 }}>{b.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      </Animated.View>
    </Layer>
  );
}
