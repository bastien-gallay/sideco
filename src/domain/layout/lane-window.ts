/**
 * The window of a column taller than the page has room for (S306). The page
 * says how tall a column may be and how far each was scrolled; the lines that
 * show in that room are laid, the first and the last cut at its edges, and
 * those wholly out of view are counted above and below. A column scrolls as
 * a page does: by any distance, not card by card (S354).
 */

/** The room kept at the head of a windowed column, for what says how many cards are out of view above. */
export const CHIP_H = 28;

/** What shows of a column: lines `from` to `to` (not included), scrolled `at` far of the `most` it can be, in `room`. */
export interface LaneWindow {
  from: number;
  to: number;
  at: number;
  most: number;
  room: number;
}

/** Where each line starts from the head of its column, and how tall they all stand. */
function tops(heights: readonly number[], gap: number): { top: number[]; all: number } {
  const top: number[] = [];
  let y = 0;
  for (const h of heights) {
    top.push(y);
    y += h + gap;
  }
  return { top, all: Math.max(0, y - gap) };
}

/**
 * The lines of a column that show, scrolled `skip` far, in `room`: undefined
 * when they all fit. Scrolled too far, the window ends on the last line.
 */
export function windowOf(
  heights: readonly number[],
  skip: number,
  room: number,
  gap: number,
): LaneWindow | undefined {
  const { top, all } = tops(heights, gap);
  if (all <= room) return undefined;
  // The count of the cards above has its room at the head; the one of those below is in the free slot at the foot.
  const inner = Math.max(1, room - CHIP_H);
  const most = Math.max(0, all - inner);
  const at = Math.min(Math.max(0, Number.isFinite(skip) ? skip : 0), most);
  let from = 0;
  while (from < heights.length - 1 && (top[from] ?? 0) + (heights[from] ?? 0) <= at) from++;
  let to = from + 1;
  while (to < heights.length && (top[to] ?? 0) < at + inner) to++;
  return { from, to, at, most, room: inner };
}

/**
 * How far to scroll so that line `line` shows whole: the least change from `skip` for a line at an edge of the
 * window, as an arrow reaches it; a line far out of view comes to the middle, where the eye finds it.
 */
export function reveal(
  heights: readonly number[],
  skip: number,
  room: number,
  gap: number,
  line: number,
): number {
  const cut = windowOf(heights, skip, room, gap);
  if (!cut) return 0;
  const top = tops(heights, gap).top[line];
  const h = heights[line];
  if (top === undefined || h === undefined) return cut.at;
  const far = top + h < cut.at - h || top > cut.at + cut.room + h;
  if (far) return Math.min(cut.most, Math.max(0, top + h / 2 - cut.room / 2));
  if (top < cut.at) return top;
  // Taller than the window, a line shows from its head.
  if (top + h > cut.at + cut.room) return Math.min(cut.most, Math.min(top, top + h - cut.room));
  return cut.at;
}

/** How much of a line the edges of the window hide, at its head and at its foot: undefined for a line that shows whole. */
export function cutOf(
  top: number,
  h: number,
  cut: Pick<LaneWindow, "at" | "room">,
): { top: number; bottom: number } | undefined {
  const over = Math.max(0, cut.at - top);
  const under = Math.max(0, top + h - (cut.at + cut.room));
  return over > 0 || under > 0 ? { top: over, bottom: under } : undefined;
}
