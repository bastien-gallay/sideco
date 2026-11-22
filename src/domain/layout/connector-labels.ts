/**
 * Where a link's name is written. A layout puts it where it reads best; this
 * pass keeps it there when the spot is free, and otherwise slides it along its
 * own link to the nearest spot that covers no card and no other name. A name
 * with nowhere free is not written: it would hide a card, so the link says it
 * on hover instead.
 */
import { type Connector, r, type Scene, wrap } from "./scene.ts";

/** The width of one character of a link's name, at its 11px. */
export const LABEL_CHAR_W = 6.2;
/** A name is cut into lines of about this many characters... */
export const NAME_CHARS = 28;
/** ...and this many lines at most: the rest is read on hover. */
export const NAME_LINES = 2;
/** From one line of a name to the next. */
export const NAME_LINE_H = 13;
/** Above the baseline, and below it, of a line of 11px text. */
const ASCENT = 9;
const DESCENT = 3;
/** The halo drawn around the name, which covers what lies under it too. */
const HALO = 2;
/** From the line to the name written beside it. */
const OFFSET = 4;
/** How often a link is tried along its length. */
const STEP = 8;
/** A line of names, and how many lines off its link a name may go. */
const LINE = 14;
const RUNGS = [0, 1, 2, 3, 4];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Point = readonly [number, number];

/** The lines a link's name is written on. */
export function nameLines(label: string): string[] {
  return wrap(label, NAME_CHARS, NAME_LINES);
}

/** How wide a name is written, its longest line. */
export function nameWidth(label: string): number {
  return Math.max(...nameLines(label).map((l) => l.length)) * LABEL_CHAR_W;
}

/** What a name covers, its halo included, written from `x` on the baseline `y` of its first line. */
export function labelBox(label: string, x: number, y: number): Box {
  return {
    x: x - HALO,
    y: y - ASCENT - HALO,
    w: nameWidth(label) + 2 * HALO,
    h: ASCENT + DESCENT + (nameLines(label).length - 1) * NAME_LINE_H + 2 * HALO,
  };
}

export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The scene with every link's name on a spot of its own, the layout's spot first. */
export function placeConnectorLabels(scene: Scene): Scene {
  const placed: Box[] = [];
  const lines = scene.connectors.map((c) => along(c.d));
  const connectors = scene.connectors.map((c, k): Connector => {
    if (!c.label) return c;
    const others = lines.filter((_, j) => j !== k).flat();
    const spot = spotFor(c, c.label, scene, placed, others) ?? spotFor(c, c.label, scene, placed, []);
    if (!spot) return { ...c, unwritten: true };
    const [x, y] = spot;
    placed.push(labelBox(c.label, x, y));
    return x === c.labelX && y === c.labelY ? c : { ...c, labelX: x, labelY: y };
  });
  return { ...scene, connectors };
}

/** A spot for the name that covers no card and no other name, nor any of `lines`: the other links. */
function spotFor(
  c: Connector,
  label: string,
  scene: Scene,
  placed: readonly Box[],
  lines: readonly Point[],
): Point | undefined {
  const wanted: Point = [c.labelX, c.labelY];
  const width = nameWidth(label);
  const tall = (nameLines(label).length - 1) * NAME_LINE_H;
  const free = (at: Point): boolean => {
    const box = labelBox(label, at[0], at[1]);
    return (
      !scene.cards.some((k) => overlap(box, k) > 0) &&
      !placed.some((b) => overlap(box, b) > 0) &&
      !lines.some(([x, y]) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h)
    );
  };
  if (free(wanted)) return wanted;

  const inside = ([x, y]: Point): boolean =>
    x - HALO >= 0 &&
    y - ASCENT - HALO >= 0 &&
    x + width + HALO <= scene.width &&
    y + tall + DESCENT + HALO <= scene.height;
  const near = (p: Point): number => Math.hypot(p[0] - wanted[0], p[1] - wanted[1]);
  const spots = along(c.d)
    .flatMap(([x, y]): Point[] => [
      [x + OFFSET, y + OFFSET],
      [x - OFFSET - width, y + OFFSET],
      // Above or under the line, a few lines off at most: room between cards is often a cell away.
      ...RUNGS.flatMap((k): Point[] => [
        [x - width / 2, y - OFFSET - tall - k * LINE],
        [x - width / 2, y + OFFSET + ASCENT + k * LINE],
      ]),
    ])
    .map(([x, y]): Point => [r(x), r(y)])
    .filter(inside)
    .sort((a, b) => near(a) - near(b));

  return spots.find(free);
}

/** Points every `STEP` along an SVG path of M, L, H, V and C commands, absolute. */
export function along(d: string): Point[] {
  const tokens = d.match(/[MLHVC]|-?\d*\.?\d+/g) ?? [];
  const points: Point[] = [];
  let at: Point = [0, 0];
  let k = 0;
  const num = (): number => Number(tokens[k++]);
  const line = (to: Point): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - at[0], to[1] - at[1]) / STEP));
    for (let i = 1; i <= n; i++)
      points.push([at[0] + ((to[0] - at[0]) * i) / n, at[1] + ((to[1] - at[1]) * i) / n]);
    at = to;
  };
  while (k < tokens.length) {
    const cmd = tokens[k++];
    if (cmd === "M") {
      at = [num(), num()];
      points.push(at);
    } else if (cmd === "L") line([num(), num()]);
    else if (cmd === "H") line([num(), at[1]]);
    else if (cmd === "V") line([at[0], num()]);
    else if (cmd === "C") {
      const p0 = at;
      const p1: Point = [num(), num()];
      const p2: Point = [num(), num()];
      const p3: Point = [num(), num()];
      // The control polygon is never shorter than the curve: stepping it keeps the points close.
      const hull =
        Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
        Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
        Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
      const n = Math.max(1, Math.ceil(hull / STEP));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const bez = (a: number, b: number, c: number, e: number): number =>
          u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * e;
        points.push([bez(p0[0], p1[0], p2[0], p3[0]), bez(p0[1], p1[1], p2[1], p3[1])]);
      }
      at = p3;
    } else break;
  }
  return points;
}
