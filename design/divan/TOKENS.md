# Divan — the mobile design system

Divan is the interface the phone app grows into: a dashboard over several
projects, a board per project, a ticket, a branch page, a machine tab. Eleven
screens are built out of the parts recorded here, and none of them decides again
what a card is or which grey a timestamp takes.

This is not a re-skin. The palette changed, both themes are first-class, and the
chat screens keep the shape they have.

## Where the values come from

The drawings live outside this repository — they are private and this repository
is public — as one HTML file per screen group, `frames/INDEX.json` listing them.
Every frame opens its phone with the same block of CSS custom properties, and
**those sixteen declarations are the palette**. Nothing here was chosen.

The whole block is carried by **Mobile6 S3** ('Waiting on you') on the dark side
and **Mobile11 S16** ('Machine drawer · findable, forgettable · light') on the
light one; open either and every row of the table below is in its `style`
attribute, by that name. Twenty-nine more frames carry the same block — the
count is under the table — so any of those would do as well.

| in code | dark | light | used for |
|---|---|---|---|
| `bg` | `#131210` | `#F5F3EE` | the screen, and the tab bar under it |
| `s1` | `#1C1B18` | `#FFFFFF` | a card, a row, a chip, the machine line |
| `s2` | `#26241F` | `#ECE9E2` | a selected tab, an icon well, the reader's own bubble |
| `line` | `rgba(236,232,225,.08)` | `rgba(27,26,23,.09)` | a separator, the rule under a tab strip |
| `line2` | `rgba(236,232,225,.2)` | `rgba(27,26,23,.18)` | an emphasised line, an outline button, an unfilled track |
| `ink` | `#EDE9E2` | `#1B1A17` | primary text, and the button drawn in it |
| `ink2` | `#A9A499` | `#5C5850` | a description, a body line under a title |
| `ink3` | `#8C877E` | `#7A756C` | mono meta, a timestamp, a placeholder, a chevron |
| `amber` | `#EAB65A` | `#9C6210` | needs you |
| `amberBg` | `rgba(234,182,90,.11)` | `rgba(214,150,40,.14)` | behind it |
| `onAmber` | `#1A1609` | `#FFFFFF` | text on top of amber |
| `red` | `#EE6D55` | `#C2412B` | stuck, failed |
| `redBg` | `rgba(238,109,85,.12)` | `rgba(194,65,43,.1)` | behind it |
| `run` | `#7CC6A6` | `#2F8067` | running, healthy, done |
| `runBg` | `rgba(124,198,166,.1)` | `rgba(47,128,103,.1)` | behind it, and behind a drop target |
| `sh` | `rgba(0,0,0,.5)` | `rgba(27,26,23,.12)` | what a shadow is made of |

Seventeen dark frames and fourteen light ones declare all sixteen, and on each
side they are one block, character for character. Six more declare only the
first fourteen — `--onAmber` and `--sh` enter the set later — and agree with
every one of them: Mobile1 V1 and V2 and Mobile2 V4 on the dark side, Mobile1 V3
and Web13 W3 and W4 on the light.

Five frames differ, and only in the last decimal of a wash or a line: Mobile2
V5, Mobile3's drag frame and Web12 W1 and W2 carry `--line2` at `.22` and the
three washes a hundredth heavier, and Mobile4 C1 carries its own `--s2` and
`--line2`. The majority value is the one that was taken; the two `--s2` that are
not the majority turn out to be a tone of their own, which is the next table.

### Three values taken from elsewhere in the frames

Not everything the parts need is one of the sixteen. These three are read off a
frame all the same — a different frame's `--s2`, or the ring on a card — and
they are listed apart because a reviewer looking for them in the block above
will not find them.

| in code | value | read off |
|---|---|---|
| `sLift` dark | `#2A2822` | Mobile3 'Drag frame', `--s2` — the card being dragged, which is the role exactly |
| `sLift` light | `#E9E6DE` | Mobile4 C1, `--s2` — see below |
| `amberRing` dark | `rgba(234,182,90,.28)` | Mobile1 V1 and Mobile2 V4, `box-shadow:inset 0 0 0 1px …` around a card that is asking |
| `amberRing` light | `rgba(156,98,16,.35)` | Web13 W3 and W4, the same ring around the asking agent's panel |

**The light `sLift` borrows its role.** Nothing is dragged on a light artboard —
there is no light drag frame — so there is no light counterpart to Mobile3's
`--s2` to extract. `#E9E6DE` is a real value of the design: it is the `--s2` of
Mobile4 C1, the light chat, and the only raised light surface the frames draw.
It is used here for the card you are holding, which is a role the artboard does
not itself assign to it. That is the one provenance claim in this document that
is a judgement rather than a reading, and it is why it is written down.

`app/src/tokens.ts` is that table, once. `app/src/theme.ts` no longer writes a
palette of its own — the `Palette` the older screens speak is derived from these
sixteen, so there is no second table to drift from this one.

### The two values that were not in a frame

The phone frames draw no sheet: every Divan screen on the phone is a whole page,
and the machine drawer is a drawer only on the desktop. So two things had to be
derived, and both say so where they are defined:

- **`scrim`**, behind a sheet — the dark side is `--sh` itself; the light side is
  the same ink at `.35`, the weight the app already dimmed with.
- **`veil`**, the page showing faintly through a drop target — the page's own
  colour at `.92`.

There are two, and a check holds this list and the code's own to each other, so
a third cannot appear in one without the other.

### The marks

Project monograms and executor badges are written on the artboard in `oklch`,
which React Native cannot read, so each was converted to the sRGB a browser would
show (CSS Color 4 gamut mapping; only one of them was outside the gamut at all,
and it clips to the same value).

| | on the artboard | in code | from |
|---|---|---|---|
| project ramp | `oklch(0.48 0.07 265 / 320 / 210 / 130)`, `oklch(0.5 0.07 95)` | `#4A5D86` `#6F5076` `#226873` `#50663A` `#706332` | Mobile1 V1 · Mobile7 S6 |
| Coder | `oklch(0.46 0.1 275)` | `#48528F` | Mobile11 `EXS` |
| SEO | `oklch(0.5 0.09 215)` | `#007083` | Mobile11 `EXS` |
| Analyst | `oklch(0.48 0.07 250)` | `#3E6084` | Mobile11 `EXS` |
| Research | `oklch(0.47 0.1 330)` | `#7A4475` | Mobile11 `EXS` |
| a ticket nobody has taken | `oklch(0.6 0.1 275)` outline, `oklch(0.72 0.1 275)` mark | `#6F7BBC` / `#92A0E3` | Mobile3 |

Divan and you take the page's own tones rather than a colour: Divan is `ink` on
`s2` behind a `line2` ring, you are `bg` on `ink`. White sits on every other one,
and that white belongs to the mark rather than to the theme — a coloured square
brings its own background and does not follow the page.

### Where the older palette's names landed

The app's screens speak an older vocabulary (`card`, `fill`, `muted`, `accent`).
Most of it is a token under a different name — `card` is `s1`, `fill` is `s2`,
`lineStrong` is `line2`, `warn`/`ok`/`danger` are `amber`/`run`/`red`. Four
needed a decision:

- **`muted` and `faint` both became `ink3`.** The app grew four tiers of text.
  The frames draw three, and they put mono meta, timestamps, placeholders and a
  row's chevron in the same one. Collapsing two is the design's own choice, made
  in the place the design makes it.
- **`segOn` is `s1` on an `s2` track.** The frames have no segmented control, but
  they do have a selected column tab: a card sitting in a well. The segment is
  drawn the same way, in both themes.
- **`accent` is `red`.** The frames give the send button `ink` and keep red for
  trouble; the app's accent is the colour of Allow, of the recording dot and of
  delete, which is the same red.
- **shadows.** The frames use exactly three — `0 1px 2px var(--sh)` for a lift,
  `0 0 0 1px var(--line2), 0 10px 24px var(--sh)` for a popover, and the same at
  `14px 36px` for a drawer. The palette's seven shadow roles map onto those
  three and nothing else.

Collapsing two text tiers into one is the decision most likely to cost
legibility, so it was measured. Against the surface it is drawn on, `ink3` —
the tier `muted` and `faint` now share — reads at 5.2:1 on the dark page and
4.1:1 on the light one, and at worst 3.8:1 where light `ink3` sits on `s2`.
`ink2` never falls below 5.8:1 and `ink` never below 12.8:1. The three accent
colours clear 3.9:1 everywhere, and the one pair the frames spell out —
`onAmber` on `amber` — reads at 9.8:1 dark and 5.0:1 light.

## Form

Radii, all of them off the frames: **8** a mark, an executor's square · **9** a
list row's icon well · **11** a button · **12** a board column tab · **13** the
taller button of an empty state · **14** a counter tile, a ticket card · **16** a
card · **22** a sheet · **999** a pill, the tab bar's icon well.

Heights: pill **34** · board column tab **46** · tab bar **84**, its selected
icon well **60×32** with a **22** glyph · executor badge **28** · project
monogram **32** · list-row well **32** with a **17** glyph · status dot **7–8**.

Type is the app's own — Inter for text, JetBrains Mono for machine data. The
frames are drawn in Geist and Geist Mono, which the app does not ship; the sizes,
weights and letter-spacings were taken from them, the faces were not. Mono is for
numbers, times, counts and identifiers, never for sentences.

## The rules the frames keep

**A state is never colour alone.** `■` stuck, `?` asking, `●` running, `✓` done,
`○` yours — the character is drawn next to the colour everywhere the frames use
one, which is what keeps the board readable to an eye that does not separate red
from green.

**Zero is grey.** A counter at zero drops its tint and its colour; the calm
morning screen is the same four tiles as the loud one, and the difference is only
that.

**An empty screen keeps its structure.** A new board still shows its four column
tabs, at zero, and the middle of the screen is a sentence and two buttons —
not a mark in a circle and an apology.

**Nothing starts by itself.** Every empty state says in mono what will not happen
without a person moving something.

## Where it lives

- `app/src/tokens.ts` — the sixteen, the ramps, the radii, the heights, and the
  `Palette` derived from them.
- `app/src/components/divan.tsx` — the parts: card, list row, pill, button, tab
  bar, column tabs, status dot, executor badge, monogram, counter, section
  header, empty state, sheet. Each names the frame it was measured off.
- `app/app/divan-gallery.tsx` — all of them on one screen, in either theme,
  each beside the name of its frame. Development builds only, reachable from
  Settings.
- `app/scripts/test-divan.cjs` — the block above, quoted, and checked both ways:
  the table is the frames', and nothing outside the table is a colour.

A disagreement about any value in this document is settled by the artboard.
