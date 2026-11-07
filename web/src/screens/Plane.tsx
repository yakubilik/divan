/** A product's board, which is Plane (plane.so) on another computer.
 *
 *  It cannot be drawn inside this page: Plane answers every page with
 *  `X-Frame-Options: DENY`, and its sign-in cookie would not travel into a frame
 *  from another host anyway. So the board is one press away, in a tab of its
 *  own, where Plane's sign-in is kept like any other site's. The phone has no
 *  such limit and shows the same page in place (`app/src/components/plane.tsx`).
 */
import { Button, EmptyState } from '../ui/divan';
import { P } from '../ui/kit';

export function PlaneBoard({ url }: { url: string }) {
  if (!url) {
    return (
      <EmptyState title="No board yet"
        body="This computer has no Plane. Add a [plane] url and workspace to its config.toml." />
    );
  }
  return (
    <EmptyState title="The board is in Plane"
      body="Plane keeps this product's work items, cycles and modules. It opens in a tab of its own."
      actions={<Button label="Open in Plane" icon={P.external}
        onClick={() => { window.open(url, '_blank', 'noopener'); }} />}
      foot={url} />
  );
}
