/** The page a ```mermaid block is drawn on: mermaid in a WebView, from the copy
 *  bundled with the app (`mermaid.gen.ts`), so nothing is fetched — the page
 *  says so itself too, in a Content-Security-Policy that lets nothing in from
 *  anywhere.
 *
 *  It draws once and says one thing back through `ReactNativeWebView.
 *  postMessage` (`FromDiagram` in `mermaid.ts`): the drawing's size, so the
 *  WebView can be exactly that tall, or that it could not draw, so the block
 *  shows the code instead. Mermaid's own red "syntax error" picture is never
 *  drawn: the text is parsed first, and error rendering is off. */
import { MERMAID_JS } from './mermaid.gen';

const json = (v: unknown) => JSON.stringify(v)
  .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)
  // The diagram's text sits inside a <script>; a `</script>` in it must not end it.
  .replace(/<\//g, '<\\/');

/** Padding around the drawing, inside the page, in CSS pixels. */
const PAD = 10;

const BRIDGE = `(function(){
var PAD=${PAD};
var post=function(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));};
var fail=function(e){post({t:'error',message:String((e&&e.message)||e||'error')});};
var el=document.getElementById('d');
// Nothing in a diagram goes anywhere: no link, no click handler.
['click','auxclick','dblclick'].forEach(function(k){document.addEventListener(k,function(e){e.preventDefault();e.stopPropagation();},true);});
function size(){var r=el.getBoundingClientRect();post({t:'size',w:Math.ceil(r.width),h:Math.ceil(r.height)});}
// A chart is shrunk to the width it is shown at; a diagram wider than that
// keeps its size and is scrolled sideways, because its words would not survive
// the shrinking. Either way the svg gets a width and height of its own, so the
// page measures what is drawn.
function fit(svg){
  var vb=(svg.getAttribute('viewBox')||'').split(/[\\s,]+/).map(Number);
  // Some diagrams (xychart) draw past their own viewBox; widen it to what is
  // drawn so nothing is cut off at the edge.
  try{var b=svg.getBBox();if(vb.length===4&&b.width>0){
    var x0=Math.min(vb[0],b.x),y0=Math.min(vb[1],b.y),x1=Math.max(vb[0]+vb[2],b.x+b.width),y1=Math.max(vb[1]+vb[3],b.y+b.height);
    if(x1-x0>vb[2]+0.5||y1-y0>vb[3]+0.5){var k=(x1-x0)/vb[2];vb=[x0,y0,x1-x0,y1-y0];svg.setAttribute('viewBox',vb.join(' '));
      var aw=parseFloat(svg.getAttribute('width'));if(aw>0&&!/%/.test(svg.getAttribute('width')))svg.setAttribute('width',String(aw*k));}}}catch(e){}
  var w=parseFloat(svg.getAttribute('width'));if(!(w>0)||/%/.test(svg.getAttribute('width')||''))w=vb[2];
  if(!(w>0))return;
  var ratio=vb[2]>0&&vb[3]>0?vb[3]/vb[2]:(parseFloat(svg.getAttribute('height'))||w)/w;
  var room=window.innerWidth-2*PAD;
  var chart=/^(pie|xychart|quadrant|radar|sankey)/i.test(svg.getAttribute('aria-roledescription')||'');
  if(room>0&&w>room&&chart)w=room;
  svg.setAttribute('width',String(w));svg.setAttribute('height',String(w*ratio));
  svg.style.maxWidth='none';
}
try{
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:THEME,
    fontFamily:'-apple-system, system-ui, "Helvetica Neue", sans-serif',
    themeVariables:VARS,
    flowchart:{useMaxWidth:false},sequence:{useMaxWidth:false},gantt:{useMaxWidth:false},
    pie:{useMaxWidth:false},xyChart:{useMaxWidth:false,width:360,height:260},class:{useMaxWidth:false},state:{useMaxWidth:false},
    er:{useMaxWidth:false},journey:{useMaxWidth:false},timeline:{useMaxWidth:false},mindmap:{useMaxWidth:false}});
  Promise.resolve(mermaid.parse(SRC)).then(function(){return mermaid.render('divan-diagram',SRC);}).then(function(r){
    if(!r||!r.svg||/aria-roledescription="error"/.test(r.svg))throw new Error('no drawing');
    el.innerHTML=r.svg;
    var svg=el.querySelector('svg');if(svg)fit(svg);
    var links=el.querySelectorAll('a');
    for(var i=0;i<links.length;i++){links[i].removeAttribute('href');links[i].removeAttribute('xlink:href');}
    requestAnimationFrame(size);
  }).catch(fail);
}catch(e){fail(e);}
})();`;

/** Mermaid's theme, with the page's own background, and in the dark a pie
 *  whose slices can be told from the page (the dark theme's own are near
 *  black). */
function themeVariables(dark: boolean, background: string) {
  // The default theme's bars are a near-white lavender; both themes get colours
  // that read on their card.
  const v: Record<string, unknown> = {
    background,
    xyChart: { backgroundColor: background, plotColorPalette: '#5b8def, #e0a43a, #4fb38a, #c86ad8, #e06c6c, #3fb6c6' },
  };
  if (dark) {
    ['#5b8def', '#e0a43a', '#4fb38a', '#c86ad8', '#e06c6c', '#3fb6c6', '#a7a15a', '#8c7ae6',
     '#d98a5f', '#6aa84f', '#b8657a', '#7f8c99'].forEach((col, i) => { v[`pie${i + 1}`] = col; });
    Object.assign(v, { pieStrokeColor: background, pieOuterStrokeColor: background, pieSectionTextColor: '#ffffff',
                       pieTitleTextColor: '#ededeb', pieLegendTextColor: '#ededeb' });
  }
  return v;
}

export type DiagramPageOptions = {
  /** The diagram's source, the fence's content. */
  code: string;
  /** Mermaid's `dark` theme when true, its `default` one otherwise. */
  dark: boolean;
  /** The page's background: the card the diagram sits on. */
  background: string;
};

/** The whole page, as a string for the WebView's `source.html`. */
export function mermaidPage({ code, dark, background }: DiagramPageOptions): string {
  // Functions, not strings, as the replacements: a `$&` in a diagram is text.
  const script = BRIDGE
    .replace(/\bTHEME\b/g, () => json(dark ? 'dark' : 'default'))
    .replace(/\bVARS\b/g, () => json(themeVariables(dark, background)))
    .replace(/\bSRC\b/g, () => json(code));
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;padding:0;background:${background};-webkit-text-size-adjust:100%;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}
#d{display:block;width:max-content;margin:0 auto;padding:${PAD}px;}
#d svg{display:block;max-width:none;}
</style></head><body><div id="d"></div>
<script>${MERMAID_JS}</script>
<script>${script}</script>
</body></html>`;
}
