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

const REACH = 96;
const STEP = 8;

/** The places a link's bar may take, nearest first: under the point then over it, to its right, its left, astride. */
function placesNear(
  point: { x: number; y: number },
  size: { w: number; h: number },
): { left: number; top: number }[] {
  const places: { left: number; top: number }[] = [];
  for (let dy = 0; dy <= REACH; dy += STEP)
    for (const top of [point.y + GAP + 4 + dy, point.y - GAP - 4 - size.h - dy])
      for (let dx = 0; dx <= REACH; dx += STEP)
        for (const left of [point.x + dx, point.x - dx - size.w, point.x - size.w / 2])
          places.push({ left, top });
  return places;
}

/**
 * Where the toolbar of a link goes: the nearest place to the point where the
 * link was picked that hides no card and leaves that point in sight, under it
 * first as a menu opens. A link runs between cards, so the free place is often
 * a few pixels aside from straight under; with none in reach, the place that
 * hides the least.
 */
export function placeNear(
  point: { x: number; y: number },
  others: readonly Rect[],
  size: { w: number; h: number },
  frame: { width: number; height: number },
): { left: number; top: number } {
  const hidden = ({ left, top }: { left: number; top: number }): number => {
    const inside =
      left >= GAP && top >= GAP && left + size.w <= frame.width - GAP && top + size.h <= frame.height - GAP;
    if (!inside) return Number.POSITIVE_INFINITY;
    const span = { left, top, right: left + size.w, bottom: top + size.h };
    return others.reduce((sum, r) => sum + overlap(span, r), 0);
  };
  let best = { left: Math.max(GAP, point.x), top: Math.max(GAP, point.y + GAP + 4) };
  let least = Number.POSITIVE_INFINITY;
  for (const place of placesNear(point, size)) {
    const k = hidden(place);
    if (k === 0) return place;
    if (k < least) [best, least] = [place, k];
  }
  return best;
}
