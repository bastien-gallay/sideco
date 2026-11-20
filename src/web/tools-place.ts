/**
 * Where the toolbar of the card chosen goes, in the board's frame: above the
 * card, else under it, else beside it, wherever it hides no other card. With
 * cards all around, it hides the least of them, never the card chosen: that is
 * the one the reader is working on.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 8;

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function placeTools(
  card: Rect,
  others: readonly Rect[],
  size: { w: number; h: number },
  frame: { width: number; height: number },
): { left: number; top: number } {
  // Inside the window: a toolbar cut by the edge hides the action at its end.
  const within = (x: number, y: number) => ({
    left: Math.min(Math.max(GAP, frame.width - size.w - GAP), Math.max(GAP, x)),
    top: Math.min(Math.max(GAP, frame.height - size.h - GAP), Math.max(GAP, y)),
  });
  const places = [
    within(card.left, card.top - size.h - GAP),
    within(card.left, card.bottom + GAP),
    within(card.right + GAP, card.top),
    within(card.left - size.w - GAP, card.top),
  ];
  const hidden = ({ left, top }: { left: number; top: number }): number => {
    const span = { left, top, right: left + size.w, bottom: top + size.h };
    if (overlap(span, card) > 0) return Number.POSITIVE_INFINITY;
    return others.reduce((sum, r) => sum + overlap(span, r), 0);
  };
  let best = places[0];
  let least = Number.POSITIVE_INFINITY;
  for (const place of places) {
    const k = hidden(place);
    if (k === 0) return place;
    if (k < least) [best, least] = [place, k];
  }
  // A window too small for any place beside the card: on it, as a last resort.
  return least < Number.POSITIVE_INFINITY && best ? best : within(card.left, card.top + 4);
}
