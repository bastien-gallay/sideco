/**
 * Columns layout: one named lane per column, elements stacked top to bottom in
 * board order. Kanban, retrospectives, any "sort these into buckets" workshop.
 *
 * A format that gives its lanes a `grid` has them laid as the cells of a plan
 * instead: so many lanes per row, cards abreast in a cell, and the two axes
 * named beside it. The lanes and the order of their cards stay what they are.
 */

import { type Format, laneHint, laneName, lanesOf, planAxis } from "../formats.ts";
import { type Locale, WORDS } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";
import { CHIP_H, cutOf, reveal, windowOf } from "./lane-window.ts";
import {
  type Band,
  CARD_H,
  CARD_W,
  type Card,
  charsFor,
  elementHeight,
  MARGIN,
  type Room,
  type Scene,
  type Seen,
  spanOf,
  type Target,
  type View,
} from "./scene.ts";

const LANE_GAP = 16;
const HEADER_H = 44;
const STACK_GAP = 10;
const LANE_PAD = 12;
/** Between the side of a lane and its cards. */
const LANE_SIDE = 20;
/** Between two cards abreast. */
const ABREAST_GAP = 12;
const MIN_SLOTS = 3;
/** A cell of a plan shows less empty room than a lane: there are cells under it. */
const MIN_SLOTS_IN_CELL = 2;
/** The room of one full-height card: the free slot at the end of a lane. */
const SLOT_H = CARD_H + STACK_GAP;
/** The strip that names an axis, beside the cells. */
const AXIS = 28;
/** Shared out over a window, a card is never narrower than this: a line still holds a few words. */
const MIN_CARD_W = 120;
/** Nor wider than this: past it, a line is too long to read at a glance. */
const MAX_CARD_W = 320;

/** A row of cards abreast in a lane. */
interface Line {
  y: number;
  h: number;
  cards: { e: Element; x: number }[];
  /** How much of it the edges of its column's window hide (S354). */
  cut?: { top: number; bottom: number };
}

interface LanePlan {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: Line[];
  count: number;
  /** Folded by its reader: narrow, its cards put away. */
  folded: boolean;
  /** Scrolling alone (S306): its cards out of view above and below, how far it is scrolled of the most it can be, and the room its cards show in; none without a window. */
  above?: number;
  below?: number;
  skip?: number;
  most?: number;
  room?: number;
  /** The first card under its window: a card dropped at its foot lands before it. */
  next?: string;
}

interface Plan {
  lanes: LanePlan[];
  /** Cards abreast in a lane. */
  abreast: number;
  /** The width of every card. */
  cardW: number;
  /** A reader is there to fold the lanes. */
  foldable: boolean;
  right: number;
  bottom: number;
}

/** A lane folded by its reader: wide enough for its button, its count and its name upright. */
const FOLD_W = 44;

/**
 * How wide a card is. The open lanes side by side share out the `span` they are
 * given, less what the `folded` ones keep, within bounds; a plan keeps its
 * cells, and without a span every card keeps its own width.
 */
function cardWidth(format: Format, lanes: number, span: number | undefined, folded = 0): number {
  const open = lanes - folded;
  if (span === undefined || format.grid || open <= 0) return CARD_W;
  const laneW = Math.floor((span - 2 * MARGIN - (lanes - 1) * LANE_GAP - folded * FOLD_W) / open);
  return Math.min(MAX_CARD_W, Math.max(MIN_CARD_W, laneW - 2 * LANE_SIDE));
}

/** The cards of a lane in rows, so many abreast, from `top` down; and how tall they stand. */
function stackLines(stack: Element[], x: number, top: number, abreast: number, cardW: number) {
  const chars = charsFor(cardW);
  const lines: Line[] = [];
  let y = top;
  for (let at = 0; at < stack.length; at += abreast) {
    const cards = stack
      .slice(at, at + abreast)
      .map((e, k) => ({ e, x: x + LANE_SIDE + k * (cardW + ABREAST_GAP) }));
    const h = Math.max(...cards.map((c) => elementHeight(c.e, chars)));
    lines.push({ y, h, cards });
    y += h + STACK_GAP;
  }
  return { lines, stackH: y - top };
}

/**
 * The lines of a lane that fit the window the page gives (S306), and what is out of view; all of them without a
 * window, and in a plan, whose cells do not scroll.
 */
function stackSeen(
  stack: Element[],
  x: number,
  top: number,
  abreast: number,
  cardW: number,
  seen: Seen,
  lane: string,
) {
  const all = stackLines(stack, x, top, abreast, cardW);
  const tall = typeof seen === "object" ? seen.tall : undefined;
  if (tall === undefined) return all;
  const skip = typeof seen === "object" ? (seen.skip?.get(lane) ?? 0) : 0;
  const room = tall - HEADER_H - LANE_PAD - SLOT_H;
  const cut = windowOf(
    all.lines.map((line) => line.h),
    skip,
    room,
    STACK_GAP,
  );
  if (!cut) return { ...all, above: 0, below: 0, skip: 0, most: 0 };
  // The lines that show keep their place in the column, less what is scrolled past: the first and the last may be cut.
  const lines = all.lines.slice(cut.from, cut.to).map((line) => ({
    ...line,
    y: line.y + CHIP_H - cut.at,
    cut: cutOf(line.y - top, line.h, cut),
  }));
  return {
    lines,
    stackH: cut.room + CHIP_H,
    above: cut.from * abreast,
    below: Math.max(0, stack.length - cut.to * abreast),
    skip: cut.at,
    most: cut.most,
    room: cut.room,
    next: stack[cut.to * abreast]?.id,
  };
}

/**
 * Where every lane and every card goes. `without` is a card in the human's
 * hand: it takes no place. `seen` is what the page gives: the width the board
 * has on screen, and the lanes its reader folded, which keep their count and
 * lay no card.
 */
function plan(board: Board, format: Format, without?: string, seen?: Seen): Plan {
  const grid = format.grid;
  const ids = lanesOf(board);
  const shut = typeof seen === "object" && !grid ? seen.folded : undefined;
  const perRow = grid?.perRow ?? ids.length;
  const abreast = grid?.abreast ?? 1;
  const cardW = cardWidth(format, ids.length, spanOf(seen), ids.filter((id) => shut?.has(id)).length);
  const laneW = 2 * LANE_SIDE + abreast * cardW + (abreast - 1) * ABREAST_GAP;
  const left = MARGIN + (grid ? AXIS : 0);
  const minHeight = (grid ? MIN_SLOTS_IN_CELL : MIN_SLOTS) * SLOT_H;

  const lanes: LanePlan[] = [];
  let top = MARGIN;
  for (let start = 0; start < ids.length; start += perRow) {
    let x = left;
    const row = ids.slice(start, start + perRow).map((id) => {
      const folded = shut?.has(id) === true;
      const stack = board.elements.filter((e) => e.lane === id && e.id !== without);
      const laid = stackSeen(
        folded ? [] : stack,
        x,
        top + HEADER_H + LANE_PAD,
        abreast,
        cardW,
        grid ? undefined : seen,
        id,
      );
      const lane = { id, x, w: folded ? FOLD_W : laneW, folded, count: stack.length, ...laid };
      x += lane.w + LANE_GAP;
      return lane;
    });
    // Lanes side by side are as tall as each other: the tallest stack, and one free slot to drop into.
    const tallest = Math.max(0, ...row.map((lane) => lane.stackH));
    const h = HEADER_H + LANE_PAD + Math.max(minHeight, tallest + SLOT_H);
    for (const { stackH: _, ...lane } of row) lanes.push({ ...lane, y: top, h });
    top += h + LANE_GAP;
  }
  return {
    lanes,
    abreast,
    cardW,
    foldable: shut !== undefined,
    right: lanes.length > 0 ? Math.max(...lanes.map((lane) => lane.x + lane.w)) : left - LANE_GAP,
    bottom: top - LANE_GAP,
  };
}

/** What a lane's band says of its fold, where a reader is there to fold it. */
function foldOf(
  planned: Plan,
  lane: LanePlan,
  name: string,
  locale: Locale,
): Pick<Band, "folded" | "foldSaid"> {
  if (!planned.foldable) return {};
  const w = WORDS[locale];
  return { folded: lane.folded, foldSaid: lane.folded ? w.openLane(name, lane.count) : w.foldLane(name) };
}

export function layoutColumns(
  board: Board,
  format: Format,
  card: (e: Element, x: number, y: number, w: number) => Card,
  locale: Locale,
  seen?: Seen,
): Scene {
  const planned = plan(board, format, undefined, seen);
  const bands: Band[] = [];
  const cards: Card[] = [];
  for (const lane of planned.lanes) {
    bands.push({
      kind: "lane",
      id: lane.id,
      label: laneName(format, board, lane.id, locale),
      hint: laneHint(format, board, lane.id, locale),
      x: lane.x,
      y: lane.y,
      w: lane.w,
      h: lane.h,
      count: lane.count,
      above: lane.above,
      below: lane.below,
      skip: lane.skip,
      most: lane.most,
      room: lane.room,
      ...foldOf(planned, lane, laneName(format, board, lane.id, locale), locale),
    });
    for (const line of lane.lines)
      for (const { e, x } of line.cards)
        cards.push({ ...card(e, x, line.y, planned.cardW), ...(line.cut ? { cut: line.cut } : {}) });
  }
  let height = planned.bottom + MARGIN;
  const x = planAxis(format, board, "x", locale);
  const y = planAxis(format, board, "y", locale);
  if (x && y) {
    const first = planned.lanes[0];
    const leftEdge = first?.x ?? MARGIN + AXIS;
    bands.push(
      {
        kind: "axis",
        id: "y",
        label: y.label,
        x: MARGIN,
        y: MARGIN,
        w: AXIS,
        h: planned.bottom - MARGIN,
        low: y.low,
        high: y.high,
      },
      {
        kind: "axis",
        id: "x",
        label: x.label,
        x: leftEdge,
        y: planned.bottom,
        w: planned.right - leftEdge,
        h: AXIS,
        low: x.low,
        high: x.high,
      },
    );
    height = planned.bottom + AXIS + MARGIN / 2;
  }
  return { width: planned.right + MARGIN, height, bands, cards, connectors: [] };
}

/**
 * The free room of a lane: the next place in it, down to its foot. Under the
 * last card, or under the header of an empty lane; in a plan, beside the last
 * card while its row has room.
 */
export function roomInColumns(board: Board, format: Format, lane: string, seen?: Seen): Room | undefined {
  const planned = plan(board, format, undefined, seen);
  const cardW = planned.cardW;
  const found = planned.lanes.find((candidate) => candidate.id === lane);
  if (!found) return undefined;
  // A folded lane has no room to offer: a card dropped on it goes to its end, and nothing is added in it.
  if (found.folded) return undefined;
  const foot = found.y + found.h;
  const last = found.lines.at(-1);
  if (last && last.cards.length < planned.abreast) {
    const x = found.x + LANE_SIDE + last.cards.length * (cardW + ABREAST_GAP);
    return { x, y: last.y, w: cardW, h: foot - last.y };
  }
  // A column that scrolls alone keeps its free slot under its window, wherever its last card in view is cut.
  if (found.room !== undefined) {
    const under = found.y + HEADER_H + LANE_PAD + CHIP_H + found.room;
    return { x: found.x + LANE_SIDE, y: under, w: cardW, h: foot - under };
  }
  const y = last ? last.y + last.h : found.y + HEADER_H;
  return { x: found.x + LANE_SIDE, y, w: cardW, h: foot - y };
}

/** The lane under a point and the card the drop would land before; `moving` is left out of the count. */
export function locateInColumns(
  board: Board,
  format: Format,
  x: number,
  y: number,
  moving?: string,
  seen?: Seen,
): Target {
  const planned = plan(board, format, moving, seen);
  const edge = laneEdgeAt(planned, format, x, y);
  if (edge) return edge;
  // A lane goes on under its foot, as far as the pointer goes; a cell ends where the next one starts.
  const lane = planned.lanes.find(
    (candidate) =>
      x >= candidate.x &&
      x < candidate.x + candidate.w &&
      y >= candidate.y &&
      (!format.grid || y < candidate.y + candidate.h),
  );
  if (!lane) return { kind: "none" };
  const stack = lane.lines.flatMap((line) => line.cards.map((c) => ({ ...c, y: line.y, line })));
  const before =
    planned.abreast === 1
      ? // The drop lands before the first card whose upper half is at or below the pointer.
        stack.find((c) => y < c.y + elementHeight(c.e, charsFor(planned.cardW)) / 2)
      : // In a plan: on the row the pointer is in, before the first card whose left half is at or right of it.
        stack.find(
          (c) =>
            y < c.line.y + c.line.h + STACK_GAP / 2 &&
            (y < c.line.y - STACK_GAP / 2 || x < c.x + planned.cardW / 2),
        );
  // Under the last card of a window, the drop lands before the first card out of view, not at the end of the lane.
  return { kind: "slot", lane: lane.id, before: before?.e.id ?? lane.next };
}

/** How far to scroll its lane so that the card shows whole in its window (S306); undefined where none scrolls. */
export function skipToSee(
  board: Board,
  format: Format,
  id: string,
  seen: View,
): { lane: string; skip: number } | undefined {
  const lane = board.elements.find((e) => e.id === id)?.lane;
  if (lane === undefined || seen.tall === undefined || format.grid) return undefined;
  const planned = plan(board, format, undefined, seen);
  const stack = board.elements.filter((e) => e.lane === lane);
  const heights = stackLines(stack, 0, 0, planned.abreast, planned.cardW).lines.map((line) => line.h);
  const at = Math.floor(stack.findIndex((e) => e.id === id) / planned.abreast);
  const room = seen.tall - HEADER_H - LANE_PAD - SLOT_H;
  return { lane, skip: reveal(heights, seen.skip?.get(lane) ?? 0, room, STACK_GAP, at) };
}

/** What a column that scrolls alone shows of its cards. */
export interface LaneSeen {
  above: number;
  below: number;
  skip: number;
  most: number;
  room: number;
}

/** The columns that scroll alone in what the page sees of the board (S306), and what each shows: the page counts and scrolls by it. */
export function laneWindows(board: Board, format: Format, seen: View): Map<string, LaneSeen> {
  const windows = new Map<string, LaneSeen>();
  for (const { id, above = 0, below = 0, skip = 0, most = 0, room } of plan(board, format, undefined, seen)
    .lanes)
    if (room !== undefined) windows.set(id, { above, below, skip, most, room });
  return windows;
}

/** How far into a lane heading its edge reaches, either side of the gap. */
const EDGE_REACH = 10;

/** On a kanban, the edge between two lane headings, or past the last one, under the point. */
function laneEdgeAt(planned: Plan, format: Format, x: number, y: number): Target | undefined {
  if (!format.ownLanes || format.grid) return undefined;
  const first = planned.lanes[0];
  if (!first || y < first.y || y >= first.y + HEADER_H) return undefined;
  for (const lane of planned.lanes)
    if (x >= lane.x - LANE_GAP - EDGE_REACH && x < lane.x + EDGE_REACH)
      return { kind: "lane-edge", before: lane.id };
  if (x >= planned.right - EDGE_REACH && x < planned.right + LANE_GAP + EDGE_REACH)
    return { kind: "lane-edge" };
  return undefined;
}

/** Where a lane added before `before` (else last) is offered: on the edge, the height of the headings. */
export function roomOnLaneEdge(
  board: Board,
  format: Format,
  before: string | undefined,
  seen?: Seen,
): Room | undefined {
  const planned = plan(board, format, undefined, seen);
  const first = planned.lanes[0];
  if (!first) return undefined;
  const next = before === undefined ? undefined : planned.lanes.find((lane) => lane.id === before);
  if (before !== undefined && !next) return undefined;
  const x = next ? next.x - LANE_GAP / 2 : planned.right + LANE_GAP / 2;
  return { x, y: first.y, w: 0, h: HEADER_H };
}

/** The heading of a lane, where what is done to the whole lane is offered. */
export function laneHeading(board: Board, format: Format, lane: string, seen?: Seen): Room | undefined {
  const found = plan(board, format, undefined, seen).lanes.find((candidate) => candidate.id === lane);
  return found && { x: found.x, y: found.y, w: found.w, h: HEADER_H };
}

/**
 * Where a lane dragged by its heading would land with the pointer at `x`: before
 * the first other lane whose middle is right of it, else last; `x` is the edge
 * it would land on. Undefined where it already is.
 */
export function dropLane(
  board: Board,
  format: Format,
  x: number,
  moving: string,
  seen?: Seen,
): { before?: string; x: number } | undefined {
  const planned = plan(board, format, undefined, seen);
  const others = planned.lanes.filter((lane) => lane.id !== moving);
  const next = others.find((lane) => x < lane.x + lane.w / 2);
  const order = planned.lanes.map((lane) => lane.id);
  if (order[order.indexOf(moving) + 1] === next?.id) return undefined;
  return next ? { before: next.id, x: next.x - LANE_GAP / 2 } : { x: planned.right + LANE_GAP / 2 };
}

/**
 * How far a lane's name slides right when the board has scrolled past the lane's
 * left edge: it stays in sight, and never leaves its lane, whose right end keeps
 * `room` for the name and the count.
 */
export function headingSlide(lane: { x: number; w: number }, left: number, room: number): number {
  return Math.max(0, Math.min(left - lane.x, lane.w - room));
}
