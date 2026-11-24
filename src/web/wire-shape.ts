/**
 * The shape of the wire a link handle lays (S326), as plain geometry: the arrow
 * at its end, and how fast the board scrolls while the wire is held near an
 * edge. No DOM here, so it is tested like any other rule.
 */

interface Point {
  x: number;
  y: number;
}

const HEAD_L = 10;
const HEAD_W = 5;
/** Under this length the wire does not say a way yet: an arrow would spin on the dot. */
const HEAD_FROM = 8;

const round = (n: number): number => Math.round(n * 10) / 10 + 0;

/** The arrow at the end of the wire, as a path: its tip where the pointer is, as the link laid will point (T268). */
export function arrowHead(from: Point, at: Point): string {
  const length = Math.hypot(at.x - from.x, at.y - from.y);
  if (length < HEAD_FROM) return "";
  const ux = (at.x - from.x) / length;
  const uy = (at.y - from.y) / length;
  const back = { x: at.x - ux * HEAD_L, y: at.y - uy * HEAD_L };
  const barb = (side: 1 | -1): string =>
    `L${round(back.x + side * uy * HEAD_W)} ${round(back.y - side * ux * HEAD_W)}`;
  return `M${round(at.x)} ${round(at.y)}${barb(1)}${barb(-1)}Z`;
}

/** How near an edge the pointer starts to pull the board, and how far a frame scrolls it at most. */
const EDGE = 40;
const PULL_MAX = 18;

/**
 * How far the board scrolls in one frame, along one axis, for a pointer at `at`
 * between the edges `low` and `high`: nothing in the middle, towards the edge it
 * is near, faster the nearer, and no faster once past it (T267).
 */
export function edgePull(at: number, low: number, high: number): number {
  const depth = Math.max(low + EDGE - at, at - (high - EDGE));
  if (depth <= 0) return 0;
  const speed = Math.ceil((Math.min(depth, EDGE) / EDGE) * PULL_MAX);
  return at - low < high - at ? -speed : speed;
}
