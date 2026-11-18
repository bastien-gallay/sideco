/**
 * Columns layout: one named lane per column, elements stacked top to bottom in
 * board order. Kanban, retrospectives, any "sort these into buckets" workshop.
 *
 * A format that gives its lanes a `grid` has them laid as the cells of a plan
 * instead: so many lanes per row, cards abreast in a cell, and the two axes
 * named beside it. The lanes and the order of their cards stay what they are.
 */

import type { Format } from "../formats.ts";
import type { Locale } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";
import {
  type Band,
  CARD_H,
  CARD_W,
  type Card,
  labelHeight,
  MARGIN,
  type Room,
  type Scene,
  type Target,
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

/** A row of cards abreast in a lane. */
interface Line {
  y: number;
  h: number;
  cards: { e: Element; x: number }[];
}

interface LanePlan {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: Line[];
  count: number;
}

interface Plan {
  lanes: LanePlan[];
  /** Cards abreast in a lane. */
  abreast: number;
  right: number;
  bottom: number;
}

/** Where every lane and every card goes. `without` is a card in the human's hand: it takes no place. */
function plan(board: Board, format: Format, without?: string): Plan {
  const grid = format.grid;
  const perRow = grid?.perRow ?? format.lanes.length;
  const abreast = grid?.abreast ?? 1;
  const laneW = 2 * LANE_SIDE + abreast * CARD_W + (abreast - 1) * ABREAST_GAP;
  const left = MARGIN + (grid ? AXIS : 0);
  const minHeight = (grid ? MIN_SLOTS_IN_CELL : MIN_SLOTS) * SLOT_H;

  const lanes: LanePlan[] = [];
  let top = MARGIN;
  for (let start = 0; start < format.lanes.length; start += perRow) {
    const row = format.lanes.slice(start, start + perRow).map((lane, i) => {
      const x = left + i * (laneW + LANE_GAP);
      const stack = board.elements.filter((e) => e.lane === lane.id && e.id !== without);
      const lines: Line[] = [];
      let y = top + HEADER_H + LANE_PAD;
      for (let at = 0; at < stack.length; at += abreast) {
        const cards = stack
          .slice(at, at + abreast)
          .map((e, k) => ({ e, x: x + LANE_SIDE + k * (CARD_W + ABREAST_GAP) }));
        const h = Math.max(...cards.map((c) => labelHeight(c.e.label)));
        lines.push({ y, h, cards });
        y += h + STACK_GAP;
      }
      const stackH = y - (top + HEADER_H + LANE_PAD);
      return { id: lane.id, x, lines, count: stack.length, stackH };
    });
    // Lanes side by side are as tall as each other: the tallest stack, and one free slot to drop into.
    const tallest = Math.max(0, ...row.map((lane) => lane.stackH));
    const h = HEADER_H + LANE_PAD + Math.max(minHeight, tallest + SLOT_H);
    for (const { id, x, lines, count } of row) lanes.push({ id, x, y: top, w: laneW, h, lines, count });
    top += h + LANE_GAP;
  }
  const columns = Math.min(perRow, format.lanes.length);
  return {
    lanes,
    abreast,
    right: left + columns * (laneW + LANE_GAP) - LANE_GAP,
    bottom: top - LANE_GAP,
  };
}

export function layoutColumns(
  board: Board,
  format: Format,
  card: (e: Element, x: number, y: number) => Card,
  locale: Locale,
): Scene {
  const planned = plan(board, format);
  const bands: Band[] = [];
  const cards: Card[] = [];
  for (const lane of planned.lanes) {
    const said = format.lanes.find((candidate) => candidate.id === lane.id);
    bands.push({
      kind: "lane",
      id: lane.id,
      label: said?.label[locale] ?? lane.id,
      hint: said?.hint?.[locale],
      x: lane.x,
      y: lane.y,
      w: lane.w,
      h: lane.h,
      count: lane.count,
    });
    for (const line of lane.lines) for (const { e, x } of line.cards) cards.push(card(e, x, line.y));
  }
  let height = planned.bottom + MARGIN;
  if (format.grid) {
    const { x, y } = format.grid;
    const first = planned.lanes[0];
    const leftEdge = first?.x ?? MARGIN + AXIS;
    bands.push(
      { kind: "axis", id: "y", label: y[locale], x: MARGIN, y: MARGIN, w: AXIS, h: planned.bottom - MARGIN },
      {
        kind: "axis",
        id: "x",
        label: x[locale],
        x: leftEdge,
        y: planned.bottom,
        w: planned.right - leftEdge,
        h: AXIS,
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
export function roomInColumns(board: Board, format: Format, lane: string): Room | undefined {
  const planned = plan(board, format);
  const found = planned.lanes.find((candidate) => candidate.id === lane);
  if (!found) return undefined;
  const foot = found.y + found.h;
  const last = found.lines.at(-1);
  if (last && last.cards.length < planned.abreast) {
    const x = found.x + LANE_SIDE + last.cards.length * (CARD_W + ABREAST_GAP);
    return { x, y: last.y, w: CARD_W, h: foot - last.y };
  }
  const y = last ? last.y + last.h : found.y + HEADER_H;
  const x = planned.abreast === 1 ? found.x + (found.w - CARD_W) / 2 : found.x + LANE_SIDE;
  return { x, y, w: CARD_W, h: foot - y };
}

/** The lane under a point and the card the drop would land before; `moving` is left out of the count. */
export function locateInColumns(board: Board, format: Format, x: number, y: number, moving?: string): Target {
  const planned = plan(board, format, moving);
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
        stack.find((c) => y < c.y + labelHeight(c.e.label) / 2)
      : // In a plan: on the row the pointer is in, before the first card whose left half is at or right of it.
        stack.find(
          (c) =>
            y < c.line.y + c.line.h + STACK_GAP / 2 && (y < c.line.y - STACK_GAP / 2 || x < c.x + CARD_W / 2),
        );
  return { kind: "slot", lane: lane.id, before: before?.e.id };
}
