/** What the panel shows when the panel cannot show anything.
 *
 *  A React tree that throws while rendering unmounts itself, and what is left on
 *  the screen is the page's background: a black rectangle, with the reason in a
 *  console nobody has open. That is what happened here — the panel was "simsiyah"
 *  on one browser and perfect on the next, and neither the daemon's log nor the
 *  page itself said a word about why.
 *
 *  So: anything thrown under this boundary is drawn, with the two things that
 *  fix it in practice — a reload that skips the cache, and a way to forget the
 *  state this browser has kept. Stored state is the usual culprit: a panel that
 *  has been open since an older build is holding values a newer one reads
 *  differently, and until now the only cure anybody could suggest was clearing
 *  the cache by hand.
 *
 *  It is deliberately made of nothing: no design tokens, no theme, no imports
 *  beyond React. A boundary that needed the rest of the app to render would be a
 *  boundary that goes black with it.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
  info: string;
}

export class Fallback extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Into the console as well, because a person who *does* open it should find
    // the stack there rather than only this sentence.
    console.error('the panel stopped:', error, info.componentStack);
    this.setState({ info: (info.componentStack || '').trim().split('\n').slice(0, 4).join('\n') });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: 14, padding: '40px 32px',
        background: 'Canvas', color: 'CanvasText',
        font: '400 14px/1.5 -apple-system, system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>
          The panel stopped.
        </div>
        <div style={{ maxWidth: 560, opacity: 0.75 }}>
          Something it drew threw an error, so it put itself down rather than
          showing half a screen. The daemon and your chats are untouched.
        </div>
        <pre style={{
          maxWidth: 560, margin: 0, padding: '10px 12px', overflow: 'auto',
          borderRadius: 10, background: 'rgba(128,128,128,.14)',
          font: '400 12px/1.5 ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap',
        }}>{`${error.name}: ${error.message}${info ? `\n${info}` : ''}`}</pre>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => window.location.reload()} style={BTN}>
            Reload
          </button>
          <button
            type="button"
            onClick={() => {
              // Everything this browser remembers about the panel, and nothing
              // else on the machine: the pairing goes with it, which is the
              // point — a bad stored value is exactly what this clears.
              try { localStorage.clear(); } catch { /* a locked-down browser */ }
              window.location.replace('/');
            }}
            style={{ ...BTN, opacity: 0.8 }}
          >
            Forget this browser’s state and start over
          </button>
        </div>
      </div>
    );
  }
}

const BTN: React.CSSProperties = {
  height: 34, padding: '0 14px', borderRadius: 11, cursor: 'pointer',
  border: '1px solid rgba(128,128,128,.4)', background: 'transparent',
  font: '600 13px -apple-system, system-ui, sans-serif', color: 'inherit',
};
