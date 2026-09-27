# design

Every screen in this project was drawn before it was built. What survives here
is the part that the code still has to obey: the tokens.

[TOKENS.md](TOKENS.md) is the whole design system — colour, type scale, spacing,
radii, icons. `app/src/theme.ts` and `web/src/lib/theme.ts` mirror it, and
neither invents a value of its own. If you are adding a screen and reach for a
colour that is not in that table, the answer is one of the ones that is.

Two rules hold across the interface and are easier to state than to derive from
the tokens:

**Two themes, no toggle.** The phone app is drawn twice, light and dark, and
follows the phone's own appearance setting. There is no switch inside the app:
the phone already has one, and a second would be a setting nobody changes. The
desktop panel is still dark only.

**Nothing moves that was not touched.** A stream arriving, a tool finishing, an
approval appearing — none of those may reflow what is already on screen. The
list grows downward and the eye stays where it was.

[app-design.zip](app-design.zip) is the drawing the phone app was rebuilt
from: every screen and state, light and dark (`Remote AI Chat - Full Design
Light.dc.html` / `… Dark.dc.html`; open them next to `support.js`). The
`Screens.dc.html` in it is the earlier round of directions, kept for reference.

For what the screens actually look like, see the screenshots in the
[repository README](../README.md); they are captured from the running app rather
than drawn.
