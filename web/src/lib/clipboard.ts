/** Copying text from a panel that is almost never on https.
 *
 *  `navigator.clipboard` only exists in a secure context, and the panel's
 *  ordinary address is `http://<tailnet-name>:8790` — which is not one. Every
 *  copy button here was therefore a button that did nothing on every machine
 *  but the one running the daemon, and said nothing about it either, because
 *  the promise it was waiting on was never created.
 *
 *  The old `execCommand` path still works on an insecure origin, so it is the
 *  fallback. It needs a real click behind it, which every caller has.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused, or a clipboard the browser will not hand over.
  }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    // Off-screen but focusable: `display: none` cannot be selected, and a
    // visible one would scroll the page to itself.
    box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0;';
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(box);
    return ok;
  } catch {
    return false;
  }
}
