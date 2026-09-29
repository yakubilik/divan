/** The shell the three places stand in: the top bar, the project chips across
 *  it, and the switch between the two themes.
 *
 *  What a place *is* — which screens are in it, what the Machine list holds, what
 *  the project bar says, where the chosen product is kept — is in
 *  `src/lib/shell.ts`, where a check can reach it. This is the drawing of it, out
 *  of the design system's own parts and nothing else (`ui/divan.tsx`): a bar,
 *  three nav items, a rule, a run of pills, a mono stamp and a mono chip.
 *
 *  Web12 W1 and Web13 W3 are this bar in the two themes, and the theme is the
 *  whole of what differs between them — every colour here is a token reference,
 *  so the switch at the far end is one attribute on `<html>` and no render of
 *  the page at all. Nothing in this file reads a colour in JavaScript.
 */
import { setThemeChoice, useTheme } from '../lib/theme';
import { BarChip, BarDivider, BarStamp, NavItem, Pill, TopBar } from '../ui/divan';
import { P, glyph } from '../ui/kit';
import {
  PLACES, PLACE_ICON, PLACE_LABEL, PLACE_VIEW, placeOf, type Chip, type Place, type View,
} from '../lib/shell';
import type { State } from '../lib/theme';

/** The bar's own clock: Web12 W1's `Mon 28 Sep · 23:14`. The date is the day it
 *  is read on, in the frame's own order, and the time is to the minute — a
 *  second hand in a top bar is a thing that moves for no reason. */
export function stamp(now: number): string {
  const d = new Date(now * 1000);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    + ` · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** The chips, which are in the bar where the frames draw them: over the
 *  Dashboard and the pages under it (Web12 W1, Web14 W6), and not over the
 *  Machine pages, whose bar ends in what the fleet is doing instead (Web15).
 *
 *  It never wraps — a second row of chips would move the bar's height — and it
 *  scrolls sideways when there are more products than room, which is what the
 *  frame does with its fifth chip. */
function ProjectBar({ chips, onSelect }: {
  chips: Chip[];
  onSelect: (key: string | null) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
      overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none',
    }}>
      {chips.map((chip) => (
        <Pill
          key={chip.key ?? '*'} label={chip.label} dot={chip.state}
          face={chip.selected ? 'ink' : 'surface'}
          title={chip.key ? `Everything on ${chip.label}` : 'Every product'}
          onClick={() => onSelect(chip.key)}
        />
      ))}
    </div>
  );
}

/** The switch, at the end of the bar where Web15 puts what the panel has to say
 *  for itself. It is labelled with the theme it will give you — the same way the
 *  command palette offers the one that is not on screen — and it chooses by
 *  hand, so the third answer (follow this computer) stays where there is room to
 *  explain it, in Settings › Appearance. */
export function ThemeSwitch() {
  const { scheme } = useTheme();
  const other = scheme === 'dark' ? 'light' : 'dark';
  return (
    <BarChip
      icon={other === 'light' ? P.sun : P.moon}
      label={other === 'light' ? 'Light' : 'Dark'}
      title={`Switch to the ${other} theme`}
      onClick={() => setThemeChoice(other)}
    />
  );
}

/** A place: the bar, and the place's own content under it. */
export function Shell({ view, onView, now, chips, dots, onProject, children }: {
  view: View;
  onView: (view: View) => void;
  /** The clock the merged view was worked out at, so that the bar and the page
   *  under it cannot age the same machine to two different minutes. */
  now: number;
  /** The project bar, where this place has one. */
  chips?: Chip[] | null;
  /** Which places have something in them that wants a person. */
  dots?: Partial<Record<Place, State>>;
  onProject?: (key: string | null) => void;
  children?: React.ReactNode;
}) {
  const here = placeOf(view);
  const bar = chips?.length ? chips : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar>
        {PLACES.map((place: Place) => (
          <NavItem
            key={place} label={PLACE_LABEL[place]} icon={glyph(PLACE_ICON[place])}
            on={place === here} dot={dots?.[place] ?? null}
            title={place === here ? undefined : `Go to ${PLACE_LABEL[place]}`}
            // A place you are already in is not re-entered: it would drop the
            // Machine page you are reading for the first one in the list.
            onClick={() => { if (place !== here) onView(PLACE_VIEW[place]); }}
          />
        ))}
        {!!bar && <BarDivider />}
        {!!bar && <ProjectBar chips={bar} onSelect={(key) => onProject?.(key)} />}
        <span style={{ marginLeft: 'auto' }} />
        <BarStamp>{stamp(now)}</BarStamp>
        <ThemeSwitch />
      </TopBar>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
