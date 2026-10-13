/** The page the phone's shell is drawn on: xterm.js in a WebView, from the
 *  copy bundled with the app (`xterm.gen.ts`), so nothing is fetched.
 *
 *  It speaks to the app in the `FromPage` / `ToPage` messages of `term.ts`:
 *  out through `ReactNativeWebView.postMessage`, in through `window.divanIn`,
 *  which the screen calls with `injectJavaScript` (`toPageScript`). */
import { XTERM_CSS, XTERM_FIT_JS, XTERM_JS } from './xterm.gen';
import type { ToPage } from './term';

/** A terminal is dark whatever the app's scheme is: the programs run in it
 *  choose their colours assuming so. The panel's own (web `MEDIA.term`). */
export const TERM_THEME = {
  background: '#0b0c0e',
  foreground: '#FFFFFF',
  cursor: '#f5b544',
  cursorAccent: '#0b0c0e',
  selectionBackground: 'rgba(245,181,68,0.33)',
};

const json = (v: unknown) => JSON.stringify(v).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

/** The JavaScript that hands one message to the page. */
export function toPageScript(m: ToPage): string {
  return `window.divanIn&&window.divanIn(${json(m)});true;`;
}

const BRIDGE = `(function(){
var post=function(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));};
var el=document.getElementById('t');
var term=new Terminal({fontFamily:'Menlo, "SF Mono", ui-monospace, monospace',fontSize:FONT_SIZE,lineHeight:1.1,
  cursorBlink:true,scrollback:5000,theme:THEME});
var fit=new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(el);
var appCursor=false;
function mode(){var a=!!(term.modes&&term.modes.applicationCursorKeysMode);
  if(a!==appCursor){appCursor=a;post({t:'mode',appCursor:a});}}
function refit(){if(!el.offsetWidth||!el.offsetHeight)return;try{fit.fit();}catch(e){}}
term.onData(function(d){post({t:'data',data:d});});
term.onResize(function(s){post({t:'size',cols:s.cols,rows:s.rows});});
window.addEventListener('resize',refit);
if(window.ResizeObserver)new ResizeObserver(refit).observe(el);
window.divanIn=function(m){
  if(m.t==='out')term.write(m.data,mode);
  else if(m.t==='reset')term.reset();
  else if(m.t==='fit')refit();
  else if(m.t==='focus')term.focus();
  else if(m.t==='blur')term.blur();
};
refit();
post({t:'ready',cols:term.cols,rows:term.rows});
})();`;

/** The whole page, as a string for the WebView's `source.html`. */
export function termPage(fontSize = 12): string {
  const script = BRIDGE.replace('FONT_SIZE', String(fontSize)).replace('THEME', json(TERM_THEME));
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${XTERM_CSS}
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:${TERM_THEME.background};}
#t{position:absolute;top:4px;left:6px;right:6px;bottom:4px;}
</style></head><body><div id="t"></div>
<script>${XTERM_JS}</script>
<script>${XTERM_FIT_JS}</script>
<script>${script}</script>
</body></html>`;
}
