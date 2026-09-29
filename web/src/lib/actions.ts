import { hostKey, useFleet } from './fleet';
import type { Chat, DivanCard, DivanCardGet, HostConfig, Provider } from './protocol';

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

/** An answer to a ticket in one computer's queue. The queue re-opens a stopped
 *  ticket the moment a note lands, which is why this is the whole of answering a
 *  question a worker asked: nothing else has to be moved or restarted. */
export const ticketNote = (key: string, id: number, text: string) =>
  call<{ message?: string }>(key, 'ustabasi.note', { id, text });

/** Move a card into a column of the board, at the bottom of it.
 *
 *  The move has happened by the time this answers, whatever `error` says: a
 *  card landing in In Progress with a coding agent on it is also what files it
 *  with that computer's queue, and a queue that is not installed or that
 *  refuses leaves the card where it was put and says why. The board never
 *  springs back under a cursor, so a screen reports the line and keeps the
 *  card. */
export const moveCard = (key: string, cardId: string, column: string) =>
  call<{ card: DivanCard; error: string | null }>(key, 'divan.card.move',
    { card_id: cardId, column });

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
  return `http://${cfg.host}:${cfg.port}`;
}

/** Uploads go over plain HTTP, not the socket: the daemon shrinks images and
 *  transcribes audio on the way in, and hands back the path to attach. */
export async function upload(key: string, chatId: string, file: File): Promise<any> {
  const { cfg } = slot(key);
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
    if (r.status === 401) throw new Error('No access to that computer');
    throw new Error(`Upload failed (${r.status})`);
  }
  return r.json();
}

/** An uploaded file read back for a bubble. The token is a query parameter
 *  because an <img> tag cannot carry a header. `download` asks the daemon for
 *  a Content-Disposition — the <a download> attribute is ignored when the file
 *  comes from another computer, and every computer but this one is another. */
export function fileUrl(key: string, path: string, download = false): string {
  const { cfg } = slot(key);
  const q = new URLSearchParams({ path, token: cfg.token });
  if (download) q.set('download', '1');
  return `${base(cfg)}/files?${q}`;
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
