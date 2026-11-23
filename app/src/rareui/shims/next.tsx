/* Rare UI is written for Next.js. The few Next pieces its components and demos
 * reach for are stood in for here, so the files can be used exactly as they
 * are in the Rare UI repository. `vite.config.ts` points `next/link`,
 * `next/navigation` and `next-themes` at this file. Nothing outside
 * `src/rareui/` imports them. */
import { forwardRef, useEffect, useState, type AnchorHTMLAttributes } from 'react';

const Link = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; scroll?: boolean }>(
  function Link({ prefetch: _p, scroll: _s, onClick, ...rest }, ref) {
    // A gallery has nowhere to go: a nav item's link only moves the highlight.
    return <a ref={ref} {...rest} onClick={(e) => { e.preventDefault(); onClick?.(e); }} />;
  });
export default Link;

/** Each demo is its own "page" for the preview controls' per-page values. */
export function usePathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname + window.location.hash;
}
export function useRouter() {
  return { push: (_: string) => {}, replace: (_: string) => {}, back: () => {}, prefetch: (_: string) => {} };
}
export function useSearchParams() {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
}

/** The gallery's theme is the `dark` class on <html>; this is next-themes' face on it. */
export function useTheme() {
  const read = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  const [theme, setThemeState] = useState<string>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeState(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  const setTheme = (t: string) => {
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  };
  return { theme, resolvedTheme: theme, setTheme, themes: ['light', 'dark', 'system'], systemTheme: theme };
}
export function ThemeProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
