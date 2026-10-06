# Notices

The MIT licence in [LICENSE](LICENSE) covers the code in this repository. It
does not, and cannot, cover the things below.

## Trademarks

The app ships no vendor logos: a chat or an account is marked with two letters
of the tool's name (`Cl`, `Cx`), drawn in the app's own type.

This project is not affiliated with Anthropic or OpenAI. "Claude", "Claude
Code", "OpenAI" and "Codex" are their marks, not ours.

## Third-party code this project reaches for at runtime

Neither of these is vendored; both are downloaded by the user's own machine when
the user asks for them.

- **`claude` and `codex`** are installed from npm
  (`@anthropic-ai/claude-code`, `@openai/codex`) and run under the user's own
  sign-in. Their licences are their own.
- **The agent store** lists definitions from public GitHub repositories —
  `daemon/remote_ai_chat/agents.py` holds the list of sources. Installing one
  downloads markdown into the tool's agents folder; nothing is executed at
  install time, and the text carries whatever licence its source repository
  gives it. `daemon/remote_ai_chat/agent-store-snapshot.json` is a cached
  *listing* of file paths from those repositories, used so that the store is not
  empty when GitHub's API is rate-limited. It contains no third-party content.

## Fonts and icons the app ships

- **Geist** and **Geist Mono** (`app/assets/fonts/*.ttf`) are licensed under
  the SIL Open Font License 1.1; their licence texts sit next to them
  (`OFL-Geist.txt`, `OFL-GeistMono.txt`). The web panel loads the same two
  families from Google Fonts.
- **Material Symbols Rounded** by Google is licensed under the Apache License
  2.0. The app does not ship the font: `app/scripts/gen-icons.py` cuts the
  glyphs it uses out of it and `app/src/icons.gen.ts` holds them as SVG paths.
