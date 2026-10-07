# Divan — the design system

Divan's palette, type and corners come from one file: the design system's token
sheet, `divan-tokens.css`, approved on 7 Oct 2026. It ships in this repository
as `web/src/styles/divan-tokens.css`, beside the component sheet
`web/src/styles/divan-components.css`. Both are the handover's own files; the
only edit is that every `backdrop-filter` declaration was taken out (the sheet
already set the blur to `0px` and switched it off — the surfaces are flat — so
nothing on screen changes, and no blur can come back by accident).

Both clients read the same values. The web panel loads the two sheets and puts
`class="dv-root dv-ambient"` and `data-theme` on its app root; the phone holds
the same values as a theme object. **Night is the default**; Day is first-class.
On the web the top bar's switch flips between them and the choice is remembered
in this browser; the phone follows the system setting.

## The tokens and where each comes from

The panel and the app kept the token names their screens already speak (`bg`,
`s1`, `ink3`…). Each is now one custom property of the sheet, the same one on
both sides, and both tables are checked against the parsed sheet. Where a
property holds a shadow, the token is the colour of its last layer.

| in code | from | Night | Day | role |
|---|---|---|---|---|
| `bg` | `--canvas` | `#18191c` | `#f1f1ef` | the page |
| `s1` | `--glass-1` | `#202125` | `#fafaf8` | a card, a tile, a list |
| `s2` | `--glass-2` | `#28292d` | `#ffffff` | hover, a selected segment, a monogram's ground |
| `sLift` | `--glass-strong` | `#232428` | `#ffffff` | the composer, something held open over the page |
| `line` | `--glass-edge` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.07)` | the 1px edge every surface wears |
| `line2` | `--hairline` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.065)` | a separator, an unfilled track, the neutral chip fill |
| `ink` | `--ink` | `#ededeb` | `#0b0b0c` | primary text, the primary fill |
| `onInk` | `--on-ink` | `#18191c` | `#f7f7f5` | text on an ink fill |
| `ink2` | `--ink-2` | `#b3b3ae` | `#4a4a46` | secondary text |
| `ink3` | `--ink-3` | `#919189` | `#696964` | mono meta, timestamps, placeholders |
| `amber` | `--amber` | `#e6b261` | `#8a560c` | needs you — the only accent |
| `amberBg` | `--amber-wash` | `rgba(230,178,97,0.14)` | `rgba(200,140,40,0.14)` | behind it |
| `onAmber` | `--on-amber` | `#1a140b` | `#ffffff` | text on amber |
| `amberRing` | `--amber` | `#e6b261` | `#8a560c` | the edge of a card that is asking |
| `red` | `--red` | `#ec7a62` | `#b3381e` | stuck, failed, unreachable |
| `redBg` | `--hairline` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.065)` | behind a red word |
| `run` | `--run` | `#7ccaa6` | `#2a7560` | running, healthy |
| `runBg` | `--hairline` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.065)` | behind a green word |
| `sh` | `--shadow-float` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.26)` | what a shadow is made of |
| `scrim` | `--shadow-float` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.26)` | behind a modal or a sheet (web) |
| `execLine` | `--hairline` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.065)` | the dashed square of a ticket nobody has taken (web) |
| `execInk` | `--ink-3` | `#919189` | `#696964` | the mark inside it (web) |

Decisions in that table, none of them a new colour:

- **`redBg` and `runBg` are `--hairline`.** The sheet has no red or green wash
  because red and green are a dot or a word and never a fill; `.dv-status`
  draws every state but "asking" on `--hairline`. The tokens survive so the
  older screens keep drawing, on the neutral fill.
- **`amberRing` is `--amber` itself.** The design draws an asking card's edge
  in the amber tone.
- **`sLift` is `--glass-strong`**, the one surface the design raises.
- **`sh` and `scrim` are the long fall of `--shadow-float`.**
- **`execLine` and `execInk` are `--hairline` and `--ink-3`**, the pair the
  dashed "add" chip is drawn in. The indigo they had was a colour that did not
  mean a state.

### Derived values

| in code | kind | Night | Day | why |
|---|---|---|---|---|
| `veil` | derived | `rgba(24,25,28,.92)` | `rgba(241,241,239,.92)` | the phone's page showing through behind the board's drop target: `--canvas` at .92, a role the sheet has no property for |

## The older vocabulary

Both clients' older screens speak a second set of names. They are the table
above under other names, unchanged except for one:

- **`accent` on the web is `--ink`, with `--on-ink` on it** (`C.accent`,
  `C.onAccent`). It is the filled control — a primary button, send, a switch
  thrown on — and in the design that is the ink fill (`.dv-btn--primary`,
  `.dv-send`). It used to be red, and white on the new red reads at 2.8:1.
- On the phone `accent` stays `red` for now: the chat screens that use it are
  rebuilt in a later step.
- `muted` and `faint` are both `ink3`; `card` is `s1`, `fill` is `s2`,
  `warn`/`ok`/`danger` are `amber`/`run`/`red`.

## Monograms

Colourless on both platforms: the letter in `ink` on `s2`, inside the 1px
`line`, on the `sm` corner — `.dv-mono`. Projects are told apart by name. The
old five-hue ramp is gone; `monogram()` returns the neutral surface for every
name.

## Type

**Geist** for text and **Geist Mono** for data — times, counts, machine names,
identifiers; a sentence is never mono. The web panel loads both from Google
Fonts through `divan-components.css` and puts Geist on `body`; the phone bundles
the static files in `app/assets/fonts` (Regular, Medium, SemiBold, Bold; Mono
Regular, Medium, SemiBold) under the SIL Open Font License (`OFL-Geist.txt`,
`OFL-GeistMono.txt`).

## Form

Corners: **sm 10** · **md 16** · **lg 22** · **xl 28** · **pill 999**. Every
older radius role on both clients lands on one of them: a small mark, a well, a
nav item → sm; a card, a tile, a tab → md; a sheet, a chat bubble → lg; the
command bar, the composer → xl; a chip, a button, a pill → pill.

Spacing is in fours. No `backdrop-filter`, no `BlurView`: surfaces are flat and
opaque.

## Where it lives

- `web/src/styles/divan-tokens.css`, `web/src/styles/divan-components.css` — the
  two sheets, imported tokens first from `web/src/main.tsx`.
- `web/src/lib/theme.ts` — `DARK`, `LIGHT` and `SOURCE`, the `--dv-*` rules
  every existing screen reads, the switch (Night unless a choice is stored), the
  radii, the shadows, and `C`.
- `web/src/ui/divan.tsx` — the parts the web screens are built from.
- `web/scripts/divan-gallery.tsx` — every part in both themes.
- `web/scripts/test-divan.mjs` — parses `divan-tokens.css` and holds both
  tables to it, renders every part and screen and reads the colours back, greps
  `web/src` for a backdrop filter, and holds this document to `SOURCE`.
- `web/scripts/test-theme-ui.mjs` — the built panel in a real browser: the app
  root's class and `data-theme`, the switch pressed and reloaded, Night with
  nothing stored, and Geist and Geist Mono loaded and applied.
- `app/src/tokens.ts` — the same `DARK`, `LIGHT` and `SOURCE` for the phone,
  the radii, and the `Palette` the screens read.
- `app/src/theme.ts` — `FONTS` and `family()`.
- `app/scripts/test-divan.cjs` — parses the web copy of `divan-tokens.css` and
  holds the phone's tables to it, and checks the fonts and that no blur is
  imported.
