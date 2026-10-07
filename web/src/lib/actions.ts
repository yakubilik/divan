import { hostKey, useFleet } from './fleet';
import { httpBase } from './ws';
import { noteRefusal, refusedFor, refusalText } from './refusal';
import type {
  Chat, DaemonStatus, DivanCard, DivanCardGet, DivanExecutor, DivanOpenItem, HostConfig,
  PoolView,
  Provider, RunPage,
} from './protocol';

function slot(key: string) {
  const s = useFleet.getState().hosts[key];
  if (!s) throw new Error('No such computer');
  return s;
}

function call<T = any>(key: string, type: string, data: Record<string, any> = {}): Promise<T> {
  return useFleet.getState().call<T>(key, type, data);
}

export const send = (key: string, chatId: string, text: string, attachments: any[] = []) =>
  call<{ accepted: boolean; queued: boolean }>(key, 'chat.send', {
    chat_id: chatId, text, ...(attachments.length ? { attachments } : {}),
  });

/** What the agent on a ticket has printed, a page at a time.
 *
 *  The run's stream-json is hundreds of kilobytes by the time a worker is
 *  done, so the daemon hands out the end of it and then whatever has been
 *  appended since, keeping the place in a cursor. The phone asks the same
 *  question of the same handler (`app/src/store.ts`, `readRun`). */
export const readRun = (key: string, id: number, cursor: string | null) =>
  call<RunPage>(key, 'ustabasi.run', { id, ...(cursor ? { cursor } : {}) });

/** An answer to a ticket in one computer's queue. The queue re-opens a stopped
 *  ticket the moment a note lands, which is why this is the whole of answering a
 *  question a worker asked: nothing else has to be moved or restarted. */
export const ticketNote = (key: string, id: number, text: string) =>
  call<{ message?: string }>(key, 'ustabasi.note', { id, text });

/** Stop a ticket, wherever it had got to. A running one is killed with its
 *  process group; the queue's own CLI owns what that means. */
export const cancelTicket = (key: string, id: number) =>
  call<{ message?: string }>(key, 'ustabasi.cancel', { id });

/** …and put a stopped or finished one back in the queue. */
export const restartTicket = (key: string, id: number) =>
  call<{ message?: string }>(key, 'ustabasi.restart', { id });

/** Which one the supervisor takes next. */
export const prioritiseTicket = (key: string, id: number, priority = 1) =>
  call<{ message?: string }>(key, 'ustabasi.priority', { id, priority });

/** Rewrite what a ticket asks for. Refused by the queue while a worker holds
 *  the card — a brief that changed under somebody is a brief nobody agreed
 *  to. */
export const editTicket = (key: string, id: number, card: {
  title?: string; goal?: string; done_criteria?: string[]; verify_cmd?: string;
}) => call<{ message?: string }>(key, 'ustabasi.edit', { id, ...card });

/** Take a ticket off the queue for good. A branch with work nobody merged is
 *  kept unless `force`, and the queue says which it did. */
export const deleteTicket = (key: string, id: number, force = false) =>
  call<{ message?: string }>(key, 'ustabasi.delete', { id, force });

/** Move a card into a column of the board: at the bottom of it, or at
 *  `position` — an index in that column once the card has left it, which is
 *  how Queued is put in order of priority.
 *
 *  The move has happened by the time this answers, whatever `error` says: a
 *  card landing in In Progress with a coding agent on it is also what files it
 *  with that computer's queue, and a queue that is not installed or that
 *  refuses leaves the card where it was put and says why. The board never
 *  springs back under a cursor, so a screen reports the line and keeps the
 *  card. */
export const moveCard = (key: string, cardId: string, column: string, position?: number) =>
  call<{ card: DivanCard; error: string | null }>(key, 'divan.card.move',
    { card_id: cardId, column, ...(position != null ? { position } : {}) });

/** One card with **both faces**, and the live half where a ticket was filed for
 *  it. The board's cards carry the human face only — this is the one request
 *  that has the brief as well, which is what keeps agent text off a card
 *  everywhere else. */
export const cardGet = (key: string, cardId: string) =>
  call<DivanCardGet>(key, 'divan.card.get', { card_id: cardId });

/** A card written down in one go: a title, the sentences under it, and the
 *  column it lands in. Everything else is the daemon's default — `ice_box`,
 *  `engineering`, this computer, the product's first repository — because a card
 *  written mid-thought is a line and not a form. The executor and the brief are
 *  filled in later or never. */
export const createCard = (key: string, data: {
  project_id: string; title: string; summary?: string; branch?: string; column?: string;
}) => call<DivanCard>(key, 'divan.card.create', data);

/** A card's faces, rewritten. Only what is sent is touched, and nothing the
 *  mirror owns can be written from here — the column has `moveCard`, the
 *  executor has `setExecutor`, and a field writable from two places is how a
 *  status update ends up dragging a card. */
export const updateCard = (key: string, cardId: string, fields: {
  title?: string; summary?: string; repo?: string; machine?: string;
  agent?: Record<string, any>;
}) => call<DivanCard>(key, 'divan.card.update', { card_id: cardId, ...fields });

/** Who does this one, or nobody. Clearing is a value rather than an omission:
 *  a card whose agent was the wrong guess goes back to having none, not to
 *  having a person on it. */
export const setExecutor = (
  key: string, cardId: string, executor: DivanExecutor | null, machine?: string | null,
) => call<DivanCard>(key, 'divan.card.executor',
  { card_id: cardId, executor, ...(machine ? { machine } : {}) });

/** What a product is still waiting on. Every one of these answers with the
 *  whole list in the board's own order, so nothing here has to work out what a
 *  change did to it — the caller replaces what it holds. */
export const openItems = (key: string, projectId: string, d: Record<string, any> = {}) =>
  call<{ project_id: string; open_items: DivanOpenItem[] }>(
    key, 'divan.project.open', { project_id: projectId, ...d });

export const addOpenItem = (key: string, projectId: string, add: {
  title: string; body?: string; state?: string; owner?: string; area?: string;
}) => openItems(key, projectId, { add });

export const setOpenItem = (
  key: string, projectId: string, itemId: string, set: Record<string, any>,
) => openItems(key, projectId, { item_id: itemId, set });

/** `who` is passed rather than guessed: a line from Yakup is a decision and a
 *  line from the assistant is a finding, and the card says which it is. */
export const commentOpenItem = (
  key: string, projectId: string, itemId: string, comment: string, who = 'you',
) => openItems(key, projectId, { item_id: itemId, comment, who });

export const removeOpenItem = (key: string, projectId: string, itemId: string) =>
  openItems(key, projectId, { item_id: itemId, remove: true });

export const interrupt = (key: string, chatId: string) =>
  call(key, 'chat.interrupt', { chat_id: chatId });

export const respond = (
  key: string, chatId: string, requestId: string,
  decision: 'allow' | 'allow_session' | 'deny',
) => call(key, 'approval.respond', { chat_id: chatId, request_id: requestId, decision });

export const createChat = (key: string, data: {
  provider: Provider; model?: string; effort?: string | null; perm_mode?: string;
  cwd?: string; group_id?: string | null; title?: string;
  max_turns?: number | null; max_budget_usd?: number | null;
  account_id?: string | null; agent_id?: string | null;
}) => call<Chat>(key, 'chat.create', data);

export const updateChat = (key: string, chatId: string, patch: Record<string, any>) =>
  call<Chat>(key, 'chat.update', { chat_id: chatId, ...patch });

export const deleteChat = (key: string, chatId: string) =>
  call(key, 'chat.delete', { chat_id: chatId });

/** Install (or reinstall) a tool's CLI on that computer. The daemon streams
 *  what the installer prints as `tool.install.output` events while it runs, and
 *  answers with the version it ended on — `already: true` where the CLI was
 *  there all along and nobody asked for it again. */
export const installTool = (key: string, provider: Provider, force = false) =>
  call<{ provider: string; version: string | null; already?: boolean; ok?: boolean }>(
    key, 'tool.install', { provider, ...(force ? { force: true } : {}) });

/** The account pool: what it is set to, and where every sign-in stands under
 *  it. The pool is what moves a chat onto another sign-in when the one it is on
 *  runs out, so this is the one place where "what happens at the limit" is a
 *  setting rather than a surprise. */
export const poolGet = (key: string, provider?: Provider) =>
  call<PoolView>(key, 'pool.get', provider ? { provider } : {});

export const poolSet = (key: string, patch: Record<string, any>) =>
  call<PoolView>(key, 'pool.set', patch);

/** What a restart would cost right now, asked before anybody presses it rather
 *  than reported after. */
export const daemonStatus = (key: string) => call<DaemonStatus>(key, 'daemon.status', {});

/** Unpair this browser from that computer — the token this panel holds stops
 *  working, and nothing else's does. */
export const revokeSelf = (key: string) => call<{ ok: boolean }>(key, 'device.revoke_self', {});

export const createGroup = (key: string, name: string) => call(key, 'group.create', { name });
export const renameGroup = (key: string, group_id: string, name: string) =>
  call(key, 'group.rename', { group_id, name });
export const deleteGroup = (key: string, group_id: string) =>
  call(key, 'group.delete', { group_id });

export const listAgents = (key: string, account_id?: string | null, cwd?: string) =>
  call(key, 'agent.list', { ...(account_id ? { account_id } : {}), ...(cwd ? { cwd } : {}) });
export const agentStore = (key: string) => call(key, 'agent.store', {});
export const installAgent = (key: string, id: string, account_id?: string | null) =>
  call(key, 'agent.install', { id, ...(account_id ? { account_id } : {}) });
export const removeAgent = (key: string, name: string, account_id?: string | null) =>
  call(key, 'agent.remove', { name, ...(account_id ? { account_id } : {}) });

export const toolStatus = (key: string) => call(key, 'tool.status', {});

function base(cfg: HostConfig): string {
  return httpBase(cfg.host, cfg.port);
}

/** Refuse locally what the computer has already refused: a token it said no to
 *  is not sent again from this tab (lib/refusal.ts). */
function stillWelcome(cfg: HostConfig): void {
  const r = refusedFor(cfg.token);
  if (r) throw new Error(refusalText(r).long);
}

/** Uploads go over plain HTTP, not the socket: the daemon shrinks images and
 *  transcribes audio on the way in, and hands back the path to attach. */
export async function upload(key: string, chatId: string, file: File): Promise<any> {
  const { cfg } = slot(key);
  stillWelcome(cfg);
  const body = new FormData();
  body.append('file', file);
  body.append('chat_id', chatId);
  const r = await fetch(`${base(cfg)}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}` },
    body,
  });
  if (!r.ok) {
    if (r.status === 413) throw new Error('File is too large (100 MB max)');
    if (r.status === 415) throw new Error('That file type is not supported');
    if (r.status === 401) throw new Error(refusalText(await noteRefusal(cfg.token, r)).long);
    throw new Error(`Upload failed (${r.status})`);
  }
  return r.json();
}

/** Dictation: one phrase of speech up, its words back.
 *
 *  Not an upload: nothing is kept and nothing is attached. What goes up is the
 *  audio whisper wants — 16 kHz mono signed 16-bit PCM, made in the panel
 *  (`lib/dictate.ts`) — and what comes back is the words. The vocabulary and
 *  the language ride in the query rather than in the body, because the body is
 *  the audio, and not in headers of their own, because a chat on another
 *  paired computer is another origin and the daemon's CORS answer names only
 *  the two headers below.
 */
export async function dictate(key: string, pcm: Int16Array, prompt: string, lang: string,
                              context = ''): Promise<string> {
  const { cfg } = slot(key);
  stillWelcome(cfg);
  const q = new URLSearchParams({ lang, ...(prompt ? { prompt } : {}), ...(context ? { context } : {}) });
  const r = await fetch(`${base(cfg)}/dictate?${q}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
  });
  if (!r.ok) {
    if (r.status === 503) throw new Error('That computer has no transcriber installed.');
    if (r.status === 413) throw new Error('That is more than ten minutes of audio.');
    if (r.status === 401) throw new Error(refusalText(await noteRefusal(cfg.token, r)).long);
    throw new Error(`Dictation failed (${r.status})`);
  }
  return String((await r.json()).text ?? '');
}

/** Load the model while the microphone is still opening. Fire and forget: a
 *  computer that will not warm up will say so when the audio arrives. */
export function warmDictation(key: string): void {
  let cfg: HostConfig;
  try { cfg = slot(key).cfg; } catch { return; }
  if (refusedFor(cfg.token)) return;
  void fetch(`${base(cfg)}/dictate/warm`, {
    method: 'POST', headers: { Authorization: `Bearer ${cfg.token}` },
  }).catch(() => { /* it is a courtesy, not a step */ });
}

/** An uploaded file read back for a bubble. The token is a query parameter
 *  because an <img> tag cannot carry a header. `download` asks the daemon for
 *  a Content-Disposition — the <a download> attribute is ignored when the file
 *  comes from another computer, and every computer but this one is another. */
export function fileUrl(key: string, path: string, download = false): string {
  const { cfg } = slot(key);
  // An empty source draws nothing and asks nothing, which is right for a
  // computer that has refused this token.
  if (refusedFor(cfg.token)) return '';
  const q = new URLSearchParams({ path, token: cfg.token });
  if (download) q.set('download', '1');
  return `${base(cfg)}/files?${q}`;
}

/** One frame of a computer's screen, or '' once it has refused this token.
 *  The token rides in the query for the reason `fileUrl`'s does. */
export function screenUrl(cfg: HostConfig, w: number, display: string, tick: number): string {
  if (refusedFor(cfg.token)) return '';
  return `${base(cfg)}/screen.jpg?token=${encodeURIComponent(cfg.token)}&w=${w}&q=72`
    + `&display=${encodeURIComponent(display)}&t=${tick}`;
}

/** Pair this panel with another computer from a link the `pair` command printed
 *  — the same `remoteaichat://pair?…` the phone scans. */
export function parsePairing(input: string): HostConfig | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    if (j && j.host && j.port && j.token) {
      return { host: String(j.host), port: Number(j.port), token: String(j.token),
               name: String(j.name ?? j.host), device_id: j.device_id };
    }
  } catch { /* not the QR payload; try the link form */ }
  try {
    const u = new URL(text.replace(/^remoteaichat:\/\//, 'https://rac/'));
    const q = u.searchParams;
    const token = q.get('token');
    const host = q.get('host');
    if (!token || !host) return null;
    return {
      host, port: Number(q.get('port') || 8790), token,
      name: q.get('name') || host, device_id: q.get('device_id') || undefined,
    };
  } catch { return null; }
}

export { hostKey };
