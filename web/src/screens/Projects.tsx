/** Folders: what is on one computer's disk that an agent may be pointed at.
 *
 *  One level under Machines, and no frame of its own — Web15's drawer has eight
 *  rows and this is not one of them. So it is built out of the shape those
 *  frames do draw for a list of things about a computer: W12's table, the page
 *  head above it, and one card of controls between the two. A folder is a row:
 *  what it is called and where it is, what git says about it, the last commit,
 *  how many chats are open in it, and the one button worth having at the end.
 *
 *  The git column is the only part of the row that can be missing. `host.git`
 *  is a call a daemon that has not been restarted does not have; when it
 *  answers with an error the column says so once under the table rather than
 *  putting a dash in every row.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { T, STATE_MARK } from '../lib/theme';
import { P, mono } from '../ui/kit';
import { ago, tilde } from '../lib/format';
import { useFleet } from '../lib/fleet';
import type { Chat } from '../lib/protocol';
import {
  Button, Card, Cell, Choice, EmptyState, NameCell, Note, SectionHeader, Table, Well, Write,
  type Column,
} from '../ui/divan';

export interface ProjectsProps {
  onNewChatIn: (cwd: string) => void;
  onOpenChat: (hostKey: string, chatId: string) => void;
}

/** What `host.git` reports per folder. Every field is optional on purpose: a
 *  daemon that predates the call answers with an error and the rows simply do
 *  without, rather than showing a placeholder that means nothing. */
interface GitInfo {
  is_git?: boolean;
  branch?: string | null;
  dirty?: number;
  staged?: number;
  untracked?: number;
  subject?: string | null;
  author?: string | null;
  committed_at?: number | null;
}

const SORTS = [
  { key: 'touched', label: 'Last changed' },
  { key: 'name', label: 'Name' },
  { key: 'chats', label: 'Open chats' },
] as const;
type Sort = typeof SORTS[number]['key'];

interface Row {
  path: string;
  name: string;
  isGit: boolean;
  git: GitInfo | null;
  chats: Chat[];
  running: number;
  awaiting: number;
  touched: number;
}

/** W12's tracks, with the two columns this page has that a machine does not. */
const COLUMNS: Column[] = [
  { width: '34px' },
  { label: 'folder', width: 'minmax(0, 1.3fr)' },
  { label: 'git', width: 'minmax(0, 1fr)' },
  { label: 'last commit', width: 'minmax(0, 1.2fr)' },
  { label: 'chats', width: '110px' },
  { width: '150px' },
];

/** The one line of git a row can carry. Counts come straight from
 *  `git status --porcelain`: `dirty` is every changed file, `staged` the ones
 *  already in the index, `untracked` the ones git has never seen. */
function gitCell(row: Row): React.ReactNode {
  if (!row.git?.is_git) {
    return <Cell text={row.isGit ? 'a git repository' : 'not under git'} tone="ink3" />;
  }
  const dirty = row.git.dirty ?? 0;
  const staged = row.git.staged ?? 0;
  const untracked = row.git.untracked ?? 0;
  return (
    <>
      <Cell text={row.git.branch || 'HEAD'} style={{ color: T.ink2 }} />
      {staged > 0 && <Cell text={`+${staged}`} tone="run" />}
      {untracked > 0 && <Cell text={`?${untracked}`} tone="ink3" />}
      <Cell text={dirty ? `${dirty} changed` : 'clean'} tone={dirty ? 'ink2' : 'ink3'} />
    </>
  );
}

export function Projects({ onNewChatIn, onOpenChat }: ProjectsProps) {
  const focus = useFleet((s) => s.focus);
  const slot = useFleet((s) => (s.focus ? s.hosts[s.focus] : null));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('touched');
  const [repos, setRepos] = useState<Record<string, GitInfo>>({});
  const [gitOff, setGitOff] = useState(false);

  const projects = slot?.projects ?? [];
  const chats = slot?.chats ?? [];

  // Asked once, when the screen first has a folder list to ask about. The call
  // is new; a daemon that has not been restarted answers `unknown_method` and
  // the table just runs without a git column.
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || !projects.length) return;
    const stamp = `${focus}:${projects.length}`;
    if (asked.current === stamp) return;
    asked.current = stamp;
    let alive = true;
    setRepos({});
    setGitOff(false);
    useFleet.getState()
      .call<{ repos?: Record<string, GitInfo> }>(focus, 'host.git', {
        paths: projects.map((p) => p.path),
      })
      .then((r) => { if (alive) setRepos(r?.repos ?? {}); })
      .catch(() => { if (alive) setGitOff(true); });
    return () => { alive = false; };
  }, [focus, projects.length]);

  const rows = useMemo<Row[]>(() => {
    const byCwd = new Map<string, Chat[]>();
    for (const c of chats) {
      if (c.archived || !c.cwd) continue;
      const arr = byCwd.get(c.cwd) ?? [];
      arr.push(c);
      byCwd.set(c.cwd, arr);
    }
    const out = projects.map((p) => {
      const open = (byCwd.get(p.path) ?? []).sort((a, b) => {
        const rank = (c: Chat) => (c.status === 'awaiting_approval' ? 0 : c.status === 'running' ? 1 : 2);
        return rank(a) - rank(b) || b.updated_at - a.updated_at;
      });
      const git = repos[p.path] ?? null;
      return {
        path: p.path,
        name: p.name,
        isGit: p.is_git,
        git,
        chats: open,
        running: open.filter((c) => c.status === 'running').length,
        awaiting: open.filter((c) => c.status === 'awaiting_approval').length,
        touched: Math.max(git?.committed_at ?? 0, open[0]?.updated_at ?? 0),
      };
    });
    const q = query.trim().toLocaleLowerCase('tr');
    const hit = q
      ? out.filter((r) => r.name.toLocaleLowerCase('tr').includes(q)
        || r.path.toLocaleLowerCase('tr').includes(q))
      : out;
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name, 'tr');
    if (sort === 'name') return [...hit].sort(byName);
    if (sort === 'chats') {
      return [...hit].sort((a, b) =>
        b.chats.length - a.chats.length || b.touched - a.touched || byName(a, b));
    }
    return [...hit].sort((a, b) => b.touched - a.touched || byName(a, b));
  }, [projects, chats, repos, query, sort]);

  const roots = slot?.info?.roots ?? [];
  const gotGit = Object.keys(repos).length > 0;
  const gitMissing = (gitOff || (!gotGit && projects.some((p) => p.is_git)))
    && projects.length > 0;

  if (!slot) {
    return (
      <EmptyState
        title="No computer is chosen."
        body="Folders are one computer's own: the directories under its allowed roots that an
              agent can be pointed at. Pick a computer under Machines and its folders appear
              here."
      />
    );
  }

  return (
    <>
      <SectionHeader
        kind="page" title="Folders"
        note={roots.map((r) => tilde(r)).join(' · ') || (slot.info?.name ?? '')}
        right={rows.length === projects.length
          ? `${projects.length} folder${projects.length === 1 ? '' : 's'}`
          : `${rows.length} of ${projects.length}`}
      />

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Well icon={P.search} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
          <Write
            value={query} onChange={setQuery} label="Search folders"
            placeholder="Search the folder list…"
          />
        </span>
        <Choice label="Order" value={sort} onChange={setSort}
          options={SORTS.map((s) => ({ key: s.key, label: s.label }))} />
      </Card>

      <Table
        columns={COLUMNS}
        rows={rows.map((r) => {
          const state = r.awaiting ? 'asking' : r.running ? 'running' : 'quiet';
          const newest = r.chats[0] ?? null;
          return {
            key: r.path,
            tone: r.awaiting ? ('amber' as const) : undefined,
            wash: r.awaiting > 0,
            title: r.path,
            cells: [
              <Well mark={(r.name.trim()[0] ?? '?').toUpperCase()} />,
              <NameCell title={r.name} note={tilde(r.path)} />,
              gitCell(r),
              r.git?.subject
                ? <NameCell title={<span style={{ fontWeight: 400, fontSize: 13 }}>{r.git.subject}</span>}
                    note={[ago(r.git.committed_at), r.git.author].filter(Boolean).join(' · ')} />
                : <Cell text="nothing committed" tone="ink3" />,
              <Cell
                text={r.chats.length
                  ? `${STATE_MARK[state]} ${r.chats.length} open`
                  : 'none open'}
                tone={r.awaiting ? 'amber' : r.running ? 'run' : 'ink3'}
              />,
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {newest && (
                  <Button small face="outline" label="Open"
                    title={newest.title || 'the newest chat in this folder'}
                    onClick={() => focus && onOpenChat(focus, newest.id)} />
                )}
                <Button small face={newest ? 'outline' : 'ink'} label="New"
                  title={`Start a chat in ${r.name}`}
                  onClick={() => onNewChatIn(r.path)} />
              </span>,
            ],
          };
        })}
        empty={projects.length
          ? 'No folder matches what is in the box above.'
          : 'Nothing shows up under this computer’s allowed roots.'}
      />

      {gitMissing && (
        <Note
          tone="ink3" icon={P.branch} title="No git information came from this computer"
          body="Restart the daemon and the branch, the changed-file count and the last commit
                appear in the two middle columns."
        />
      )}

      <div style={{ ...mono, fontSize: 12.5, color: T.ink3 }}>
        every folder here is on {slot.info?.name || slot.cfg.name} · the panel reads them and
        never holds one
      </div>
    </>
  );
}
