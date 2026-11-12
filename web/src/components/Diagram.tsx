import { useEffect, useMemo, useRef, useState } from 'react';
import { C, ON_COLOUR, R, chartPalette, tokensFor, useTheme } from '../lib/theme';
import { mono } from '../ui/kit';

/** A closed ```mermaid fence, drawn.
 *
 *  Drawn in a frame of its own, the way the phone draws it in a WebView of its
 *  own (`app/src/mermaid-page.ts`): `sandbox="allow-scripts"` and nothing else,
 *  so the page has an opaque origin — it cannot read the panel, its storage or
 *  its socket, whatever text an answer talked mermaid into — and a
 *  Content-Security-Policy that lets it load mermaid and nothing more. It says
 *  one thing back: how big the drawing is, or that it could not draw, in which
 *  case the block shows the code. */

/** How long the frame may take to say it drew before the code is shown. */
export const DIAGRAM_TIMEOUT_MS = 8000;
const PAD = 10;

const json = (v: unknown) => JSON.stringify(v)
  .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)
  // A `</script>` in a diagram's text must not end the script it sits in.
  .split('</').join('<\\/');

/** Mermaid's theme with the card's own background, and the design's own
 *  colours for bars and slices (the default theme's are pastel near-whites on
 *  a light card, the dark theme's near black on a dark one). */
function themeVariables(scheme: 'dark' | 'light', background: string) {
  const palette = chartPalette(scheme);
  const ink = tokensFor(scheme).ink;
  const v: Record<string, unknown> = {
    background,
    xyChart: { backgroundColor: background, plotColorPalette: palette.join(', ') },
    pieStrokeColor: background, pieOuterStrokeColor: background, pieSectionTextColor: ON_COLOUR,
    pieTitleTextColor: ink, pieLegendTextColor: ink, pieOpacity: '1',
  };
  palette.forEach((col, i) => { v[`pie${i + 1}`] = col; });
  return v;
}

/** The frame's whole page. `id` is echoed in every message, so a message is
 *  only ever taken by the frame it came from. */
export function diagramPage({ code, dark, background, scriptUrl, id }: {
  code: string; dark: boolean; background: string; scriptUrl: string; id: string;
}): string {
  const origin = new URL(scriptUrl).origin;
  const script = `(function(){
var ID=${json(id)},PAD=${PAD};
var post=function(m){m.id=ID;parent.postMessage(m,'*');};
var fail=function(e){post({t:'error',message:String((e&&e.message)||e||'error')});};
var el=document.getElementById('d');
['click','auxclick','dblclick'].forEach(function(k){document.addEventListener(k,function(e){e.preventDefault();e.stopPropagation();},true);});
function fit(svg){
  var vb=(svg.getAttribute('viewBox')||'').split(/[\\s,]+/).map(Number);
  try{var b=svg.getBBox();if(vb.length===4&&b.width>0){
    var x0=Math.min(vb[0],b.x),y0=Math.min(vb[1],b.y),x1=Math.max(vb[0]+vb[2],b.x+b.width),y1=Math.max(vb[1]+vb[3],b.y+b.height);
    if(x1-x0>vb[2]+0.5||y1-y0>vb[3]+0.5){var k=(x1-x0)/vb[2];vb=[x0,y0,x1-x0,y1-y0];svg.setAttribute('viewBox',vb.join(' '));
      var aw=parseFloat(svg.getAttribute('width'));if(aw>0&&!/%/.test(svg.getAttribute('width')))svg.setAttribute('width',String(aw*k));}}}catch(e){}
  var w=parseFloat(svg.getAttribute('width'));if(!(w>0)||/%/.test(svg.getAttribute('width')||''))w=vb[2];
  if(!(w>0))return;
  var ratio=vb[2]>0&&vb[3]>0?vb[3]/vb[2]:(parseFloat(svg.getAttribute('height'))||w)/w;
  svg.setAttribute('width',String(w));svg.setAttribute('height',String(w*ratio));
  svg.style.maxWidth='none';
}
try{
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:${json(dark ? 'dark' : 'default')},
    fontFamily:'"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif',
    themeVariables:${json(themeVariables(dark ? 'dark' : 'light', background))},
    flowchart:{useMaxWidth:false},sequence:{useMaxWidth:false},gantt:{useMaxWidth:false},
    pie:{useMaxWidth:false},xyChart:{useMaxWidth:false,width:560,height:320},class:{useMaxWidth:false},state:{useMaxWidth:false},
    er:{useMaxWidth:false},journey:{useMaxWidth:false},timeline:{useMaxWidth:false},mindmap:{useMaxWidth:false}});
  var SRC=${json(code)};
  Promise.resolve(mermaid.parse(SRC)).then(function(){return mermaid.render('divan-diagram',SRC);}).then(function(r){
    if(!r||!r.svg||/aria-roledescription="error"/.test(r.svg))throw new Error('no drawing');
    el.innerHTML=r.svg;
    var svg=el.querySelector('svg');if(svg)fit(svg);
    var links=el.querySelectorAll('a');
    for(var i=0;i<links.length;i++){links[i].removeAttribute('href');links[i].removeAttribute('xlink:href');}
    // A frame the browser is not painting yet (still hidden, or below the
    // fold) can measure as nothing; ask again until it has a size.
    var tries=0;(function measure(){var b=el.getBoundingClientRect();
      if(b.width>0&&b.height>0)post({t:'size',w:Math.ceil(b.width),h:Math.ceil(b.height)});
      else if(++tries<100)setTimeout(measure,50);else fail('no size');})();
  }).catch(fail);
}catch(e){fail(e);}
})();`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline'; img-src data:; font-src data:">
<style>
html,body{margin:0;padding:0;background:${background};}
#d{display:block;width:max-content;padding:${PAD}px;}
#d svg{display:block;max-width:none;}
</style></head><body><div id="d"></div>
<script src="${scriptUrl}"></script>
<script>${script}</script>
</body></html>`;
}

/** Where the browser build of mermaid is: a file of the bundle, fetched only by
 *  a diagram's frame — the panel itself never runs it. Pinned to the version
 *  the phone carries (`app/scripts/gen-mermaid.cjs`) so a diagram draws the
 *  same on both. Asked for on the first diagram, not at load: the import is
 *  vite's (`?url`), and the panel's node tests, which never draw one, load this
 *  file without vite. */
let mermaidUrl: Promise<string> | null = null;
const loadMermaidUrl = () => (mermaidUrl ??= import('mermaid/dist/mermaid.min.js?url')
  .then((m: { default: string }) => new URL(m.default, window.location.href).href));

let seq = 0;

export function Diagram({ code }: { code: string }) {
  const { scheme } = useTheme();
  const dark = scheme === 'dark';
  const background = tokensFor(scheme).s1;
  const frame = useRef<HTMLIFrameElement>(null);
  const [id] = useState(() => `d${++seq}`);
  const [state, setState] = useState<{ t: 'wait' } | { t: 'size'; w: number; h: number } | { t: 'error' }>({ t: 'wait' });

  const [scriptUrl, setScriptUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMermaidUrl().then((u) => { if (live) setScriptUrl(u); }, () => { if (live) setState({ t: 'error' }); });
    return () => { live = false; };
  }, []);
  const srcDoc = useMemo(() => (scriptUrl ? diagramPage({ code, dark, background, id, scriptUrl }) : null),
    [code, dark, background, id, scriptUrl]);

  useEffect(() => {
    if (!srcDoc) return;
    setState({ t: 'wait' });
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (!m || m.id !== id) return;
      if (m.t === 'size' && Number.isFinite(m.w) && Number.isFinite(m.h) && m.w > 0 && m.h > 0) {
        setState({ t: 'size', w: Math.ceil(m.w), h: Math.ceil(m.h) });
      } else if (m.t === 'error') {
        setState({ t: 'error' });
      }
    };
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(() => setState((s) => (s.t === 'wait' ? { t: 'error' } : s)), DIAGRAM_TIMEOUT_MS);
    return () => { window.removeEventListener('message', onMessage); window.clearTimeout(timer); };
  }, [srcDoc, id]);

  if (state.t === 'error') return <CodeBlock code={code} />;
  const drawn = state.t === 'size';
  return (
    <div data-diagram style={{
      margin: '8px 0', background, border: `1px solid ${C.border}`, borderRadius: R.card,
      overflowX: 'auto', maxWidth: '100%',
    }}>
      {/* Created with its page, never given one later: a frame whose srcdoc is
          swapped after it was made did not always run the new page. */}
      {srcDoc ? <iframe
        key={srcDoc}
        ref={frame}
        title="diagram"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{
          display: 'block', border: 0, background,
          width: drawn ? state.w : '100%', height: drawn ? state.h : 120,
          // Transparent rather than hidden until it has drawn: Chrome does not
          // lay out a hidden cross-origin frame, so it would measure as nothing.
          margin: '0 auto', opacity: drawn ? 1 : 0,
        }}
      /> : <div style={{ height: 120 }} />}
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <pre style={{
      ...mono, fontSize: 13, lineHeight: '19px', background: C.bg,
      border: `1px solid ${C.border}`, borderRadius: R.card, padding: '10px 12px',
      overflowX: 'auto', margin: '8px 0', color: C.text2,
    }}>{code}</pre>
  );
}
