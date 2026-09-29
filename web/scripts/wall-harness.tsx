/** The wall's columns, on their own, with nothing behind them.
 *
 *  Built and driven by `scripts/test-wall-ui.mjs`. What that check is about is
 *  the layout — how many columns there are at a given width, and whether
 *  anything can be dragged sideways — and layout is the one thing that only
 *  exists inside a browser.
 *
 *  The cards are the fixture's, so what is asserted here and what `npm test`
 *  asserts about the same tickets are the same tickets.
 */
import { createRoot } from 'react-dom/client';
import { Wall } from '../src/screens/Ustabasi';
import { groupByProject } from '../src/lib/ustabasi';
import { NOW, wall } from './ticket-fixture.js';
import { themeCss } from '../src/lib/theme';

// No App behind it, so the palette is written into the page here.
document.documentElement.dataset.theme = 'dark';
const sheet = document.createElement('style');
sheet.textContent = themeCss();
document.head.appendChild(sheet);

createRoot(document.getElementById('root')!).render(
  <Wall groups={groupByProject(wall() as any)} now={NOW} onOpen={() => {}} />,
);
