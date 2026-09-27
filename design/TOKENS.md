# remote-ai-chat — design tokens

The whole palette and scale, in one place. There are two sets: the phone app,
drawn in a light and a dark theme, and the desktop panel, which is still on the
earlier dark-only palette. `app/src/theme.ts` mirrors the first and
`web/src/lib/theme.ts` the second; nothing in either may drift from them, and
nothing may introduce a colour that is not here.

## Phone app

Every value has a light and a dark counterpart, element for element; the app
follows the phone's appearance setting.

| role | light | dark | used for |
|---|---|---|---|
| bg | `#FBFAF8` | `#17160F` | screen background, sheets |
| card | `#FFFFFF` | `#242219` | cards, rows, menus, dialogs |
| fill | `#F1F0EB` | `#211F17` | search field, segmented track, chips, icon wells |
| line | `#ECEAE3` | `#2D2B21` | default border and separator |
| line-strong | `#DEDBD2` | `#3F3C30` | emphasised border, empty track, disabled fill |
| ink | `#1C1B18` | `#F2F0E8` | primary text, primary button, user bubble |
| on-ink | `#FBFAF8` | `#17160F` | text on ink |
| text-2 | `#3C3A33` | `#D2CFC5` | assistant text, secondary text |
| muted | `#6A685F` | `#9E9C90` | labels, mono meta |
| faint | `#9C9A8F` | `#706E63` | timestamps, placeholders, hints |
| seg-on | `#FFFFFF` | `#3F3C30` | the selected segment |
| code | `#FAF9F6` | `#1C1B13` | code blocks, table heads |
| accent | `#FF5A48` | `#FF5A48` | Allow, send, the recording dot |
| accent-text | `#FF373D` | `#FF8B72` | red as text: needs approval, archive shown |
| accent-tint | `#FFE4DD` | `#3A241C` | a toggled-on chip |
| ok / ok-bg | `#3F7A52` / `#E7F1EA` | `#6FAE82` / `#1F2D23` | success, online |
| warn / warn-bg | `#B5852B` / `#F7EFDB` | `#D9A84A` / `#2F2915` | connecting, limits, notes |
| danger / danger-bg | `#B14A33` / `#F8E3DB` | `#E0735A` / `#311E16` | errors, dangerous commands, delete |
| scrim | `rgba(28,27,22,.35)` | `rgba(0,0,0,.55)` | behind a sheet, menu or dialog |

- UI type is Inter (400/500/600, 700 unused), machine data is JetBrains Mono.
  Both ship in `app/assets/fonts`.
- Icons are Material Symbols Rounded, weight 300 unless a design says
  otherwise, cut out of the font at the optical size they are drawn at
  (`app/scripts/gen-icons.py`).
- Radius: 8 chip badge · 10 small button / segment track · 12 input · 14 card
  and primary button · 16 dialog · 18 bubble · 22 sheet · 26 composer ·
  999 pill.
- Shadows are soft and only in the light theme's sense of depth: a card rests,
  a menu floats (`0 24px 56px -16px`). Dark keeps the same geometry.

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
