# Divan — the design system

Divan is the interface the app grows into: a dashboard over several projects, a
board per project, a ticket, a branch page, a machine tab. Eleven screens on the
phone and seven on the desktop are built out of the parts recorded here, and
none of them decides again what a card is or which grey a timestamp takes.

The phone came first and is the first half of this document; **the web side is
the second half**, under "The desktop". There is one palette and it is in the
table below: both clients read the same sixteen values, because the frames
declare the same sixteen on a 390 pt phone and on a 1440 pt desktop.

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
there is no light drag frame — so there is no light counterpart to the `--s2`
of Mobile3's drag frame to extract. `#E9E6DE` is a real value of the design: it is the `--s2` of
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

The first four of the ramp are drawn together on one screen — Mobile5 S1, the
dashboard with four projects on it — and the fifth belongs to the project
Mobile7 S6 invents. All seven executor faces are drawn in a column in
Mobile11 S14, and the eighth, the one nobody has taken, only in Mobile3's drag
frame.

| | on the artboard | in code | from |
|---|---|---|---|
| project ramp | `oklch(0.48 0.07 265 / 320 / 210 / 130)`, `oklch(0.5 0.07 95)` | `#4A5D86` `#6F5076` `#226873` `#50663A` `#706332` | Mobile5 S1 · Mobile7 S6 |
| Coder | `oklch(0.46 0.1 275)` | `#48528F` | Mobile11 S14 |
| SEO | `oklch(0.5 0.09 215)` | `#007083` | Mobile11 S14 |
| Analyst | `oklch(0.48 0.07 250)` | `#3E6084` | Mobile11 S14 |
| Research | `oklch(0.47 0.1 330)` | `#7A4475` | Mobile11 S14 |
| a ticket nobody has taken | `oklch(0.6 0.1 275)` outline, `oklch(0.72 0.1 275)` mark | `#6F7BBC` / `#92A0E3` | Mobile3 Drag frame |

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

Radii, all of them off the frames: **7** a state chip on a board card · **8** a
mark, an executor's square · **9** a list row's icon well, and the selected
segment inside its track · **11** a button · **12** a board column tab, and that
track · **13** the
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
  bar, column tabs, segments, status dot, executor badge, monogram, counter,
  section header, empty state, sheet. Each names the frame it was measured off.
- `app/app/divan-gallery.tsx` — all of them on one screen, in either theme,
  each beside the name of its frame. Development builds only, reachable from
  Settings.
- `app/scripts/test-divan.cjs` — the block above, quoted, and checked both ways:
  the table is the frames', and nothing outside the table is a colour.

# The desktop

The panel in `web/` is the same design at 1440 pt. Four frame groups draw it:
Web12 W1 and W2 are the desktop dark, Web13 W3 and W4 the same two screens light,
Web14 W6 to W10 the screens that follow, and Web15 W11 to W18 the machine pages.

## The palette is the one above

Those frames open with the same block of sixteen custom properties the phone's
do, by the same names, and `web/src/lib/theme.ts` holds exactly the table at the
top of this document. Two clients, one palette; a colour that moved on the phone
moved on the desktop.

Two decimals are worth writing down. The desktop was drawn before the block
settled, so Web12 W1 and W2 carry `--line2` at `.22` and the three washes a
hundredth heavier — the same five-frame difference recorded above. The value
taken is the majority's, which on the dark side is Web14 W6's block and on the
light side Web15 W12's, and both are quoted verbatim in
`web/scripts/test-divan.mjs`.

### The three values beside the sixteen

| in code | value | read off |
|---|---|---|
| `amberRing` | `rgba(234,182,90,.3)` · `rgba(156,98,16,.35)` | Web12 W1 and W2 · Web13 W3 and W4 |
| `sLift` | `#2A2822` · `#E9E6DE` | borrowed from the phone — see below |
| `scrim` | `rgba(0,0,0,.5)` · `rgba(27,26,23,.35)` | derived — see below |
| `execLine` | `#6F7BBC` · `rgba(27,26,23,.18)` | Mobile3's drag frame · derived — see below |
| `execInk` | `#92A0E3` · `#7A756C` | Mobile3's drag frame · derived — see below |

`amberRing` is the amber drawn as a ring rather than a fill, around the panel of
an agent that is asking: `inset 0 0 0 1px` in that colour. It is a hundredth
heavier than the phone's ring, and the value in the web table is the desktop
frames' own, because that is the artboard the file is extracted from.

**`sLift` is borrowed.** Nothing is drawn in the air on a desktop artboard —
there is no lifted card and no popover surface in the four groups — so the
surface a card takes while it is being carried is the phone's: the `--s2` of
Mobile3's drag frame, and on the light side the `--s2` of Mobile4 C1. The panel
needs it in four places that predate Divan (a details panel held open, a hovered
menu row), which is why it is in the table at all.

**`scrim` is derived.** The desktop frames draw no dim: the machine drawer of
Web15 W12 is a whole page, not a panel over one. The dark side is `--sh` itself
and the light side is the same ink at `.35`, the weight the panel already dimmed
with.

**`execLine` and `execInk` are derived on the light side only.** They are the
dashed square and the mark of a ticket nobody has taken, and their dark side is
the artboard's: Mobile3's drag frame draws `1.5px dashed oklch(0.6 0.1 275)`
around `oklch(0.72 0.1 275)`, converted to sRGB the way the monograms were.
Nothing is dragged on a light artboard, so the light side has no frame — and a
dark-theme indigo left on a light page reads at 2.3:1, which is how this pair
was found at all. The light side is therefore the placeholder the desktop frames
*do* draw, in both themes: Web12 W2's "+ Add branch" card, `1.5px dashed
var(--line2)` with `var(--ink3)` on it.

Three derived values on the web side, then, and one borrowed one, and a check
holds this claim and the code's own `DERIVED` and `BORROWED` to each other.

### Colours that are not the theme's

A photo brings its own background and does not follow the page, so the lightbox
and the remote screen are drawn in `MEDIA` — a black backdrop, white chrome over
it — and that is the whole of the exception. Project monograms and executor
squares bring their own colour the same way, out of the ramp above; white sits on
every one of them.

## How a colour reaches the screen

Nothing in the panel reads a value out of the table. Both themes are written into
the document as custom properties, and what a component holds is a reference:
`T.ink3` is the string `var(--dv-ink3)`. `[data-theme="dark"]` and
`[data-theme="light"]` are the two rules; the switch writes that attribute on
`<html>`, and a gallery holding both themes up against the frames writes it on a
`<div>`.

This is what makes the desktop's two themes free. One render is correct in
either, a theme change is one attribute and no React render at all, and there is
no second copy of the palette to drift from this document.

**The switch** follows the computer by default, can be set by hand, and is
remembered in `localStorage` under `rac.theme`. While it is following, the
computer changing its mind at sunset is followed too; once a person has chosen,
it is not. The resolved theme is on the document before the first paint, so the
panel never opens in the wrong one and flashes. It is offered in
Settings › Appearance and in the command palette.

## Where the older palette's names landed

Twenty-three files speak a vocabulary that predates Divan — `surface`, `mute`,
`accent`, `hair` — and this ticket did not rewrite them. `C` is that vocabulary
with every name now pointing at one of the tokens, which is why those screens
follow both themes without a line of theirs changing. Most are a rename
(`surface` is `--s1`, `border` is `--line`, `warn`/`ok`/`danger` are
`--amber`/`--run`/`--red`). Six needed a decision:

- **`mute` and `faint` are both `--ink3`**, the same collapse the phone made and
  for the same reason: the frames draw three tiers of text and put mono meta,
  timestamps and placeholders in one of them.
- **`accent` is `--red`.** The frames give a primary button `--ink` and keep red
  for trouble; the panel's accent is the colour of Allow, of the recording dot
  and of delete, which is that red.
- **`accentSoft` — the panel's "this one is selected" — is `--ink`.** The frames
  draw a selected nav item, chip or tab in the primary ink and the rest in
  `--ink3`; nothing in them is a lighter accent.
- **`info` is `--run`.** The frames draw no blue at all. What the panel painted
  blue is work in progress, and in Divan that is the green — which also keeps the
  two warm colours the only warm things on a wall of twenty tiles, which is why
  the blue was there.
- **`hair` is `--line`.** It was a near-black used as a separator in eleven
  places, which is what a hairline is. The four places that used it as a fill now
  say `bg`, the tone the frames put inside a card.
- **`surface3` is `--sLift`**, the surface of something being held open.

Each tone also has a wash and an outline (`warnBg`, `warnLine`), because the
frames draw all three: Web14 W10's roster has a green chip on `--runBg`, a red
chip outlined in `inset 0 0 0 1px var(--red)`, and a grey one on `--s2`. That is
what replaced the sixty colours the screens used to thin by hand.

## Form on the desktop

The desktop repeats its own numbers, and they are not the phone's. Radii: **7** a
status chip · **8** an executor's square · **9** a row's icon well, a small
button, the selected tab inside its track · **10** a top-bar item, a side-panel
row · **11** the button a card ends on · **12** a tab strip's track · **14** a
counter tile, a ticket card · **16** a card, a board column, a pill, the drawer ·
**20** the composer inside a panel · **26** the command bar. And **10** twice
over: a top-bar item and a side-panel row, and the inset block a worker quotes
its figures in inside a chat session (Web12 W1).

Heights: top bar **58** · a nav item **34** · a pill **32** · a button **34**, or
**32** where it is a row's own action · an executor's square **28** · a
monogram **34** on a card and **46** in a page head · a row's well **32** with a
**17** glyph · a status dot **7** · the side panel **260** with **40** pt rows.

The window a question opens in, and what stands beside it (Web12 W1, Web13 W3):
the session **350 × 500** with a **40** pt composer in it, a minimised one in the
dock **136 × 44** and the `+1` after them **44 × 44**, and the command bar across
the bottom **420 × 52** with a **36** pt round send in it. W1 draws its *second*
window a size down (**320 × 440**) to say which of the two is being read; the
panel opens both at the first size, because on this end either of the two can be
the one you answer.

Shadows, as the frames write them: `0 0 0 1px var(--line)` is the ring a card
wears instead of a border — 56 times across the four groups — then
`0 1px 2px var(--sh)` for a lift, `0 0 0 1px var(--line2), 0 10px 24px var(--sh)`
for a popover and the same at `14px 36px` for the drawer — and `0 24px 60px
var(--sh)` under a window standing over the page, whose *ring* is not in the list
because which colour that ring is, is what the window is saying.

Two things W1 draws that the panel does not, and one it draws differently:

- **the sparkline** beside a product's figure — fourteen bars of `var(--line2)`.
  Nothing carries a day-by-day history of a repository, so the panel draws the two
  numbers that exist (what landed in seven days, and when it last moved) and no
  chart of numbers that do not. A figure with no source is not drawn; a
  placeholder is worse than a gap.
- **what a product earns**, which the frames put at the top of a card. No source
  is connected, so there is no line for it.
- **the send arrow** in the command bar, which the frame draws in `var(--bg)` on
  the `var(--line2)` fill — an empty composer whose send is not available, and
  2.2:1 in the dark, 1.6:1 in the light. Nothing in this panel is drawn at a
  weight that cannot be read, so the arrow takes `--ink` on the same fill.

Type is the panel's own faces at the frames' sizes and weights, mono for numbers,
times, counts and identifiers and never for sentences. The frames are drawn in
Geist; the panel does not ship it.

## Where it lives

- `web/src/lib/theme.ts` — the sixteen in both themes, the three beside them, the
  `--dv-*` rules, the switch, the marks, the radii, the heights, the shadows, and
  `C`, the older vocabulary pointed at the same table.
- `web/src/ui/divan.tsx` — the parts: card, row, pill, tab, column tab, status
  dot, executor badge, counter, section header, empty state, side panel, note,
  the mono tag in a card's corner, a line of the agent roster, the window a
  question opens in (panel, its head, the block it quotes figures in, its
  composer), the dock a minimised one waits in, the command bar, and the
  button and state mark the frames draw beside them; the three-slot block of
  numbers under a name, the line with a clock in front of it, a field of a
  details panel and the field of a card being typed into rather than read, which
  are the four Web14's own screens repeat; the table the Machine drawer is made
  of — the card with a grid in it, the mono cell a figure stands in and the
  name-over-a-line that opens a row — which Web15 W12, W13 and W16 draw three
  times as one construction, with the slider a threshold is set on (W11) and the
  segmented choice a setting is answered with (W18); and the top bar — the bar
  itself, a nav item, the rule between the places and the chips, and the mono
  chip and stamp at its far end. Each names the frame it was measured off. The
  bar is the one the thirteen later frames draw (`height:58px`, the third place
  an item beside the other two) rather than the 56 pt bar of Web12 W1 and Web13
  W3, which is the same bar one step earlier with that place set as a word at
  the end; `SIZE.topBar`, `SIZE.navItem` and `RADIUS.nav` are the thirteen's. The desktop frames draw no empty screen, so that one part is the
  phone's Mobile7 S6 at desktop sizes, and says so where it is defined.
- `web/src/ui/kit.tsx` — the older set the existing screens are built from. Not
  being replaced in this ticket, and not to be mixed with the parts above in one
  file.
- `web/scripts/divan-gallery.tsx` — every part in both themes, each beside the
  name of its frame. Rendered to `.test-build/divan/gallery.html` by the check
  below, which opens in a browser with no daemon and no pairing.
- `web/scripts/test-divan.mjs` — folded into `cd web && npm test`. The two blocks
  quoted, the table held to them, every part rendered and every screen with it —
  twice, once with nothing paired and once with a computer on the other end, plus
  the panels a screen opens over itself, the chat with a chat open in it, the two
  walls with cards on them, and the Appearance section — and the colours read back off the markup; the switch
  driven through the states a browser can put it in; and this document held to
  the code's own lists. It also holds the one rule a palette cannot enforce by
  itself: `onAccent` and `onWarn` are the two "text on a filled colour" values
  and may only be drawn on a filled colour. White on `--s2` is legal in every
  other check and is an empty-looking button on a light page. And it measures
  every pair of tokens a component puts together — this ink on that surface,
  composited through whatever wash is between them — in both themes, at 3:1.
  Opacity is resolved rather than stepped over — an element is painted at its
  own times every one above it — and what it cannot work out at all is counted
  and asserted to be nothing, because a colour a check quietly skips is a colour
  nobody is checking.
- `web/scripts/test-shell.mjs` — also in `npm test`, and about the shape the
  parts are arranged into rather than the palette: the three places, the project
  bar, the switch, and every screen of the shell drawn in five states of the
  fleet. Its one colour claim is the one the switch rests on — the two themes
  produce the same markup, because nothing is a value and everything is a
  reference.
- `web/scripts/test-drive.mjs` — the fourth in `npm test`: the panel mounted in
  a document and pressed. Its one colour claim is the switch's, driven rather
  than reasoned about — the document's theme attribute moves and the markup
  under the bar does not change, which is why a theme costs no render.
- `web/scripts/test-divan-ui.mjs` — the same page in a real browser, not in
  `npm test` because it needs Chrome. It reads back every colour the browser
  actually resolved, and then measures every pair it painted: each piece of text
  and each glyph against what is behind it, composited through whatever
  translucency and opacity is in the way, held to 3:1. Membership in the palette
  says a colour is the design's; only this says the pair can be read.

The chat keeps the shape it has. It follows the new palette because everything
does, but nothing in it was restyled and it is not built out of the parts above.

A disagreement about any value in this document is settled by the artboard.
