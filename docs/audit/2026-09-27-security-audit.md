# Pre-publication audit — 27 September 2026

What this is: a read of the whole repository, and of the whole git history,
looking for the three things that must not be published — a credential, a piece
of somebody's private life, and a string in a language the project is not
written in. It was run three times on the audit branch: first against the base
`4fa0358`, over 210 tracked files, 919 blobs and 91 commits; then again after
`git merge main` brought in `f44b641`, over **222 tracked files, 1,003 blobs and
114 commits** across every ref in the clone; and a third time over this report,
which is a tracked file too and which the scanner is deliberately blind to. The
second pass is the one this document describes, and the reason for each of the
later two is in [A second pass, after merging
`main`](#a-second-pass-after-merging-main) and [A third pass, over this
report](#a-third-pass-over-this-report).

The scan is `scripts/audit.py`, written for this audit and kept: a finding that
can only be reproduced by hand is a finding that comes back. `gitleaks` and
`trufflehog` are better at this and neither was installed on the machine this
was run from, so the rules are in the script, they are tested
(`scripts/test_audit.py` fires every one of them against a sample of its own
shape and against the placeholders this repository uses on purpose), and CI
runs the scanner, its test and the i18n check on every push.

```bash
python scripts/test_audit.py        # the scanner finds what it claims to
python scripts/audit.py             # tracked files  → exit 1 on any finding
python scripts/audit.py --history   # every blob and commit identity in git
python scripts/test_i18n_keys.py    # the app asks for no string that is not there

# and, for a release audit, with the names that cannot be written down:
RAC_AUDIT_NAMES='<name>|<other-project>' python scripts/audit.py --history
```

## Verdict

| | |
|---|---|
| Secrets in tracked files | **none** |
| Secrets anywhere in git history | **none** |
| Personal data in tracked files | none of the shapes the scanner looks for; 5 files carried an author-specific identifier — 3 found by hand in the first pass, 3 more in the second pass by the two rules those three led to, all 7 fixed below; this report was the eighth, redacted in the third pass |
| Personal data in git history | 149 hits across 53 blobs, plus 2 author identities in commit metadata, on the name list the third pass used — **not** rewritten, see [section 4](#4--what-only-exists-in-history) |
| Turkish in tracked files | 62 lines in 19 files; all English now except `call.py`, where the language is the feature, and the audit's own three files, which quote what was removed |
| Doc claims that did not match the daemon | 5, all corrected |
| Broader cleanup needed | **Yes, but small** — see [Cleanup needed?](#cleanup-needed) |

That figure is larger than the 21/18 of the first pass for one reason: the two
new rules described below. No blob gained a finding; the scanner gained the
rules that could see what was already there. Both counts are from the same
command — `scripts/audit.py --history` with `RAC_AUDIT_NAMES` set — which also
reports 7,870 language hits across 261 blobs and 82 paths.

It is not a constant, and should not be quoted as one: 114 of the 149 come from
`author-name`, whose list is supplied in the environment and deliberately not
committed, so a longer list finds more. The three numbers that do not move are
the ones that matter — no secret, in any blob, in any branch; the Turkish, which
is 7,870 lines whatever names are given; and the tracked-file total, which is
zero.

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
`*.*.ts.net` tailnet hostnames, `<something>-MacBook*.local` machine names, and
two rules added in the second pass because the first pass missed two findings
that none of the others could have caught:

- **`personal-attribution`** — a capitalised name followed by an attribution
  verb (`asked`, `wanted`, `requested`, `complained`, `insisted`, `prefers`,
  `preferred`). "X asked for that to stop (2026-09-22)" in a source comment is a
  note the author wrote to the author; a contributor reading it learns only that
  they were not in the room. A stop list (`NOT_A_PERSON`) keeps the prose forms
  out — "Nobody asked, so there was no turn" appears twice in this repository
  and is not a finding, and `scripts/test_audit.py` asserts both directions.
- **`author-name`** — the author's own name and the names of the author's other
  projects. This one has no list in the script, on purpose: a denylist of
  private names written into a public file is the thing it is guarding. The
  names are supplied at scan time and the release audit records which:

  ```bash
  RAC_AUDIT_NAMES='<name>|<name>|<other-project>' python scripts/audit.py
  ```

  Without the variable the rule is simply absent, which is why
  `personal-attribution` exists as well: it catches the shape rather than the
  name, and it is the one that runs in CI.

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

### A second pass, after merging `main`

The first pass scanned the tree at `4fa0358`. While this branch was open `main`
moved on — `7fb1390` ("Every chat title says which project it is about") and the
merge of the README/screenshots ticket — so "every tracked file" had stopped
being true: 29 paths were added or changed on `main`, 17 of them text, and none
of them had been looked at. One of them carried a finding of exactly the class
this branch had already fixed once (`daemon/scripts/test_titles.py`, below).

`main` was merged into this branch (`484a7c9`) and everything re-run. The scan
of the merged tree is the one quoted above; the files `main` brought are covered
by it, and separately by themselves:

```
$ git diff --name-only 4fa0358..main        # 29 paths, 17 of them text
$ python3 - <<'EOF'                          # scan just those, with the name rule on
  … 17 scanned as text
  findings: 0
EOF
```

The merge conflicted in exactly one file, `.github/workflows/ci.yml`, where this
branch had inserted an `audit` job at the line `main` had inserted its
`docs · links` job. **Both are kept** — dropping the link checker to resolve a
conflict would have been the audit removing a check. `main`'s
`daemon/scripts/test_titles.py` is now in the daemon job's list too, along with
the two scripts this branch adds.

### A third pass, over this report

The first two passes looked everywhere the scanner looks. The scanner does not
look at three files — `scripts/audit.py`, `scripts/test_audit.py` and
`docs/audit/`, because each has to carry the shape of the thing it is about —
and one of those three is this document, which had been written with the
findings quoted verbatim: the author's gmail address twice, the macOS username,
the laptop's Bonjour name, and the App Store bundle id that is built out of the
author's name. Section 4 says in as many words that two of those strings are on
no pushed branch. Committing this file would have published them for the first
time, in the document arguing they should stay unpublished, and no rule in the
scan would have said a word.

All of them are now placeholders, to the convention section 4 sets out, and the
gap that let it happen is closed by a check rather than by care:
`scripts/test_audit.py` reads every tracked file under `audit.SELF` back off
disk and fails on a home directory, an e-mail address at a consumer domain, a
tailnet hostname or a `*-MacBook*.local` machine name that is not one of the
samples it declares. It was watched failing. With one line appended to this
file, of the shape

```
Pasted by accident: /Users/<name>, <name>@gmail.com, <Name>-MacBook-Air.local.
```

but carrying the four real strings rather than the placeholders, the test
reports

```
FAIL  docs/audit/2026-09-27-security-audit.md carries no unredacted identifier
      710: home-directory '…'; 710: personal-email '…'; 710: local-hostname '…'
```

and the line was then removed again. A key-shaped string pasted into a report is
still a reader's job and nobody else's; the three identifier shapes, which are
the ones an audit of history has on the clipboard, are now mechanical.

## 2 · Findings in tracked files, and the fix for each

### Secrets

None. The only key-shaped strings in the repository are the redaction patterns
the daemon uses to scrub its own output (`daemon/remote_ai_chat/security.py`,
lines 37–46), which are regexes, not keys.

### Personal data

| File · line (before) | Was | Now |
|---|---|---|
| `daemon/scripts/test_agents.py` :124, :128 | `"yakup-projects"` — the author's own Claude skill, as a test fixture | `"existing-skill"` |
| `store/checklist.md` :4 | the real bundle id, which is built out of the author's own name (`com.<name>.remoteaichat`) | removed; the line now points at `app/identity.local.json`, which is where `app/app.config.js` reads it from and which git does not carry |
| `store/checklist.md` :15 | the App Store Connect app id | removed |
| `app/app/chat/[id].tsx` :209 | `ch?.title === 'Yeni sohbet'` — a legacy title only the author's own pre-release database can contain | dropped; the daemon has only ever written `NEW_CHAT_TITLE = "New chat"` (`daemon/remote_ai_chat/session.py` :23) |
| `daemon/remote_ai_chat/agents.py` :335–336 | a comment crediting the change to the author by first name and dating it to a private conversation: *"<Name> used to introduce itself on every chat; <Name> asked for that to stop (2026-09-22)"* | the comment now says what it is about and not who said it: *"This pack's agent introduced itself on every chat, which readers of a phone screen did not want…"*. The prompt itself and the `PROMPTS` key are untouched — `hermes` there is a public skill pack (`AlexAI-MCP/hermes-CCC`), not a private name |
| `daemon/scripts/test_titles.py` :45–65 | the name of one of the author's other products, twelve times, as the project fixture | `"ledger"`, and the one case that needed a name which is the prefix of a word is now `"ledgerbook is not ledger"`. Same twelve assertions, same shapes |
| `store/checklist.md` :37 | the author's full legal name, in a note about the App Store copyright field | *"a copyright line (the year and the holder named in LICENSE)"* — `LICENSE` carries the holder, and carrying it once is enough |

The last three are the ones the first pass missed. They are also why the scanner
gained `personal-attribution` and `author-name`: two of the three are a bare
first name and a product name, which no rule about keys, addresses or Turkish
words would ever have flagged. Re-run with the author's names supplied, the
scanner now reports zero:

```
$ RAC_AUDIT_NAMES='<the author's names and projects>' python scripts/audit.py
── tracked-file: 0
── secret: 0
── personal: 0
── language: 0
0 finding(s) in tracked files
```

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
daemon behaviour is outside this ticket. `main` has since changed
`security.py`, `server.py` and `session.py` (the project-name prefix on chat
titles); those changes were read against both documents in the second pass and
touch nothing either of them describes — no token, no fence, no notification, no
path policy decision.

`SECURITY.md` and `PRIVACY.md` as they now stand were checked line by line
against the merged daemon: the pairing token (`cmd_pair`,
`daemon/remote_ai_chat/__main__.py`), the panel's web token (`cmd_web`, the URL
fragment), APNs (`push.py` and `voip.py`, pointers in `config.toml` and the key
under `~/.remote-ai-chat/`) and the tailnet bind (`Config.bind`,
`resolve_bind`).

1. **`SECURITY.md`: "Five failures from one address in ten minutes earns a
   temporary lockout."** Not true. `Server._rate_limited`
   (`daemon/remote_ai_chat/server.py` :976) counts failures per address over a
   600-second window, and `_auth` (:991) uses the result only to decide whether
   to *record* another one. Nothing refuses, delays or blocks on the count: a
   bad token is closed with 4401 whether it is the first attempt or the
   thousandth, and a good token is accepted regardless. The doc now says the
   counter exists and nothing acts on it, and that the size of the token is what
   stands in the way.

   The *code* said the opposite of the corrected doc, in a comment on the line
   the correction is about: `_auth` (:991) carried *"a valid token is never
   locked out; the limiter only slows guessing"* — a throttle that does not
   exist. Leaving that in would have left the repository contradicting itself on
   the one function this finding is about, so the comment is now
   `# a valid token is always accepted; only failures are counted`, and
   `_rate_limited` has a docstring saying that nothing acts on its answer and
   pointing at this document. Comments only: the function behaves exactly as
   before. **Recommended follow-up:** make `_rate_limited` actually refuse, in
   its own ticket, with a test.
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

Everything below is written as a placeholder, to the same convention section 2
uses: `<name>` for the author's macOS username and for the local part of an
address, `<Name>` for a name as it reads in prose, `<Name>-MacBook-Air.local`
for the laptop. This report is itself a tracked file in the public repository it
is auditing, and section 4 exists because some of these strings are *not* on
`origin` — printing them here would publish, for the first time, the thing the
entry is asking nobody to publish. Nothing is lost by it: every row names the
commit or the blob, so `git show <commit>:<path>` gives the exact text to
whoever has the branch, and `RAC_AUDIT_NAMES='…' python scripts/audit.py
--history` regenerates the whole table. The convention is checked rather than
promised — `scripts/test_audit.py` reads this file and fails on an unredacted
home directory, address or machine name, because `scripts/audit.py` is blind to
its own three files.

### Not published — local-only branches

`git log -S … --pickaxe-all` over each ref, cross-checked against
`refs/remotes/origin/*`, and re-checked in the second pass with
`git for-each-ref --contains <commit>` for every commit named below:

| What | Where | Commits |
|---|---|---|
| the author's personal address, `<name>@gmail.com`, in mock account rows inside the design artboards (`design/Accounts.dc.html`, `design/MoveSignIn.dc.html`, `design/remote-ai-chat-ekranlar.html`) | 15 blobs | introduced `dcdb9c12de30310e3517160500b6808c2633dec9` (2026-09-08), also in `25568075615984e9b88e4a739e217722ff769375`; the files were deleted by `530e873495a04c07c9a0f7381d2e643584748822` and `2003ad31a05588855e2aa638f30f623d669e06d8` (2026-09-17) |
| the author's home directory, `/Users/<name>`, in `docs/QA-REPORT.md` (4 lines) and an older docstring in `web/src/lib/format.ts` | 2 blobs | `b756ab19ac65009cbebe263cda13bcd7d50fefaf` (2026-09-08) and `1264bcf7e74b59691818507f28e1d4beddf8b196` (2026-09-14); both gone by `530e873…` |
| the author's laptop, `<Name>-MacBook-Air.local`, in a mock host row in `design/desktop/Dashboard.dc.html` | 1 blob | `1264bcf7e74b59691818507f28e1d4beddf8b196`; gone by `530e873…` |
| `<name>@<Name>-MacBook-Air.local` as commit author and committer | 22 commits | 2026-09-08 → 2026-09-17 |
| the names of four of the author's other projects, in mock project lists and mock host rows across the design artboards (`design/*.dc.html`, `design/desktop/*.dc.html`, `design/remote-ai-chat-ekranlar.html`), plus `docs/PLAN.md` and `docs/QA-REPORT.md` | 30 blobs | `b756ab1`, `dcdb9c1`, `0859886`, `2880cab`, `1264bcf` (2026-09-08 → 2026-09-14); all gone by `530e873…` |

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

### Published — the author's name, in four files on `origin/main`

New in the second pass, and the reason the `author-name` rule exists. None of
this is a credential and none of it is dangerous; all of it is somebody's name,
and it is already on GitHub.

| What | Where | Introduced by | Reachable from |
|---|---|---|---|
| the author's first name, in the `agents.py` comment above | blobs `436433dd6` and `25b3d8d5e` | `b81902e` (2026-09-24) | `origin/main`, `origin/app-redesign`, `origin/panel-wall-and-remote-screen` |
| the author's own skill name as a test fixture (`test_agents.py`) | blob `940077461` | `4c6f64e` (2026-09-27) | `origin/main` |
| another of the author's products as a test fixture (`test_titles.py`) | blob `9b0184572` | `7fb1390` (2026-09-27) | `origin/main` |
| the author's full legal name in `store/checklist.md` | blobs `1f48ef4b6`, `73af7ab02`, `84945f201`, `8cb7844ee` | `2cbc261` (2026-09-23), then three more edits | `origin/main`, `origin/app-redesign`, `origin/panel-wall-and-remote-screen` |

An older `LICENSE` blob (`fcfe79b03`) carries the full legal name too, but it is
reachable only from `pre-oss-history`; `origin/main`'s `LICENSE` has said
`Copyright (c) 2026 yakubilik` since the repository was opened.

**Remedy: none, and deliberately.** Rewriting `main` to remove a name that is
already the public account name of the repository's owner would break every
clone and every fork to hide nothing. What matters is that the *tip* no longer
carries them, which section 2 demonstrates, and that the scanner would now say
so again — which is what `RAC_AUDIT_NAMES` and `personal-attribution` are for.
The same rule applies as below: push by branch name, never `--all` or
`--mirror`.

Twelve of the 149 personal hits in history are not findings at all, and are
written down here so the count reconciles: the string *"Host asked"* at
`design/remote-ai-chat-ekranlar.html` :4880, in twelve versions of an artboard
that was deleted in 2026-09-17. That is `personal-attribution` doing what a
shape-based rule does — `Host` is not on `NOT_A_PERSON`, and a UI label about a
host reads like a sentence about a person. The other two hits from that rule are
the two `agents.py` blobs in the table above, which are the real ones.

### Published — the author's e-mail in commit metadata

The author's personal `<name>@gmail.com` address is the author *and* committer
address of 10 commits on `origin/main`, and of a handful more on the other
pushed branches. This is already public on GitHub. It cannot be removed without
rewriting published history, which this ticket forbids and which is the right
call anyway: rewriting `main` breaks every clone and every fork, to hide an
address that has already been indexed.

Remedy, in the order it is worth doing:

1. Stop adding more. `git config user.email
   44753768+yakubilik@users.noreply.github.com` in this repository — 42 commits
   already use exactly that address, so this is only making the majority the
   rule. That one is written out rather than redacted on purpose: it is the
   address GitHub publishes on the account's behalf, it carries nothing the
   repository's own URL does not, and a remedy nobody can copy is not a remedy.
   Turning on **Settings → Emails → Keep my email addresses private** and
   **Block command line pushes that expose my email** on the GitHub account
   makes it mechanical.
2. Leave the existing commits alone.
3. Deliberately *not* done: a `.mailmap`. It would make `git shortlog` show one
   identity, but GitHub does not read it for attribution, and the file would
   have to contain the gmail address in plaintext at the root of the repository
   — which makes it easier to find, not harder. That is the opposite of the
   point.

### Turkish in history

7,870 lines across 261 blobs and 82 distinct paths — the number climbs by one
blob every time a commit touches one of those files, including the
commits that removed the Turkish, so it is a shape rather than a figure. It is
what you would expect of a project that was bilingual for its first weeks: the
pre-fix versions of the files section 2 lists, and the pre-open-source design
artboards. It is not a secret, it leaks nothing, and it is not worth rewriting a
published history over.

`scripts/audit.py --history` reports it; `scripts/audit.py` — the one CI runs —
does not, because the working tree is what a contributor can fix.

### Commit messages

Scanned for both secret shapes and Turkish. Clean, in every branch. Per this
ticket's constraints no commit message was edited.

## 5 · The mechanical checks, as run

All of the following were run on the merged tree — this branch with `main`
(`f44b641`) merged in — and not on the base the first pass used, then run again
unchanged after the third pass redacted this report.

```
$ cd daemon
$ .venv312/bin/python scripts/test_pool.py         → all good
$ .venv312/bin/python scripts/test_preamble.py     → all good
$ .venv312/bin/python scripts/test_replay.py       → all good
$ .venv312/bin/python scripts/test_session.py      → all good
$ .venv312/bin/python scripts/test_stream.py       → all good
$ .venv312/bin/python scripts/test_fanout.py       → all good
$ .venv312/bin/python scripts/test_attachments.py  → all good
$ .venv312/bin/python scripts/test_agents.py       → all good
$ .venv312/bin/python scripts/test_titles.py       → all good   (main's, now in CI)
$ .venv312/bin/python scripts/test_push.py         → all good   (new, see below)

$ cd .. && python scripts/test_audit.py            → all good
$ python scripts/audit.py                          → 0 findings
$ RAC_AUDIT_NAMES='…' python scripts/audit.py      → 0 findings
$ RAC_AUDIT_NAMES='…' python scripts/audit.py --history
                                                   → 0 in tracked files,
                                                     8,021 in history: 149
                                                     personal over 53 blobs,
                                                     7,870 Turkish over 261,
                                                     2 commit identities
$ python scripts/test_i18n_keys.py                 → all good   (new, see below)
$ python3 scripts/test_check_links.py              → all good   (main's)
$ python3 scripts/check-links.py                   → all good   (main's)
$ git ls-files | grep -E '\.env|\.p8$|\.p12$|\.pem$|uploads/|\.sqlite'  → nothing
```

The one line above that nobody else can reproduce is the one with
`RAC_AUDIT_NAMES` in it, because the names are deliberately not committed. So
here is the same command without it, which anybody with the clone can run and
which is the figure to check this report against:

```
$ python scripts/audit.py --history
                                                   → 0 in tracked files,
                                                     7,907 in history
```

The two reconcile exactly: 7,907 = 7,870 Turkish + 35 personal over blobs + 2
commit identities, and the name list adds 114 `author-name` hits on top, giving
8,021 and the personal total of 149. Broken out by rule, the run without names
is 5,339 `turkish-letter`, 2,531 `turkish-word`, 15 `personal-email`, 14
`personal-attribution`, 5 `home-directory`, 1 `local-hostname`, 1
`personal-email-in-commit-metadata`, 1 `local-hostname-in-commit-metadata` —

```
$ python scripts/audit.py --history | grep '^   \[history\]' \
    | sed -E 's/.*  ([a-z-]+)  .*/\1/' | sort | uniq -c | sort -rn
```

— and it takes about three minutes over the 1,012 blobs in the clone. All of the
above was run once more, unchanged, on the final tree of this branch.

And the two literal greps this audit was asked for, over every tracked file that
is not a binary:

```
$ git ls-files | … | xargs grep -InE '[şğıİöçüŞĞÖÇÜ]' | cut -d: -f1 | uniq -c
   7 daemon/remote_ai_chat/call.py
   7 docs/audit/2026-09-27-security-audit.md
   1 scripts/audit.py
   2 scripts/test_audit.py

$ git ls-files | … | xargs grep -InwE 've|için|ile|bir|değil|kanka' | cut -d: -f1 | uniq -c
   3 daemon/remote_ai_chat/call.py
   1 docs/audit/2026-09-27-security-audit.md
   1 scripts/audit.py
   1 scripts/test_audit.py
```

Four files, and they are the four documented exceptions: `call.py`, where the
language is the feature, and the scanner plus its test plus this report, which
have to contain the shape of what they are about. Nothing else in the repository
returns a hit.

### Three checks this audit needed and did not have

Each exists because a claim this document makes was otherwise unverified.

1. **`daemon/scripts/test_push.py`** — `PUSH_TEXT` (`server.py` :47) lost its
   Turkish row, and "behaviour is identical" rests entirely on
   `PUSH_TEXT.get(d.lang, PUSH_TEXT["en"])` answering in English for a device
   that reports a language the table does not have. No script touched
   `PUSH_TEXT` at all. This one drives the unbound `Server.notify` against a
   stub host, with `send_push` replaced by a recorder, and watches the body come
   out in English for `lang` of `"tr"`, `"de"`, `"en-GB"`, `""` and a device row
   from before the field existed — and watches the title, the token, the `data`
   payload and the two per-device switches stay as they were.
2. **`scripts/test_i18n_keys.py`** — `t(key)` in `app/src/i18n.ts` falls back to
   `key`, so renaming `callAlo` to `callGreeting` and missing a call site shows
   a user the name of a variable. `npx tsc --noEmit` is the real check and it
   cannot run here: `app/node_modules` is absent and `npm ci` fails on the
   lockfile drift recorded under [Cleanup needed?](#cleanup-needed). So this
   script reads the `const en = {…}` table out of `i18n.ts` (470 keys) and every
   `T('…')`, `T(cond ? 'a' : 'b')`, `Record<string, Key>` table and `ERR_KEYS`
   row under `app/` (425 distinct keys, 45 files, 4 lookup tables, 39 error
   codes), and fails if one is not in the table. It was watched failing: with
   `T('callGreeting')` put back to `T('callAlo')` it reports
   `app/app/call.tsx:424  T('callAlo')`. The one reference it cannot resolve
   (`new Error(t(key))` in `ws.ts`, where the key comes from `ERR_KEYS`) is
   printed rather than passed over in silence. The panel's own table
   (`web/src/lib/i18n.ts`) is left to `tsc`, which does run for `web/` in CI.
3. **the exempt-file check in `scripts/test_audit.py`** — the three files in
   `audit.SELF` are exempt from every rule, so until the third pass the sentence
   "no e-mail address, machine name or absolute home path is in any tracked
   file" was true of 219 files and unchecked for three, one of which is this
   report. The check reads every tracked file under `audit.SELF` back off disk,
   runs the four identifier rules over it, and fails on any match that is not
   one of the samples the test declares — the rule samples themselves, and the
   three-identifier line the check uses as its own negative control. Its second
   half is the reason the placeholders were chosen as they were:
   `/Users/<name>`, `<name>@gmail.com` and `<Name>-MacBook-Air.local` match no
   rule, because the angle bracket breaks every one of the shapes, and the test
   asserts that too. See [A third pass, over this
   report](#a-third-pass-over-this-report) for it failing.

All three run in CI: `test_push.py` in the daemon job, `test_i18n_keys.py` and
`test_audit.py` in the `audit` job.

`test_session.py` and `test_pool.py` were **failing before this branch**, on
`main` as well, with `AttributeError: 'FakeProvider' object has no attribute
'steer'`: `ProviderBase.steer` was added (`providers/base.py` :75, used by
`session.py` :402) without the two duck-typed fakes in those scripts. Both fakes
now answer `steer` the way the base class does — `False`, so the session queues
the message, which is what those scenarios assert. Neither script is in CI's
list, which is why it went unnoticed; `test_agents.py` was not either, and now
is — nor was `test_titles.py`, `main`'s own script, which is in the list now
too.

`main` had since fixed the same two fakes the same way, and the merge took both
copies: each `FakeProvider` ended up with `steer` defined twice, in the same
class, the second silently shadowing the first. Harmless — both return `False` —
but it is dead code the merge wrote, so the copy this branch added is gone and
`main`'s is kept. `daemon/scripts/test_pool.py` is now byte-identical to
`main`'s and `test_session.py` differs from it only by the one translated
fixture.

## Cleanup needed?

**Yes — but it is a short list, and none of it is dangerous.** The repository is
in good shape: 222 tracked files, no checked-in build output, no vendored
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
- `docs/release-notes/0.2.0.md`, `docs/screenshots/README.md`,
  `scripts/check-links.py`, `scripts/test_check_links.py` — `main`'s, reviewed
  in the second pass. Live documentation and a live check, not artefacts.
  **Keep** (`check-links.py` is in CI, in its own job, and this branch keeps it
  there).

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
   It means a contributor's first command in `app/` fails, and it is why `npx
   tsc --noEmit` could not be run here. **Recommendation:** `npm install` in
   `app/` and commit the lockfile, in a ticket that can verify the app still
   builds — not in a secrets audit. In the meantime the one thing the
   typechecker was needed for — that the app asks for no string that is not in
   `i18n.ts` — is now `scripts/test_i18n_keys.py`, which needs no `node_modules`
   and runs in CI.
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
   and a live bug for everyone else: Turkish lowercasing maps `I` to a dotless
   `ı`, so searching an English project name for `I` does not match it. Not
   touched here because it is behaviour, not a string. **Recommendation:** drop
   the locale argument, in a ticket with a search test.

### Removed in this branch

**No file.** Nothing in this repository turned out to be dead. The only
deletions are of lines: three unreachable i18n keys, one unreachable
push-notification table row, one legacy chat title, and the duplicated `steer`
stub the merge with `main` produced in each of the two fakes (above).

### Added in this branch

- `scripts/audit.py` — the scan above, rerunnable, exit-1 on a finding.
- `scripts/test_audit.py` — proof the scan would have said something else.
- `scripts/test_i18n_keys.py` — every string the app asks for exists.
- `daemon/scripts/test_push.py` — a notification body is English for every
  phone.
- `docs/audit/2026-09-27-security-audit.md` — this file.
- an `audit` job in `.github/workflows/ci.yml` (three steps: the scanner's test,
  the scan, the i18n check), kept alongside `main`'s `docs · links` job, and
  `test_agents.py`, `test_titles.py` and `test_push.py` added to the daemon
  job's list.

Three lists in `scripts/audit.py` are the whole of its discretion, and all three
are asserted by `scripts/test_audit.py`: `ALLOW`, one entry, the file where
another language is a feature; `SELF`, three entries, the files that cannot scan
themselves; and `NOT_A_PERSON`, the subjects that make an attribution verb prose
rather than a note to the author. Adding to any of them is a decision, not a
fix. `AUTHOR_NAMES` is not a list at all — it comes from the environment, and
the test asserts that the file carries no names of its own. `SELF` is the one
that buys silence rather than accuracy, so it is the one the test also reads
back: the three files it exempts are scanned for identifiers by the test itself,
against a fourth list (`REDACTED`) of the samples that are allowed to look like
one.
