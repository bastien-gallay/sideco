/**
 * The window of a column taller than the page has room for (S306). The page
 * says how tall a column may be and how many lines each has scrolled past;
 * the lines that fit from there are laid, whole, and the others are counted
 * above and below. Card by card: no card is cut at an edge.
 */

/** The room kept at the head of a windowed column, for what says how many cards are out of view above. */
export const CHIP_H = 28;

/** The height of lines `from` to `to` (not included), with the gap between them. */
function span(heights: readonly number[], from: number, to: number, gap: number): number {
  let h = 0;
  for (let at = from; at < to; at++) h += (heights[at] ?? 0) + (at > from ? gap : 0);
  return h;
}

/** How many lines fit `room` from `from`: never fewer than one. */
function fits(heights: readonly number[], from: number, room: number, gap: number): number {
  let to = from + 1;
  while (to < heights.length && span(heights, from, to + 1, gap) <= room) to++;
  return to - from;
}

/** The first line of the last window: from there, every line down to the last fits. */
function last(heights: readonly number[], room: number, gap: number): number {
  let from = heights.length - 1;
  while (from > 0 && span(heights, from - 1, heights.length, gap) <= room) from--;
  return Math.max(0, from);
}

/**
 * The lines of a column that are laid, `skip` of them scrolled past, in `room`:
 * undefined when they all fit. Scrolled too far, the window ends on the last line.
 */
export function windowOf(
  heights: readonly number[],
  skip: number,
  room: number,
  gap: number,
): { from: number; to: number } | undefined {
  if (span(heights, 0, heights.length, gap) <= room) return undefined;
  // The count of the cards above has its room at the head; the one of those below is in the free slot at the foot.
  const inner = room - CHIP_H;
  const from = Math.min(Math.max(0, Math.round(Number.isFinite(skip) ? skip : 0)), last(heights, inner, gap));
  return { from, to: from + fits(heights, from, inner, gap) };
}

/** How many lines to scroll past so that line `at` is in view: the least change from `skip`. */
export function reveal(
  heights: readonly number[],
  skip: number,
  room: number,
  gap: number,
  at: number,
): number {
  const cut = windowOf(heights, skip, room, gap);
  if (!cut || (at >= cut.from && at < cut.to)) return cut?.from ?? 0;
  if (at < cut.from) return at;
  // Below the window: the first skip whose window reaches the line.
  let from = cut.from;
  while (from < at && from + fits(heights, from, room - CHIP_H, gap) <= at) from++;
  return from;
}
