import React, { useEffect, useRef, useState } from 'react';
import { structuredInput, type ApprovalResponse } from '../approval-input';
import { ApprovalForm } from './approval-form';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { AstRenderer, MarkdownIt, renderRules, stringToTokens, tokensToAST } from 'react-native-markdown-display';
// @ts-ignore - exported at runtime, absent from the package's typings
import { removeTextStyleProps, styles as mdDefaults } from 'react-native-markdown-display';
// The three passes the library's own `parser()` runs between tokens and AST.
// Not re-exported, so they are reached by path; building the AST here is what
// lets the keys be ours (see below).
// @ts-ignore
import { cleanupTokens } from 'react-native-markdown-display/src/lib/util/cleanupTokens';
// @ts-ignore
import groupTextTokens from 'react-native-markdown-display/src/lib/util/groupTextTokens';
// @ts-ignore
import omitListItemParagraph from 'react-native-markdown-display/src/lib/util/omitListItemParagraph';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { em, family, useColors, type Palette } from '../theme';
import { useStore, useT } from '../store';
import { Icon, SelectableText, Spinner, Text } from './ui';
import { FileChip, ImageGroup, VideoBubble, VoiceBubble } from './media';
import type { Attachment } from '../store';
import { ticketNotice, type TicketNotice } from '../notice';

export function UserBubble({ text, attachments, queued }: { text: string; attachments?: Attachment[]; queued?: boolean }) {
  const c = useColors();
  const atts = attachments ?? [];
  // A ticket filed from this chat ended: one line, with the report behind it.
  // Read from the stored text, so a replayed history shows it the same way.
  const notice = React.useMemo(() => (atts.length ? null : ticketNotice(text)), [text, atts.length]);
  const images = atts.filter((a) => a.kind === 'image' || (!a.kind && /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name || a.path || '')));
  const videos = atts.filter((a) => a.kind === 'video');
  const voices = atts.filter((a) => a.kind === 'audio');
  const files = atts.filter((a) => !images.includes(a) && !videos.includes(a) && !voices.includes(a));
  // A voice note sent on its own carries its transcript, or a placeholder
  // when there was none, as the message text; the bubble already says both.
  const T = useT();
  const textIsTranscript = voices.length > 0 && (text === T('voiceMessage') || voices.some((v) => v.transcript && v.transcript === text));
  const media = images.length > 0 || videos.length > 0;
  if (notice) {
    return (
      <View style={{ gap: 6 }}>
        <TicketNoticeRow notice={notice} queued={!!queued} />
        {!!notice.after && <UserBubble text={notice.after} />}
      </View>
    );
  }
  return (
    <View style={{ alignSelf: 'flex-end', maxWidth: '80%', alignItems: 'flex-end', gap: media ? 4 : 6 }}>
      {images.length > 0 && <ImageGroup items={images} />}
      {videos.map((v) => <VideoBubble key={v.path} item={v} stacked={images.length > 0} />)}
      {voices.map((v) => <VoiceBubble key={v.path} item={v} />)}
      {files.map((f) => <FileChip key={f.path} item={f} />)}
      {!!text && !textIsTranscript && (
        <View style={{ backgroundColor: c.bubble, borderWidth: 1, borderColor: c.line,
                       borderRadius: 18, borderBottomRightRadius: 6, borderTopRightRadius: media ? 4 : 18,
                       paddingVertical: 10, paddingHorizontal: 13 }}>
          <SelectableText style={{ color: c.ink, fontSize: 17, lineHeight: 24 }}>{withSecrets(text, c)}</SelectableText>
        </View>
      )}
    </View>
  );
}

const NOTICE_TONE = {
  done: { icon: 'check', color: 'ok', word: 'tnDone' },
  blocked: { icon: 'info', color: 'warn', word: 'tnBlocked' },
  failed: { icon: 'warning', color: 'danger', word: 'tnFailed' },
} as const;

/** A ticket that ended, told to the chat that filed it (`src/notice.ts`).
 *
 *  One line — state, number, title — and a tap opens the report under it, the
 *  same as the web's. The paragraph that tells the agent what to do is part of
 *  the stored message and of what the agent read; it is not drawn at all. */
export function TicketNoticeRow({ notice, queued }: { notice: TicketNotice; queued?: boolean }) {
  const c = useColors();
  const T = useT();
  const [open, setOpen] = useState(false);
  const tone = NOTICE_TONE[notice.state];
  const color = c[tone.color];
  const word = T(tone.word);
  return (
    <View style={{ alignSelf: 'stretch', backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 12, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${word} #${notice.ticket}: ${notice.title}`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}>
        <Icon name={tone.icon} size={16} color={color} />
        <Text style={{ fontSize: 13, fontWeight: '600', color }}>{word}</Text>
        <Text mono style={{ fontSize: 12, color: c.muted }}>#{notice.ticket}</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, color: c.ink }}>{notice.title}</Text>
        {queued && <Text mono style={{ fontSize: 11, color: c.faint }}>{T('tnQueued')}</Text>}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} color={c.faint} />
      </Pressable>
      {open && (
        <View accessibilityLabel={T('tnReport', { n: notice.ticket })}
          style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10, paddingBottom: 12, paddingHorizontal: 12, gap: 8 }}>
          {notice.report
            ? <SelectableText style={{ color: c.ink, fontSize: 15, lineHeight: 22 }}>{withSecrets(notice.report, c)}</SelectableText>
            : <Text style={{ fontSize: 15, color: c.muted }}>{T('tnNoReport')}</Text>}
          {notice.facts.length > 0 && (
            <SelectableText mono style={{ fontSize: 12, lineHeight: 18, color: c.muted }}>{notice.facts.join('\n')}</SelectableText>
          )}
        </View>
      )}
    </View>
  );
}

/** The parser hands code blocks one trailing newline more than was written. */
function trimEnd(content: string): string {
  return typeof content === 'string' && content.endsWith('\n') ? content.slice(0, -1) : content;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const c = useColors();
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ backgroundColor: c.code, borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: 'hidden', marginBottom: 9 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10,
                     borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Text mono style={{ fontSize: 10.5, color: c.faint }}>{lang || 'text'}</Text>
        <Pressable hitSlop={10} onPress={() => { void Clipboard.setStringAsync(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
          <Icon name={copied ? 'check' : 'content_copy'} size={14} color={copied ? c.ok : c.faint} />
        </Pressable>
      </View>
      <SelectableText mono style={{ fontSize: 12, lineHeight: 12 * 1.6, paddingVertical: 8, paddingHorizontal: 10 }}>{code}</SelectableText>
    </View>
  );
}

/** Markdown builds every line out of plain <Text>, and a <Text> that is not
 *  `selectable` cannot be dragged through on iOS — so there was no way to take
 *  part of an answer, only the whole message. Copying one command out of a code
 *  block is the common case, and it was the one case that could not be done.
 *
 *  Only the rules that actually render text are replaced; everything else stays
 *  on the library's own defaults. */
/** Whether a node has a link anywhere under it. */
function hasLink(node: any): boolean {
  return node?.type === 'link' || node?.type === 'blocklink'
    || (Array.isArray(node?.children) && node.children.some(hasLink));
}

const rules = {
  /** The library wraps every run of plain text in a `<Text>` of its own. Inside
   *  a `selectable` paragraph those are separate native text nodes, and iOS
   *  rounds a selection up to the whole node — so dragging out one sentence, or
   *  one path, took the entire paragraph instead.
   *
   *  A run with nothing inherited is returned as a bare string, which leaves the
   *  paragraph holding flat text that can be dragged through. Bold, italic and
   *  links keep their own wrappers, so nothing loses its styling; a run that
   *  *does* carry inherited style — a heading, whose block rule is a `View` and
   *  passes its font down rather than applying it — keeps the `<Text>`, because
   *  dropping it there would drop the heading's type with it. */
  text: (node: any, _children: any, _parent: any, styles: any, inherited: any = {}) =>
    (inherited && Object.keys(inherited).length
      ? <Text key={node.key} style={[inherited, styles.text]}>{node.content}</Text>
      : node.content),
  /** The paragraph is the unit a person drags through, so it is the one
   *  `SelectableText` — on iOS a read-only text field, because a <Text> there
   *  only ever copies the whole of itself.
   *
   *  Except a paragraph with a link in it. A run with `onPress` does nothing
   *  inside a text field, and a link that cannot be pressed is worse than a
   *  paragraph that copies whole, so that one stays a <Text>. */
  textgroup: (node: any, children: any, _parent: any, styles: any) => (
    hasLink(node)
      ? <Text key={node.key} selectable style={styles.textgroup}>{children}</Text>
      : <SelectableText key={node.key} style={[styles.body, styles.textgroup, { alignSelf: 'stretch', flexGrow: 1, flexShrink: 1 }]}>{children}</SelectableText>
  ),
  code_inline: (node: any, _children: any, _parent: any, styles: any, inherited: any = {}) => (
    <Text key={node.key} selectable style={[inherited, styles.code_inline]}>{node.content}</Text>
  ),
  code_block: (node: any) => <CodeBlock key={node.key} lang="" code={trimEnd(node.content)} />,
  fence: (node: any) => <CodeBlock key={node.key} lang={String(node.sourceInfo || '').trim().split(/\s/)[0]} code={trimEnd(node.content)} />,
  list_item: (node: any, children: any, parent: any, styles: any, inherited: any = {}) => {
    // The nearest list is the one this item is in; an ordered list further
    // out must not number the bullets nested under one of its steps.
    const list = parent.find((p: any) => p.type === 'ordered_list' || p.type === 'bullet_list');
    const mark = list?.type === 'ordered_list' ? `${Number(list.attributes?.start ?? 1) + node.index}.` : '•';
    return (
      <View key={node.key} style={styles._VIEW_SAFE_list_item}>
        <Text style={[inherited, styles.bullet_list_icon]}>{mark}</Text>
        <View style={styles._VIEW_SAFE_bullet_list_content}>{children}</View>
      </View>
    );
  },
};

/** Markdown, rendered so that a message can grow a token at a time.
 *
 *  The library stamps every node it parses - the root view included - with a
 *  fresh `getUniqueID()`. React reads those as keys, so each render was an
 *  entirely new tree: every view in the message torn down and rebuilt. Free
 *  for a message that arrives finished, quadratic for one that streams. A long
 *  answer rebuilt hundreds of native views dozens of times a second and the
 *  chat stopped responding until it was left and re-entered, which is exactly
 *  what it took to make it flow again.
 *
 *  So the AST is built here and keyed by position in the tree: the paragraph
 *  that was there a token ago keeps its key, and React updates what changed
 *  instead of replacing all of it. The renderer and its stylesheet are built
 *  once per theme, for the same reason. */
// `linkify`: an answer hands over a bare URL far more often than a Markdown
// link, and a URL that cannot be pressed has been handed over half way.
const MD = MarkdownIt({ typographer: true, linkify: true });

/** The library's own style merge: defaults under ours, plus the `_VIEW_SAFE_`
 *  twin of each entry that the render rules reach for on container nodes. */
function buildStyles(custom: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(mdDefaults as any)) out[k] = { ...(mdDefaults as any)[k], ...StyleSheet.flatten(custom[k]) };
  for (const k of Object.keys(custom)) if (!out[k]) out[k] = { ...StyleSheet.flatten(custom[k]) };
  for (const k of Object.keys(out)) out['_VIEW_SAFE_' + k] = (removeTextStyleProps as any)(out[k]);
  return StyleSheet.create(out);
}

function mdStyles(c: Palette) {
  const sans = family(400, false);
  return {
    body: { color: c.text2, fontSize: 17, lineHeight: 24, fontFamily: sans },
    paragraph: { marginTop: 0, marginBottom: 9, flexWrap: 'wrap', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-start', width: '100%' },
    heading1: { color: c.ink, fontSize: 22, lineHeight: 28, fontFamily: family(600, false), marginBottom: 9 },
    heading2: { color: c.ink, fontSize: 19, lineHeight: 25, fontFamily: family(600, false), marginBottom: 9 },
    heading3: { color: c.ink, fontSize: 17, lineHeight: 22, fontFamily: family(600, false), marginBottom: 9 },
    heading4: { color: c.ink, fontSize: 17, lineHeight: 22, fontFamily: family(600, false), marginBottom: 9 },
    strong: { fontFamily: family(600, false), color: c.ink },
    em: { fontStyle: 'italic' },
    link: { color: c.ink, textDecorationLine: 'underline' },
    bullet_list: { marginBottom: 9, gap: 3 },
    ordered_list: { marginBottom: 9, gap: 3 },
    list_item: { flexDirection: 'row', justifyContent: 'flex-start', gap: 8 },
    bullet_list_icon: { color: c.faint, marginLeft: 0, marginRight: 0, lineHeight: 22.5 },
    bullet_list_content: { flex: 1 },
    ordered_list_icon: { color: c.faint },
    code_inline: { fontFamily: family(400, true), fontSize: 14, backgroundColor: c.fill, color: c.text2, borderRadius: 4, borderWidth: 0, paddingHorizontal: 4, paddingVertical: 1 },
    blockquote: { backgroundColor: 'transparent', borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingHorizontal: 10, marginLeft: 0, marginBottom: 9 },
    hr: { backgroundColor: c.line, height: 1, marginVertical: 6 },
    table: { borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: 'hidden', backgroundColor: c.card, marginBottom: 9 },
    thead: { backgroundColor: c.code },
    tr: { borderBottomWidth: 0, borderTopWidth: 1, borderColor: c.line, flexDirection: 'row' },
    th: { flex: 1, paddingVertical: 6, paddingHorizontal: 10, fontFamily: family(600, false), color: c.ink, fontSize: 13 },
    td: { flex: 1, paddingVertical: 6, paddingHorizontal: 10, fontSize: 13, color: c.ink },
  } as const;
}

const renderers = new Map<string, any>();
function rendererFor(c: Palette) {
  let r = renderers.get(c.scheme);
  if (!r) {
    r = new (AstRenderer as any)(
      { ...renderRules, ...rules },
      buildStyles(mdStyles(c) as any),
      undefined,   // onLinkPress - the library's default opener
      null,        // maxTopLevelChildren
      null,        // topLevelMaxExceededItem
      ['data:image/png;base64', 'data:image/gif;base64', 'data:image/jpeg;base64', 'https://', 'http://'],
      'https://',
      false,
    );
    renderers.set(c.scheme, r);
  }
  return r;
}

/** Where a node sits in the tree, not a counter. Two parses of almost the same
 *  text agree on almost every key, which is the whole point. */
function keyTree(nodes: any[], path: string): any[] {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    n.key = `${path}${i}${n.type}`;
    if (n.children?.length) keyTree(n.children, `${n.key}.`);
  }
  return nodes;
}

/** What the daemon leaves where a key was pasted (`daemon/remote_ai_chat/
 *  secrets.py`): the family, the keychain item and the command to read it. The
 *  agent needs that; the person reading needs only to see that a key was there
 *  and is safe, so the screen says `🔒 OpenAI key`. */
const SECRET = /\[secret ([a-z]+) rac-secret-[a-z]+-[0-9a-f]{8}( — not saved)?[^\]]*\]/g;
const SECRET_NAME: Record<string, string> = {
  openai: 'OpenAI key', anthropic: 'Anthropic key', github: 'GitHub token', aws: 'AWS key',
  google: 'Google key', stripe: 'Stripe key', resend: 'Resend key', posthog: 'PostHog key',
  sentry: 'Sentry token', slack: 'Slack token', telegram: 'Telegram bot token', jwt: 'token',
  pem: 'private key', secret: 'secret', password: 'password', apppassword: 'app password',
};
const secretLabel = (kind: string, unsaved?: string) =>
  `🔒 ${SECRET_NAME[kind] ?? kind}${unsaved ? ' (not saved)' : ''}`;

/** A user's own message, with each placeholder as a chip inside the text. */
function withSecrets(text: string, c: Palette): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SECRET)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<Text key={m.index} style={{ backgroundColor: c.fill, color: m[2] ? c.danger : c.text2, fontSize: 15 }}>
      {` ${secretLabel(m[1], m[2])} `}</Text>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderMarkdown(src: string, c: Palette) {
  // An answer that repeats a placeholder shows it the same way, as inline code.
  src = src.replace(SECRET, (_m, kind, unsaved) => `\`${secretLabel(kind, unsaved)}\``);
  let tokens = stringToTokens(src, MD as any);
  tokens = (cleanupTokens as any)(tokens);
  tokens = (groupTextTokens as any)(tokens);
  tokens = (omitListItemParagraph as any)(tokens);
  const ast = keyTree(tokensToAST(tokens) as any[], '');
  // `render()` keys the root with a fresh id too; pin it, or the one key that
  // matters most changes on every token.
  return rendererFor(c).renderNode({ type: 'body', key: 'md', children: ast }, [], true);
}

/** The agent names a file by writing its path into the message as a Markdown
 *  image or link; the daemon lifts it into `attachments` (see attachments.py).
 *  Once it is shown as a picture or a chip, the path in the text is noise —
 *  an image reference goes entirely, a link keeps its label. */
function stripLocalRefs(text: string, atts: Attachment[]): string {
  if (!atts.length) return text;
  const paths = new Set(atts.map((a) => a.path));
  const out = text.replace(/!?\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|((?:file:\/\/)?[^)\s]+))\s*\)/g, (m, label, angled, bare) => {
    const raw = (angled || bare || '').replace(/^file:\/\//, '');
    if (!paths.has(raw)) return m;
    return m.startsWith('!') ? '' : label;
  });
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function AssistantAttachments({ items }: { items: Attachment[] }) {
  const images = items.filter((a) => a.kind === 'image');
  const videos = items.filter((a) => a.kind === 'video');
  const voices = items.filter((a) => a.kind === 'audio');
  const files = items.filter((a) => !images.includes(a) && !videos.includes(a) && !voices.includes(a));
  return (
    <View style={{ alignItems: 'flex-start', gap: 6, marginBottom: 9 }}>
      {images.length > 0 && <ImageGroup items={images} align="left" />}
      {videos.map((v) => <VideoBubble key={v.path} item={v} />)}
      {voices.map((v) => <VoiceBubble key={v.path} item={v} sent />)}
      {files.map((f) => <FileChip key={f.path} item={f} openable />)}
    </View>
  );
}

export const AssistantText = React.memo(function AssistantText({ text, streaming, attachments }: { text: string; streaming?: boolean; attachments?: Attachment[] }) {
  const c = useColors();
  const atts = attachments ?? [];
  const body = stripLocalRefs(text, atts);
  return (
    <View style={{ maxWidth: '94%', marginBottom: -9 }}>
      {!!body && renderMarkdown(body + (streaming ? ' ▍' : ''), c)}
      {atts.length > 0 && <AssistantAttachments items={atts} />}
    </View>
  );
});

const HOME = /\/Users\/[^/\s'"]+|\/home\/[^/\s'"]+|C:\\Users\\[^\\\s'"]+/gi;

/** A home directory eats the half of a one-line summary that carried meaning,
 *  and the account name is nobody's business on a screen held up to a room.
 *  Display only — the command that runs is untouched. */
function tildeAll(text: string): string {
  return text.replace(HOME, '~');
}

/** `~/…/webhooks/handler.ts`: a path is identified by its tail. */
function shortPath(p: string): string {
  const t = tildeAll(p);
  const parts = t.split('/');
  return parts.length > 3 ? `${parts[0]}/…/${parts.slice(-2).join('/')}` : t;
}

/** A file inside the chat's own folder, named from there. */
function relPath(p: string, cwd?: string): string {
  const base = (cwd ?? '').replace(/[\/]+$/, '');
  if (base && p.startsWith(base + '/')) return p.slice(base.length + 1);
  return shortPath(p);
}

/** A flat object the way a person writes it: one pair a line, braces hugging. */
function compactJson(v: any): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return JSON.stringify(v, null, 1) ?? '';
  const pairs = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`);
  return pairs.length ? `{ ${pairs.join(',\n  ')} }` : '{}';
}

function toolSummary(tool: string, input: any): string {
  if (!input) return '';
  if (tool === 'Bash') return tildeAll(input.command || '');
  if (input.file_path || input.path) return shortPath(input.file_path || input.path);
  return tildeAll(input.pattern || input.url || input.query || input.description || input.prompt || '');
}

const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch', 'LS', 'Read']);

/** A finished run of tool calls, folded into one line until it is asked for.
 *  `Ran 5 commands` beats five cards between two sentences. */
export function ToolGroup({ items }: { items: { key: string; data: any; result?: any }[] }) {
  const T = useT();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const failed = items.filter((i) => i.result?.is_error).length;
  const allBash = items.every((i) => i.data.tool === 'Bash');
  const allSearch = items.every((i) => SEARCH_TOOLS.has(i.data.tool));
  const label = allBash ? T('ranCommands', { n: items.length }) : allSearch ? T('ranSearches', { n: items.length }) : T('ranTools', { n: items.length });
  return (
    <View style={{ gap: 12 }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}>
        <Icon name={allSearch && !allBash ? 'search' : 'terminal'} size={16} color={c.muted} />
        <Text style={{ fontSize: 13, color: c.muted }}>
          {label}{failed ? <Text style={{ color: c.danger }}> · {T(failed === 1 ? 'nError' : 'nErrors', { n: failed })}</Text> : null}
        </Text>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} color={c.muted} />
      </Pressable>
      {open && items.map((i) => <ToolCard key={i.key} id={i.data.id} tool={i.data.tool} input={i.data.input} result={i.result} />)}
    </View>
  );
}

function DiffLines({ input, pad = 12, max = 8 }: { input: any; pad?: number; max?: number }) {
  const c = useColors();
  const oldS = input?.old_string != null ? String(input.old_string) : null;
  const newS = input?.new_string != null ? String(input.new_string) : input?.content != null ? String(input.content) : null;
  if (oldS == null && newS == null) return null;
  const line = (t: string, sign: '−' | '+', i: number) => (
    <Text key={sign + i} mono
      style={{ fontSize: 11, lineHeight: 11 * 1.6, paddingHorizontal: pad,
               backgroundColor: sign === '−' ? c.dangerBg : c.okBg, color: sign === '−' ? c.danger : c.ok }}>
      {sign} {t}
    </Text>
  );
  return (
    <View>
      {oldS != null && oldS.split('\n').slice(0, max).map((t, i) => line(t, '−', i))}
      {newS != null && newS.split('\n').slice(0, max).map((t, i) => line(t, '+', i))}
    </View>
  );
}

const ERR_LINE = /fail|error|✕|✗|exception|traceback|denied/i;

export function ToolCard({ id, tool, input, result }: { id?: string; tool: string; input: any; result?: { output: string; is_error: boolean } }) {
  const T = useT();
  const c = useColors();
  const [open, setOpen] = useState(false);
  // What the agent this call started is doing. It used to say this in the
  // conversation itself, in its own voice, which read as the assistant
  // answering something nobody asked.
  const act = useStore((s) => (id ? s.agentActivity[id] : undefined));
  const summary = toolSummary(tool, input);
  const isEdit = (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') && (input?.old_string != null || input?.content != null);
  const pending = !result;
  const added = isEdit ? String(input.new_string ?? input.content ?? '').split('\n').length : 0;
  const removed = isEdit && input.old_string != null ? String(input.old_string).split('\n').length : 0;
  const output = result?.output || T('empty');
  return (
    <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 12, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12 }}>
        {pending ? <Spinner /> : <Icon name={result.is_error ? 'close' : 'check'} size={16} color={result.is_error ? c.danger : c.ok} />}
        <Text style={{ fontSize: 13, fontWeight: '600' }}>{tool}</Text>
        <Text mono numberOfLines={1} style={{ fontSize: 11.5, color: c.muted, flex: 1 }}>{summary}</Text>
        {isEdit && <Text mono style={{ fontSize: 11, color: c.ok }}>+{added}</Text>}
        {isEdit && removed > 0 && <Text mono style={{ fontSize: 11, color: c.danger }}>−{removed}</Text>}
        {!isEdit && !pending && <Icon name={open ? 'expand_less' : 'expand_more'} size={16} color={c.faint} />}
      </Pressable>
      {pending && act && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 7, paddingBottom: 8, paddingLeft: 32, paddingRight: 12 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink }} />
          <Text mono numberOfLines={1} style={{ fontSize: 11, color: c.muted, flex: 1 }}>{act.tool ? `${act.tool}  ` : ''}{act.text || ''}</Text>
          {act.tools > 0 && <Text mono style={{ fontSize: 11, color: c.faint }}>{T('nTools', { n: act.tools })}</Text>}
        </View>
      )}
      {isEdit && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.line }}>
          <DiffLines input={input} max={open ? 40 : 6} />
        </View>
      )}
      {isEdit && open && result?.is_error && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 8, paddingHorizontal: 12 }}>
          <Text mono selectable numberOfLines={12} style={{ fontSize: 11, lineHeight: 11 * 1.55, color: c.danger }}>{output.slice(0, 2000)}</Text>
        </View>
      )}
      {open && !isEdit && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 8, paddingHorizontal: 12, gap: 6 }}>
          <Text mono style={{ fontSize: 10, letterSpacing: em(10, 0.08), textTransform: 'uppercase', color: c.faint }}>{T('toolInput')}</Text>
          <View style={{ backgroundColor: c.code, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8 }}>
            <Text mono selectable numberOfLines={14} style={{ fontSize: 11, lineHeight: 11 * 1.55, color: c.text2 }}>
              {tildeAll(compactJson(input)).slice(0, 1500)}
            </Text>
          </View>
          {result && (
            <>
              <Text mono style={{ fontSize: 10, letterSpacing: em(10, 0.08), textTransform: 'uppercase', color: c.faint }}>{T('toolOutput')}</Text>
              <View style={{ backgroundColor: c.code, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 8 }}>
                <Text mono selectable numberOfLines={24} style={{ fontSize: 11, lineHeight: 11 * 1.55, color: c.text2 }}>
                  {output.slice(0, 4000).split('\n').map((l, i, all) => (
                    <Text key={i} style={result.is_error && ERR_LINE.test(l) ? { color: c.danger } : undefined}>{l}{i < all.length - 1 ? '\n' : ''}</Text>
                  ))}
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

export function ApprovalCard({ tool, input, preview, danger, decision, onDecide, cwd }: {
  tool: string; input?: any; preview: string; danger: boolean; decision: string | null; cwd?: string;
  onDecide: (d: 'allow' | 'allow_session' | 'deny', response?: ApprovalResponse) => void | Promise<void>;
}) {
  const T = useT();
  const c = useColors();
  const resolved = !!decision;
  const edit = tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit';
  const path = edit ? relPath(String(input?.file_path ?? input?.path ?? preview.replace(/^\S+\s/, '') ?? ''), cwd) : '';
  const decide = (d: 'allow' | 'allow_session' | 'deny') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onDecide(d);
  };

  if (resolved) {
    const outcome = decision === 'deny' ? { icon: 'block', text: T('denied'), color: c.danger }
      : decision === 'allow_session' ? { icon: 'verified', text: T('allowedSession'), color: c.ok }
      : decision === 'expired' ? { icon: 'block', text: T('expired'), color: c.faint }
      : { icon: 'check_circle', text: T('allowed'), color: c.ok };
    return (
      <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 12, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="lock" size={15} color={c.faint} />
          {edit && <Text mono style={{ fontSize: 11, fontWeight: '600', letterSpacing: em(11, 0.08), color: c.faint }}>{tool.toUpperCase()}</Text>}
          <View style={{ flex: 1 }} />
          <Text mono numberOfLines={1} style={{ fontSize: 11, color: c.muted, flexShrink: 1 }}>{edit ? path : tool}</Text>
        </View>
        {edit ? (
          <View style={{ borderRadius: 6, overflow: 'hidden', opacity: 0.7 }}><DiffLines input={input} pad={8} max={6} /></View>
        ) : (
          <Text mono numberOfLines={3} style={{ fontSize: 12, color: c.muted }}>{tildeAll(preview)}</Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={outcome.icon} size={16} color={outcome.color} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: outcome.color }}>{outcome.text}</Text>
        </View>
      </View>
    );
  }

  if (structuredInput(input)) return <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.lineStrong, borderRadius: 14, padding: 12, gap: 10 }}>
    <Text>{tool}</Text><ApprovalForm input={input} onDecide={onDecide} />
  </View>;

  const tone = danger ? c.danger : c.accentText;
  return (
    <View style={{ backgroundColor: c.card, borderWidth: danger ? 1.5 : 1, borderColor: danger ? c.danger : c.lineStrong, borderRadius: 14,
                   padding: 12, gap: 10, boxShadow: c.shadow.raised }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={danger ? 'warning' : 'lock'} size={danger ? 16 : 15} color={tone} />
        <Text mono style={{ fontSize: 11, fontWeight: '600', letterSpacing: em(11, 0.08), color: tone }}>{danger ? T('danger') : T('pending')}</Text>
        <View style={{ flex: 1 }} />
        <Text mono numberOfLines={1} style={{ fontSize: 11, color: c.muted, flexShrink: 1 }}>{tool}</Text>
      </View>
      <View style={[{ borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10 },
        danger ? { backgroundColor: c.dangerBg } : { backgroundColor: c.code, borderWidth: 1, borderColor: c.line }]}>
        <Text mono selectable style={{ fontSize: 12.5, lineHeight: 12.5 * 1.5, color: c.ink }}>{edit ? path : tildeAll(preview)}</Text>
        {edit && <View style={{ marginTop: 8, marginHorizontal: -10, borderRadius: 6, overflow: 'hidden' }}><DiffLines input={input} pad={10} max={8} /></View>}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={() => decide('deny')} style={({ pressed }) => [{ flex: 1, alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.lineStrong }, pressed && { backgroundColor: c.fill }]}>
          <Text style={{ fontSize: 14, fontWeight: '600' }}>{T('deny')}</Text>
        </Pressable>
        <Pressable onPress={() => decide('allow')} style={({ pressed }) => [{ flex: 1, alignItems: 'center', padding: 10, borderRadius: 10, backgroundColor: c.accent }, pressed && { opacity: 0.8 }]}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#FFFFFF' }}>{T('allow')}</Text>
        </Pressable>
      </View>
      {!danger && (
        <Pressable onPress={() => decide('allow_session')} hitSlop={6} style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: c.muted, textDecorationLine: 'underline' }}>{T('allowSession', { tool })}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function TurnFooter({ cost, duration, error, usage, stopReason }: { cost?: number | null; duration?: number | null; error?: string; usage?: any; stopReason?: string | null }) {
  const T = useT();
  const c = useColors();
  if (error) return <Text style={{ fontSize: 13, lineHeight: 19, color: c.danger }}>{T('errorPrefix')}{error}</Text>;
  const parts = [];
  if (stopReason === 'interrupted') parts.push(T('stopped'));
  if (cost != null) parts.push(`$${cost.toFixed(3)}`);
  const tok = usage?.output_tokens ?? usage?.total_tokens;
  if (cost == null && tok) parts.push(`${tok >= 1000 ? (tok / 1000).toFixed(1) + 'k' : tok} tok`);
  if (duration != null) parts.push(`${Math.round(duration / 1000)}s`);
  if (!parts.length) return null;
  return <Text mono style={{ fontSize: 11, color: c.faint }}>{parts.join(' · ')}</Text>;
}

/** The pool moved this chat onto another sign-in, mid-answer or between turns.
 *
 *  Worth a line of its own rather than a footnote: the session that answers
 *  after it is not the session that answered before, and it was handed a
 *  summary of the chat rather than the chat. When there was nowhere to move
 *  to, the same line says that instead — the turn is about to run into a real
 *  limit and the reader should not have to guess why. */
export function SwitchNote({ to, until, label, from, window: win }: { to?: string | null; until?: number | null; label?: string; from?: string; window?: string }) {
  const T = useT();
  const c = useColors();
  const back = until ? new Date(until * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line, paddingVertical: 7 }}>
      <Icon name="swap_horiz" size={16} color={c.muted} />
      <Text style={{ fontSize: 12, color: c.muted, flex: 1, lineHeight: 17 }}>
        {to ? (
          <>
            {T('poolMovedTo')}<Text style={{ color: c.ink, fontWeight: '600' }}>{label || to}</Text>
            {from ? `: ${T('poolReached', { from, window: win || T('limPlan') })}` : ''}
          </>
        ) : back ? T('poolExhaustedUntil', { time: back }) : T('poolExhausted')}
      </Text>
    </View>
  );
}

/** One quiet line while a turn runs: a dot with a halo, then elapsed · tokens ·
 *  open tools · what it is doing. */
export function WorkingRow({ phase, since, tokens, tools, hint }: {
  phase: string; since: number; tokens?: number; tools?: number; hint?: string;
}) {
  const T = useT();
  const c = useColors();
  // The clock ticks here, in the one row that shows it: ticking the screen
  // would redraw every message in the chat once a second.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = (now - since) / 1000;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [pulse]);
  const secs = Math.max(0, Math.floor(seconds));
  const time = `${Math.floor(secs / 60)}${T('unitMin')} ${String(secs % 60).padStart(2, '0')}${T('unitSec')}`;
  const parts = [time];
  if (tokens) parts.push(`${tokens >= 1000 ? (tokens / 1000).toFixed(1) + T('unitK') : tokens} ${T('unitTok')}`);
  if (tools) parts.push(`${tools} ${T('unitTool')}`);
  parts.push(phase);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center', marginHorizontal: -4 }}>
          <Animated.View style={{ position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: c.halo,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }} />
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.ink }} />
        </View>
        <Text mono numberOfLines={1} style={{ fontSize: 12, color: c.text2, flexShrink: 1 }}>{parts.join(' · ')}</Text>
      </View>
      {!!hint && (
        <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 13 * 1.45, color: c.faint, paddingLeft: 16 }}>{hint}</Text>
      )}
    </View>
  );
}

/** What the model is thinking, while it thinks: the tail of it, three lines. */
export function ThinkingRow({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 4 }}><Spinner /></View>
      <Text numberOfLines={3} style={{ flex: 1, fontSize: 13, lineHeight: 13 * 1.45, color: c.muted, fontStyle: 'italic' }}>…{text}</Text>
    </View>
  );
}

/** Thin band under the header while the socket is down. */
export function ConnectionBanner({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.warnBg, padding: 6 }}>
      {/* The ring sits on the band's own amber wash, so its unfilled part is
          the emphasised line — which is what that token is for. */}
      <Spinner size={11} color={c.warn} track={c.lineStrong} />
      <Text style={{ fontSize: 12, fontWeight: '500', color: c.warn }}>{text}</Text>
    </View>
  );
}

/** A transcript still on its way: bubbles and lines in the shape of a chat. */
export function TranscriptSkeleton() {
  const c = useColors();
  const Bar = ({ w }: { w: `${number}%` }) => <View style={{ height: 11, width: w, borderRadius: 4, backgroundColor: c.line }} />;
  return (
    <View accessibilityLabel="loading" style={{ gap: 14, paddingBottom: 4 }}>
      <View style={{ alignSelf: 'flex-end', width: '62%', height: 44, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: c.line }} />
      <View style={{ gap: 7 }}><Bar w="92%" /><Bar w="80%" /><Bar w="55%" /></View>
      <View style={{ height: 38, width: '100%', borderRadius: 12, backgroundColor: c.fill }} />
      <View style={{ alignSelf: 'flex-end', width: '48%', height: 44, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: c.line }} />
      <View style={{ gap: 7 }}><Bar w="88%" /><Bar w="66%" /></View>
    </View>
  );
}


/** The thin rule a conversation is filed under (HANDOVER §4.8): Hermes files it,
 *  the view only says where. */
export function FiledRule({ project }: { project: string }) {
  const c = useColors();
  const T = useT();
  return (
    <View accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      <Text mono style={{ fontSize: 11.5, color: c.muted }}>{T('chFiled', { project })}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
    </View>
  );
}

/** A card this conversation filed, as the small link under the message: its
 *  column and its title, and a press opens it. */
export function CardLink({ column, title, onPress }: { column: string; title: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${column}: ${title}`} onPress={onPress}
      style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10,
                                 paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1,
                                 borderColor: c.line, backgroundColor: c.card, opacity: pressed ? 0.6 : 1, maxWidth: '88%' })}>
      <Text mono style={{ fontSize: 11.5, color: c.muted }}>{column}</Text>
      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '500', color: c.ink, flexShrink: 1 }}>{title}</Text>
      <Icon name="chevron_right" size={16} color={c.muted} />
    </Pressable>
  );
}
