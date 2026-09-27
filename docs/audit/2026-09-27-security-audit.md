# Pre-publication audit — 27 September 2026

What this is: a read of the whole repository, and of the whole git history,
looking for the three things that must not be published — a credential, a piece
of somebody's private life, and a string in a language the project is not
written in. It was run against `4fa0358` on branch
`ustabasi/3-remote-ai-chat-pre-publication-security-`, over 210 tracked files,
919 blobs and 91 commits across every ref in the clone.

The scan is `scripts/audit.py`, written for this audit and kept: a finding that
can only be reproduced by hand is a finding that comes back. `gitleaks` and
`trufflehog` are better at this and neither was installed on the machine this
was run from, so the rules are in the script, they are tested
(`scripts/test_audit.py` fires every one of them against a sample of its own
shape and against the placeholders this repository uses on purpose), and CI
runs both.

```bash
python scripts/test_audit.py    # the scanner finds what it claims to
python scripts/audit.py         # tracked files  → exit 1 on any finding
python scripts/audit.py --history   # every blob and commit identity in git
```

## Verdict

| | |
|---|---|
| Secrets in tracked files | **none** |
| Secrets anywhere in git history | **none** |
| Personal data in tracked files | none of the shapes the scanner looks for; 3 files carried an author-specific identifier, found by hand and fixed below |
| Personal data in git history | 21 hits across 18 blobs, plus 2 author identities in commit metadata — **not** rewritten, see [section 4](#4--what-only-exists-in-history) |
| Turkish in tracked files | 62 lines in 19 files; all English now except `call.py`, where the language is the feature, and the audit's own three files, which quote what was removed |
| Doc claims that did not match the daemon | 5, all corrected |
| Broader cleanup needed | **Yes, but small** — see [Cleanup needed?](#cleanup-needed) |

Nothing found in this audit is a live credential. No API key, token, password,
private key, `.env` body or APNs `.p8` has ever been committed to this
repository, in any branch, in any commit. The `AuthKey_*.p8`, the device tokens
and the chat database have always lived under `~/.remote-ai-chat/`, which
`.gitignore` has excluded from the first commit; `app/identity.local.json`
(bundle id, Apple team, EAS project) has always been untracked and read at build
time by `app/app.config.js`.

## 1 · What was scanned, and for what

Every tracked file, and every blob reachable from every ref, minus binaries
(images, fonts, audio, the design archive) and the two generated lockfiles.
Commit messages and commit author/committer identities were scanned separately.

Rules, all in `scripts/audit.py`:

*Secret shapes* — `sk-ant-`, `sk-`, `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/
`github_pat_`, `glpat-`, `xox[baprs]-`, Slack webhooks, `AKIA`/`ASIA`, `AIza`,
`ya29.`, `npm_`, `sk_live_`/`rk_live_`, `SG.`, Twilio `AC…`, Telegram bot
tokens, `-----BEGIN … PRIVATE KEY-----`, JWTs, `AuthKey_<id>.p8`, and two
generic forms: `password|secret|api_key|access_token|client_secret = "…16+"`
and `token = "…24+"`.

*Personal data* — `/Users/<name>` and `/home/<name>` (minus the deliberate
placeholders `you`, `test`, `user`, `runner`), consumer e-mail domains,
`*.*.ts.net` tailnet hostnames, and `<something>-MacBook*.local` machine names.

*Language* — the Turkish letters English does not have (`şğıİöçüŞĞÖÇÜ`) and 99
Turkish words no English sentence contains, matched with the diacritics folded
away so that `bekliyor` is caught as well as `çalışıyor`. The word list is the
one that would have caught every string this audit found by hand, which is the
only test of a word list worth having. It is deliberately short of words English
also uses — `ad`, `alo`, `git`, `an` — so it is a floor and not a ceiling; a
reviewer still reads the UI strings.

*Names that must never be tracked* — `.env*`, `*.p8`, `*.p12`, `*.pfx`, `*.pem`,
`*.key`, `*.jks`, `*.keystore`, `*.mobileprovision`, `*.cer`, `uploads/`,
`*.sqlite*`, `*.db`, `identity.local.json`.

The three scans that back the rest of this document:

```
$ python scripts/audit.py
── tracked-file: 0
── secret: 0
── personal: 0
── language: 0
0 finding(s) in tracked files

$ git ls-files | grep -E '\.env|\.p8$|\.p12$|\.pem$|uploads/|\.sqlite'
(no output)

$ git log --all --pretty=format: --name-only --diff-filter=A | sort -u \
    | grep -iE '\.env|\.p8$|\.pem$|uploads/|\.sqlite|id_rsa|\.netrc|credential'
(no output)   # no such file was ever added, on any branch
```

## 2 · Findings in tracked files, and the fix for each

### Secrets

None. The only key-shaped strings in the repository are the redaction patterns
the daemon uses to scrub its own output (`daemon/remote_ai_chat/security.py`,
lines 37–46), which are regexes, not keys.

### Personal data

| File · line (before) | Was | Now |
|---|---|---|
| `daemon/scripts/test_agents.py` :124, :128 | `"yakup-projects"` — the author's own Claude skill, as a test fixture | `"existing-skill"` |
| `store/checklist.md` :4 | the real bundle id, `com.yakupkeskin.remoteaichat` | removed; the line now points at `app/identity.local.json`, which is where `app/app.config.js` reads it from and which git does not carry |
| `store/checklist.md` :15 | the App Store Connect app id | removed |
| `app/app/chat/[id].tsx` :209 | `ch?.title === 'Yeni sohbet'` — a legacy title only the author's own pre-release database can contain | dropped; the daemon has only ever written `NEW_CHAT_TITLE = "New chat"` (`daemon/remote_ai_chat/session.py` :23) |

No e-mail address, tailnet hostname, machine name or absolute home path is in
any tracked file. `web/src/lib/format.ts` :4 (`/Users/you/projects/…`),
`daemon/scripts/test_preamble.py` (`/Users/test/projects`) and
`you@example.com` in both `i18n.ts` tables are deliberate placeholders and the
scanner is tested not to flag them.

### Turkish

62 lines in 19 files, by `scripts/audit.py` against the base commit. All of them
are now English except the one file listed as an exception below.

**The desktop panel**, which was the bulk of it — a panel the author used alone
and never translated:

| File · line | Was | Now |
|---|---|---|
| `web/src/App.tsx` :268 | `Panele git` | `Dashboard` |
| `web/src/components/ApprovalModal.tsx` :74 | `+{n} bekliyor` | `+{n} waiting` |
| `web/src/components/ApprovalModal.tsx` :89 | `title="Kopyala"` | `title="Copy"` |
| `web/src/components/ApprovalModal.tsx` :116 | `izin modu:` | `permission mode:` |
| `web/src/components/ApprovalModal.tsx` :123 | `Reddet` | `Deny` |
| `web/src/components/ChatMenu.tsx` :73 | `Geri` | `Back` |
| `web/src/components/ChatMenu.tsx` :131 | `Kaydet` | `Save` |
| `web/src/components/Inspector.tsx` :238 | `hata` | `error` |
| `web/src/components/Palette.tsx` :204, :206 | `↑↓ gez`, `⌘K kapat` | `↑↓ move`, `⌘K close` |
| `web/src/components/Timeline.tsx` :173 | `kuyrukta` | `queued` |
| `web/src/components/Timeline.tsx` :347 | `hata` | `error` |
| `web/src/components/Timeline.tsx` :375, :377 | `izin verildi`, `reddedildi` | `allowed`, `denied` |
| `web/src/components/Timeline.tsx` :403 | `Reddet` | `Deny` |
| `web/src/lib/timeline.ts` :150 | `Bilinmeyen hata` | `Unknown error` |
| `web/src/screens/Agents.tsx` :223 | `Kur` | `Install` |
| `web/src/screens/Agents.tsx` :332 | a comment naming `the Kur button` | `the Install button` |
| `web/src/screens/Onboarding.tsx` :242 | `Adres eksik.` | `Address is missing.` |
| `web/src/screens/Onboarding.tsx` :296, :324 | `tamam` | `ok` |
| `web/src/screens/Onboarding.tsx` :314 | `Tekrar yokla` | `Check again` |
| `web/src/screens/Onboarding.tsx` :365 | `label="ad"` | `label="name"` |
| `web/src/screens/Onboarding.tsx` :377 | `token bekleniyor` | `waiting for a token` |
| `web/src/screens/Projects.tsx` :68 | `git deposu` | `git repository` |
| `web/src/screens/Projects.tsx` :88 | `{n} dosya` / `temiz` | `{n} files` / `clean` |
| `web/src/screens/Settings.tsx` :368 | `Kopyala` | `Copy` |
| `web/src/screens/Settings.tsx` :466 | `Tekrar dene` | `Try again` |
| `web/src/screens/Settings.tsx` :519, :1049 | `k="adres"` | `k="address"` |
| `web/src/screens/Settings.tsx` :522, :1045 | `k="sistem"` | `k="system"` |
| `web/src/screens/Settings.tsx` :760 | `Kaydet` | `Save` |
| `web/src/screens/Settings.tsx` :823 | `k="yol"` | `k="path"` |

**The daemon:**

| File · line | Was | Now |
|---|---|---|
| `daemon/remote_ai_chat/__main__.py` :165 | `print(f"Cihaz: …")` — Turkish in the output of `remote-ai-chat web` | `print(f"Device: …")` |
| `daemon/remote_ai_chat/server.py` :46 | a `"tr"` row of push-notification bodies | removed. Nothing could reach it: no client sends `lang` at `hello` (`app/src/store.ts` :297 and `web/src/lib/fleet.ts` :298 both send `device_name` only), so `Device.lang` has always been its default `"en"`. The `lang` field and the lookup are untouched, and the lookup already falls back to English for a language the table does not carry — so behaviour is identical for every client, including one that does send `lang: "tr"`. |
| `daemon/remote_ai_chat/server.py` :848 | a comment quoting the Turkish name macOS gives a screenshot | the English name, which makes the same point |
| `daemon/scripts/call_bench.py` :5, :32, :84 | a Turkish usage example, a Turkish probe in the default question set, a Turkish warm-up question | English. The comment now says to pass a non-English question with `-q` to exercise the bilingual path, so the capability is still documented and the file reads in one language |
| `daemon/scripts/test_session.py` :359–365 | `"Devam"` as the message text | `"Carry on"` |
| `daemon/scripts/test_stream.py` :257–308 | `"Arka plan bitti."`, `"yeni soru"`, `"Yeni cevap."`, `"Bitti."` as stream fixtures | English equivalents |

**The app:**

| File · line | Was | Now |
|---|---|---|
| `app/src/i18n.ts` :1 | `English is the default; Turkish is selectable in Settings` | true when it was written, and not since: there is one table, `LOCALE` is pinned to `en-US`, and no screen offers a language. Comment corrected |
| `app/src/i18n.ts` :160 | `language`, `english`, `turkish: 'Türkçe'` | removed. All three were unreachable — nothing in `app/` referenced any of them |
| `app/src/i18n.ts` :184, `app/app/call.tsx` :424–442 | the key `callAlo` and a local `alo` | `callGreeting` / `greeting`. The value was already English; the identifier was not, and the comments around it already said "greeting" |

**The exceptions, and there are two kinds.**

*The feature.* `daemon/remote_ai_chat/call.py` keeps Turkish words, and
has to. The concierge answers a voice call in the language it was asked in;
`_TURKISH_LETTERS` and `_TURKISH_WORDS` (:294–297) are how it tells which,
`fix_address` (:320) mirrors the honorific into the right language, and
`_SLANG` (:312) strips slang that the model otherwise copies out of the chat
previews it reads. None of that can be written without the words in it, and
removing the feature is not in this ticket's remit. The module docstring now
says so, and `ALLOW` in `scripts/audit.py` carries the path and the reason —
one entry, asserted to be the only one by `scripts/test_audit.py`. Everything a
contributor *reads* in that file — comments, docstrings, log lines — is English.

*The audit trail.* Three files cannot be scanned by the thing they are about:
`scripts/audit.py` holds the patterns, `scripts/test_audit.py` holds a sample of
every shape those patterns look for, and this file quotes what was found —
because an audit that says "a Turkish label was fixed" without saying which one
cannot be checked. All three are listed in `SELF` in the script, exempt from
*every* rule rather than only the language ones, and `scripts/test_audit.py`
asserts both that the list is exactly those three and that an ordinary file is
not exempt. The consequence is worth saying plainly: **a real secret pasted into
an audit report is the one thing this script cannot catch.** Those three files
are read by eye.

So a literal `grep -rInE '[şğıİöçüŞĞÖÇÜ]'` over the tracked files still returns
hits — in `call.py`, where the language is the feature, and in the three files
above, which are the record of the removal. Everywhere else it is silent.

### Docs that did not match the daemon

Found while checking `SECURITY.md` and `PRIVACY.md` against the code. All five
were corrected in the docs; none was "fixed" in the daemon, because changing
daemon behaviour is outside this ticket.

1. **`SECURITY.md`: "Five failures from one address in ten minutes earns a
   temporary lockout."** Not true. `Server._rate_limited`
   (`daemon/remote_ai_chat/server.py` :976) counts failures per address over a
   600-second window, and `_auth` (:991) uses the result only to decide whether
   to *record* another one. Nothing refuses, delays or blocks on the count: a
   bad token is closed with 4401 whether it is the first attempt or the
   thousandth, and a good token is accepted regardless. The doc now says the
   counter exists and nothing acts on it, and that the size of the token is what
   stands in the way. **Recommended follow-up:** make `_rate_limited` actually
   refuse, in its own ticket, with a test.
2. **`SECURITY.md`: "Revoking is instant: the token hash is deleted and the open
   socket is closed."** Half true. `Config.revoke` deletes the hash, and
   `reload_devices` is only consulted on a token *lookup miss* — i.e. on a new
   connection. `ws_endpoint` authenticates once, when the socket is accepted,
   and never again, so a device that is connected at the moment it is revoked
   keeps that session until it drops. The doc now says this and says to restart
   the daemon if it has to be gone now. **Recommended follow-up:** close the
   sockets of a revoked device, in its own ticket.
3. **`SECURITY.md`: "`GET /files` serves only out of
   `~/.remote-ai-chat/uploads`."** Understated. `Server.files` (:955) serves
   an upload *or* any file that passes `PathPolicy.is_servable` — which is how
   an agent shows you a screenshot it took or a PDF it built. That is a
   deliberate second path with its own fence (`allowed_roots` minus
   `denied_paths` minus the secret-name list); describing only the first made
   the second look like a hole. The doc now describes both. The same sentence
   appears in `README.md` under *Media* and is left for the README ticket —
   noted under [Cleanup needed?](#cleanup-needed).
4. **`PRIVACY.md`: voice messages are transcribed "locally or through the
   transcription service you chose."** There is no service option.
   `daemon/remote_ai_chat/transcribe.py` has exactly two backends, `mlx-whisper`
   on Apple silicon and `faster-whisper` elsewhere, both of which run on the
   computer. Corrected, including that the model is fetched once from Hugging
   Face.
5. **`PRIVACY.md` said nothing about voice calls.** It should:
   `app/src/voice.ts` :54 sets `requiresOnDeviceRecognition: false`, so during a
   call the phone sends the audio of your question to Apple's speech recognition
   servers, on purpose, because the on-device model does not know your project
   names. The comment in the code says so; the privacy policy did not. A *Voice
   calls* section now does, and the *Permissions* section now says the
   microphone is live for the duration of a call and not only while a button is
   held.

`SECURITY.md` also gained a **Who holds which token** section, because the
document described the pairing token and never mentioned the other two things a
reader has to know about: the panel is an ordinary paired device whose token
rides in the URL *fragment* (`cmd_web`, `daemon/remote_ai_chat/__main__.py`
:144), and the APNs `.p8` is a way out rather than a way in — `config.toml`
holds only pointers to it (`apns_key_path`, `apns_key_id`, `apns_team_id`,
`apns_bundle_id`), the key itself lives under `~/.remote-ai-chat/` at mode 600,
and `denied_paths` keeps a chat out of the folder it is in.

Everything else in both documents was checked and holds: 32-byte tokens
(`secrets.token_urlsafe(32)`), sha256-only storage, `config.toml` at mode 600
and its directory at 700, the bind list resolving to the Tailscale address plus
loopback, the `allowed_roots`/`denied_paths` fence being enforced in the daemon
rather than the client, the destructive-command list applying in every
permission mode, output redaction before storage, `auto_update` on by default at
a 900-second interval, and the agent store downloading markdown and executing
nothing.

## 3 · `.gitignore`

Rewritten to cover credentials by shape rather than by the one name that had
caught somebody out before. It now carries `.env`, `.env.*`, `*.p8`, `*.p12`,
`*.pfx`, `*.pem`, `*.key`, `*.jks`, `*.keystore`, `*.mobileprovision`, `*.cer`,
`.netrc`, `.npmrc`, `uploads/`, `*.sqlite`, `*.sqlite-*`, `*.db`,
`.remote-ai-chat/`, `.venv*/` (which `.venv312/` needed and did not have as a
glob), `node_modules/`, `app/ios/build/`, and `app/identity.local.json` (which
`app/.gitignore` had and the root one did not).

Nothing matching any of those is tracked:

```bash
$ git ls-files | grep -E '\.env|\.p8$|\.p12$|\.pem$|uploads/|\.sqlite'
(no output)
```

`scripts/audit.py` checks the same thing by name on every run, so a future
`certs/apns.p12` fails CI rather than waiting for a person to notice.

## 4 · What only exists in history

**History was not rewritten and must not be.** Everything below is reported so
that a person can decide, and the decision turns out to be easy: with one
exception, none of it is on anything that has been pushed.

### Not published — local-only branches

`git log -S … --pickaxe-all` over each ref, cross-checked against
`refs/remotes/origin/*`:

| What | Where | Commits |
|---|---|---|
| `yakupkeskin777@gmail.com`, in mock account rows inside the design artboards (`design/Accounts.dc.html`, `design/MoveSignIn.dc.html`, `design/remote-ai-chat-ekranlar.html`) | 15 blobs | introduced `dcdb9c12de30310e3517160500b6808c2633dec9` (2026-09-08), also in `25568075615984e9b88e4a739e217722ff769375`; the files were deleted by `530e873495a04c07c9a0f7381d2e643584748822` and `2003ad31a05588855e2aa638f30f623d669e06d8` (2026-09-17) |
| `/Users/dilarakilic`, in `docs/QA-REPORT.md` (4 lines) and an older docstring in `web/src/lib/format.ts` | 2 blobs | `b756ab19ac65009cbebe263cda13bcd7d50fefaf` (2026-09-08) and `1264bcf7e74b59691818507f28e1d4beddf8b196` (2026-09-14); both gone by `530e873…` |
| `Dilara-MacBook-Air.local`, in a mock host row in `design/desktop/Dashboard.dc.html` | 1 blob | `1264bcf7e74b59691818507f28e1d4beddf8b196`; gone by `530e873…` |
| `dilarakilic@Dilara-MacBook-Air.local` as commit author and committer | 22 commits | 2026-09-08 → 2026-09-17 |

Every one of those commits is reachable only from the local branches
**`pre-oss-history`** (which is what its name says: the pre-open-source history,
kept deliberately) and **`feature/phone-call`**. Neither is on `origin`.
`origin/main`, `origin/app-redesign`, `origin/fix/panel-gaps` and
`origin/panel-wall-and-remote-screen` contain **no** file with any of these
strings in any commit.

**Remedy: do not push those two branches.** If they are not needed, delete them
locally (`git branch -D pre-oss-history feature/phone-call`) — but that is a
decision about somebody's own archive, so this branch does not touch them. A
push must be by branch name and never `git push --all` or `--mirror`, either of
which would publish all of it in one go.

### Published — the author's e-mail in commit metadata

`yakupkeskin777@gmail.com` is the author *and* committer address of 10 commits
on `origin/main`, and of a handful more on the other pushed branches. This is
already public on GitHub. It cannot be removed without rewriting published
history, which this ticket forbids and which is the right call anyway: rewriting
`main` breaks every clone and every fork, to hide an address that has already
been indexed.

Remedy, in the order it is worth doing:

1. Stop adding more. `git config user.email 44753768+yakubilik@users.noreply.github.com`
   in this repository — 42 commits already use exactly that address, so this is
   only making the majority the rule. Turning on **Settings → Emails → Keep my
   email addresses private** and **Block command line pushes that expose my
   email** on the GitHub account makes it mechanical.
2. Leave the existing commits alone.
3. Deliberately *not* done: a `.mailmap`. It would make `git shortlog` show one
   identity, but GitHub does not read it for attribution, and the file would
   have to contain the gmail address in plaintext at the root of the repository
   — which makes it easier to find, not harder. That is the opposite of the
   point.

### Turkish in history

7,870 lines across 261 blobs and 82 distinct paths, which is what you would
expect of a project that was bilingual for its first weeks. It is not a secret, it does not leak
anything, and it is not worth rewriting a published history over.
`scripts/audit.py --history` reports it; `scripts/audit.py` (which is what CI
runs) does not, because the working tree is what a contributor can fix.

### Commit messages

Scanned for both secret shapes and Turkish. Clean, in every branch. Per this
ticket's constraints no commit message was edited.

## 5 · The mechanical checks, as run

```
$ cd daemon
$ .venv312/bin/python scripts/test_session.py      → all good
$ .venv312/bin/python scripts/test_stream.py       → all good
$ .venv312/bin/python scripts/test_attachments.py  → all good
$ .venv312/bin/python scripts/test_pool.py         → all good
$ .venv312/bin/python scripts/test_agents.py       → all good
$ .venv312/bin/python scripts/test_preamble.py     → all good
$ .venv312/bin/python scripts/test_replay.py       → all good
$ .venv312/bin/python scripts/test_fanout.py       → all good

$ cd web && npm ci && npm run typecheck            → clean
$ python scripts/test_audit.py                     → all good
$ python scripts/audit.py                          → 0 findings
$ git ls-files | grep -E '\.env|\.p8$|\.p12$|\.pem$|uploads/|\.sqlite'  → nothing
```

`test_session.py` and `test_pool.py` were **failing before this branch**, on
`main` as well, with `AttributeError: 'FakeProvider' object has no attribute
'steer'`: `ProviderBase.steer` was added (`providers/base.py` :75, used by
`session.py` :402) without the two duck-typed fakes in those scripts. Both fakes
now answer `steer` the way the base class does — `False`, so the session queues
the message, which is what those scenarios assert. Neither script is in CI's
list, which is why it went unnoticed; `test_agents.py` was not either, and now
is.

## Cleanup needed?

**Yes — but it is a short list, and none of it is dangerous.** The repository is
in good shape: 210 tracked files, no checked-in build output, no vendored
dependencies, no stray archives, no generated file that is not either documented
or needed at runtime. `daemon/remote_ai_chat/webui/` (the built panel),
`app/ios/`, `app/android/`, `node_modules/` and the virtualenvs are all
correctly untracked.

### Reviewed and *not* dead, for the record

Checked directory by directory against `git ls-files`, because several of these
look like artefacts and are not:

- `design/app-design.zip` (114 KB) — the drawing the app was rebuilt from,
  explicitly documented in `design/README.md`. Its contents were unpacked and
  scanned: mock data only (`deniz@acme.co`, `100.x` example addresses), no
  Turkish, no real identifier. **Keep.**
- `daemon/remote_ai_chat/agent-store-snapshot.json` — read at runtime by
  `agents.py` :207. **Keep.**
- `daemon/remote_ai_chat/house_style.md`, `docs/session-context.md` — both read
  at runtime by `preamble.py` and asserted by `test_preamble.py`. **Keep.**
- `app/src/icons.gen.ts` — generated by `app/scripts/gen-icons.py`, needed at
  build time, normal to commit. **Keep.**
- `daemon/scripts/{client,smoke,e2e,call_bench,test_live}.py` — the scripts that
  need a running daemon. Documented in `CONTRIBUTING.md`. **Keep.**
- `store/shots/`, `docs/screenshots/` — App Store and README images. **Keep**
  (and out of scope here: a separate ticket owns them).

### Found, not removed, and why

1. **`daemon/remote_ai_chat/voip.py` is a half-landed feature, not dead code.**
   Nothing imports it; `Voip.ring()` is never called from anywhere in the
   repository. The other half of the path *is* wired: the app registers a VoIP
   token (`app/src/incoming-call.ts` :28), the daemon stores it
   (`server.py` :1059, :1081) and reports `can_be_called`, `CallCenter.swift`
   handles the push, and `config.py` carries the four `apns_*` settings. So this
   is one missing call site, not a file to delete — deleting it would throw away
   working code. **Recommendation:** finish it or say in the module docstring
   that it is not reached yet. Its own ticket.
2. **`app/package-lock.json` is out of sync with `app/package.json`.**
   `npm ci` in `app/` fails: *Missing: react-dom@19.1.0 from lock file*. This
   predates the branch and is invisible to CI, which does not install the app.
   It means a contributor's first command in `app/` fails. **Recommendation:**
   `npm install` in `app/` and commit the lockfile, in a ticket that can verify
   the app still builds — not in a secrets audit. It is also why the app could
   not be typechecked here; the three app edits in this branch were verified by
   grep instead (no reference to the removed keys survives, `Key` is
   `keyof typeof en`).
3. **`store/checklist.md` is the author's private release log.** Redacted above,
   but it still records submission dates, build numbers, TestFlight state and
   "another session's uncommitted drag-and-drop module". None of that is a
   secret and none of it helps a contributor. **Recommendation:** move it out of
   the public repository. Left in place because deleting somebody's own record
   of a submission is their call, not an auditor's.
4. **`README.md` still says `GET /files` "only ever serves out of
   `~/.remote-ai-chat/uploads`"** (*Media* section), which is the inaccuracy
   corrected in `SECURITY.md` as finding 3 above. Left for the README ticket,
   which owns that file.
5. **`web/src` hardcodes the Turkish collation locale.** 28 call sites across
   seven files use `toLocaleLowerCase('tr')` or `localeCompare(name, 'tr')` —
   `Projects.tsx`, `Agents.tsx`, `Terminal.tsx`, `NewChat.tsx`, `Palette.tsx`,
   `Sidebar.tsx`, `FieldSheet.tsx` — which is a leftover of who wrote the panel,
   and a live bug for everyone else: Turkish lowercasing maps `I` to a dotless `ı`, so searching an English
   project name for `I` does not match it. Not touched here because it is
   behaviour, not a string. **Recommendation:** drop the locale argument, in a
   ticket with a search test.

### Removed in this branch

**Nothing.** No file in this repository turned out to be dead. The only
deletions are of lines: three unreachable i18n keys, one unreachable
push-notification table row, and one legacy chat title.

### Added in this branch

- `scripts/audit.py` — the scan above, rerunnable, exit-1 on a finding.
- `scripts/test_audit.py` — proof the scan would have said something else.
- `docs/audit/2026-09-27-security-audit.md` — this file.
- an `audit` job in `.github/workflows/ci.yml`, and `test_agents.py` added to
  the daemon job's list.

Two lists in `scripts/audit.py` are the whole of its discretion, and both are
asserted by `scripts/test_audit.py`: `ALLOW`, one entry, the file where another
language is a feature; and `SELF`, three entries, the files that cannot scan
themselves. Adding to either is a decision, not a fix.
