# Notes for coding agents

This repository is public. Read `CONTRIBUTING.md` before the first edit; three of its
rules are the ones agents break:

- **English only.** No Turkish word and no Turkish-only letter in any tracked file:
  code, comments, tests, fixtures, docs, commit messages. Text a feature must carry in
  another language (a prompt a job sends to a Turkish chat, a detector's word list)
  goes inside a marked data block (the marker syntax is in `scripts/audit.py`),
  never inline. When the person you work for writes in Turkish, you answer them in
  Turkish and still write the repository in English.
- **Scan before you push.** `python scripts/audit.py` must print `0 finding(s)`. The
  pre-push hook (`git config core.hooksPath scripts/hooks`) runs it on the pushed
  commit and refuses a red one; do not bypass it with `--no-verify`.
- **A push is done when CI is green.** After pushing, check the run
  (`gh run list -L 1`); a red main is yours to fix before you say "done".
