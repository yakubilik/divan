# divan — design tokens

Two sets: the phone app, drawn in a light and a dark theme, and the desktop
panel, which is still on the earlier dark-only palette. The phone's is Divan's
and lives in [divan/TOKENS.md](divan/TOKENS.md); `web/src/lib/theme.ts` mirrors
the second. Nothing in either may drift, and nothing may introduce a colour that
is not written down.

## Phone app

The phone app's palette is Divan's, and it is written down in
[divan/TOKENS.md](divan/TOKENS.md) — each token read out of the design system's
token sheet, `web/src/styles/divan-tokens.css`, Night and Day.
`app/src/tokens.ts` is that table and `app/src/theme.ts` derives everything else
from it, so there is exactly one place a colour can come from.

- UI type is Geist (400/500/600/700), machine data is Geist Mono. Both ship in
  `app/assets/fonts`.
- Icons are Material Symbols Rounded, weight 300 unless a design says
  otherwise, cut out of the font at the optical size they are drawn at
  (`app/scripts/gen-icons.py`).
- Radii, heights and the rules the drawings keep are in divan/TOKENS.md too.

## Desktop panel

| role | value | used for |
|---|---|---|
| bg | `#0F0E0C` | app background |
| bg-deep | `#060605` | behind a modal / the very bottom |
| surface | `#1A1815` | card, sidebar, chip, composer |
| surface-2 | `#2A2722` | user bubble, raised button |
| surface-3 | `#201D1A` | hover / selected row |
| surface-hair | `#141311` | thin separator band |
| text | `#F1ECE3` | primary text |
| text-2 | `#DDD6CB` | secondary text |
| text-mute | `#8C8578` | labels, mono meta, inactive icons |
| text-faint | `#6E6860` | disabled |
| accent | `#C2522D` | the brand clay — send, active dot, selected |
| accent-hover | `#A3441F` | link hover |
| accent-soft | `#E8A38A` | text on top of accent |
| accent-tint | `rgba(194,82,45,0.16)` | selected row background |
| accent-ring | `rgba(194,82,45,0.32)` | selected border |
| ok | `#5C7E4F` | successful tool, online |
| warn | `#D8A657` | awaiting approval, limit |
| danger | `#E0533F` | error, dangerous command |
| info | `#7D9AD1` | codex / neutral badge |
| border | `rgba(241,236,227,0.08)` | default border |
| border-strong | `rgba(241,236,227,0.12)` | emphasised border |

### Typography
- UI: `-apple-system, "SF Pro Text", system-ui, sans-serif`
- Mono: `ui-monospace, "SF Mono", Menlo, monospace` → paths, tool names,
  numbers, tokens/$
- Scale (desktop, 1–2px smaller than mobile): 11/12 mono meta · 13 secondary ·
  14 body · 15 row title · 17 screen title · 22 empty-state title
- Weight: 400 body, 600 title/chip. Never 700.

### Form
- Radius: 6 badge · 8 small button · 10 input · 12 card / tool card · 14 media ·
  16–18 chip/bubble · 26 composer shell
- Borders are always 1px `border`. No shadows — this is a dark theme and
  separation is a border.
- Row heights: list row 56–64px, tool card 40px, chip 28–32px.
- Spacing rhythm is a multiple of 4: 4·8·12·16·20·24.

## Rules
- Desktop is information-dense. The 44px touch targets from mobile drop to
  28–32px.
- Mono is for machine data only; never for sentences.
- State is always colour *and* shape (a dot, an icon). Never colour alone.
