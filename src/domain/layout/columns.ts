/**
 * Columns layout: one named lane per column, elements stacked top to bottom in
 * board order. Kanban, retrospectives, any "sort these into buckets" workshop.
 *
 * A format that gives its lanes a `grid` has them laid as the cells of a plan
 * instead: so many lanes per row, cards abreast in a cell, and the two axes
 * named beside it. The lanes and the order of their cards stay what they are.
 */

import { type Format, laneName, lanesOf } from "../formats.ts";
import type { Locale } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";
import {
  type Band,
  CARD_H,
  CARD_W,
  type Card,
  charsFor,
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
/** Shared out over a window, a card is never narrower than this: a line still holds a few words. */
const MIN_CARD_W = 120;
/** Nor wider than this: past it, a line is too long to read at a glance. */
const MAX_CARD_W = 320;

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
  /** The width of every card. */
  cardW: number;
  right: number;
  bottom: number;
}

/**
 * How wide a card is. Lanes side by side share out the `span` they are given,
 * within bounds; a plan keeps its cells, and without a span every card keeps
 * its own width.
 */
function cardWidth(format: Format, lanes: number, span: number | undefined): number {
  if (span === undefined || format.grid || lanes === 0) return CARD_W;
  const laneW = Math.floor((span - 2 * MARGIN - (lanes - 1) * LANE_GAP) / lanes);
  return Math.min(MAX_CARD_W, Math.max(MIN_CARD_W, laneW - 2 * LANE_SIDE));
}

/**
 * Where every lane and every card goes. `without` is a card in the human's
 * hand: it takes no place. `span` is the width the board has on screen.
 */
function plan(board: Board, format: Format, without?: string, span?: number): Plan {
  const grid = format.grid;
  const ids = lanesOf(board);
  const perRow = grid?.perRow ?? ids.length;
  const abreast = grid?.abreast ?? 1;
  const cardW = cardWidth(format, ids.length, span);
  const chars = charsFor(cardW);
  const laneW = 2 * LANE_SIDE + abreast * cardW + (abreast - 1) * ABREAST_GAP;
  const left = MARGIN + (grid ? AXIS : 0);
  const minHeight = (grid ? MIN_SLOTS_IN_CELL : MIN_SLOTS) * SLOT_H;

  const lanes: LanePlan[] = [];
  let top = MARGIN;
  for (let start = 0; start < ids.length; start += perRow) {
    const row = ids.slice(start, start + perRow).map((id, i) => {
      const x = left + i * (laneW + LANE_GAP);
      const stack = board.elements.filter((e) => e.lane === id && e.id !== without);
      const lines: Line[] = [];
      let y = top + HEADER_H + LANE_PAD;
      for (let at = 0; at < stack.length; at += abreast) {
        const cards = stack
          .slice(at, at + abreast)
          .map((e, k) => ({ e, x: x + LANE_SIDE + k * (cardW + ABREAST_GAP) }));
        const h = Math.max(...cards.map((c) => labelHeight(c.e.label, chars)));
        lines.push({ y, h, cards });
        y += h + STACK_GAP;
      }
      const stackH = y - (top + HEADER_H + LANE_PAD);
      return { id, x, lines, count: stack.length, stackH };
    });
    // Lanes side by side are as tall as each other: the tallest stack, and one free slot to drop into.
    const tallest = Math.max(0, ...row.map((lane) => lane.stackH));
    const h = HEADER_H + LANE_PAD + Math.max(minHeight, tallest + SLOT_H);
    for (const { id, x, lines, count } of row) lanes.push({ id, x, y: top, w: laneW, h, lines, count });
    top += h + LANE_GAP;
  }
  const columns = Math.min(perRow, ids.length);
  return {
    lanes,
    abreast,
    cardW,
    right: left + columns * (laneW + LANE_GAP) - LANE_GAP,
    bottom: top - LANE_GAP,
  };
}

export function layoutColumns(
  board: Board,
  format: Format,
  card: (e: Element, x: number, y: number, w: number) => Card,
  locale: Locale,
  span?: number,
): Scene {
  const planned = plan(board, format, undefined, span);
  const bands: Band[] = [];
  const cards: Card[] = [];
  for (const lane of planned.lanes) {
    const said = format.lanes.find((candidate) => candidate.id === lane.id);
    bands.push({
      kind: "lane",
      id: lane.id,
      label: laneName(format, board, lane.id, locale),
      hint: said?.hint?.[locale],
      x: lane.x,
      y: lane.y,
      w: lane.w,
      h: lane.h,
      count: lane.count,
    });
    for (const line of lane.lines)
      for (const { e, x } of line.cards) cards.push(card(e, x, line.y, planned.cardW));
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
export function roomInColumns(board: Board, format: Format, lane: string, span?: number): Room | undefined {
  const planned = plan(board, format, undefined, span);
  const cardW = planned.cardW;
  const found = planned.lanes.find((candidate) => candidate.id === lane);
  if (!found) return undefined;
  const foot = found.y + found.h;
  const last = found.lines.at(-1);
  if (last && last.cards.length < planned.abreast) {
    const x = found.x + LANE_SIDE + last.cards.length * (cardW + ABREAST_GAP);
    return { x, y: last.y, w: cardW, h: foot - last.y };
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
  span?: number,
): Target {
  const planned = plan(board, format, moving, span);
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
        stack.find((c) => y < c.y + labelHeight(c.e.label, charsFor(planned.cardW)) / 2)
      : // In a plan: on the row the pointer is in, before the first card whose left half is at or right of it.
        stack.find(
          (c) =>
            y < c.line.y + c.line.h + STACK_GAP / 2 &&
            (y < c.line.y - STACK_GAP / 2 || x < c.x + planned.cardW / 2),
        );
  return { kind: "slot", lane: lane.id, before: before?.e.id };
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
  span?: number,
): Room | undefined {
  const planned = plan(board, format, undefined, span);
  const first = planned.lanes[0];
  if (!first) return undefined;
  const next = before === undefined ? undefined : planned.lanes.find((lane) => lane.id === before);
  if (before !== undefined && !next) return undefined;
  const x = next ? next.x - LANE_GAP / 2 : planned.right + LANE_GAP / 2;
  return { x, y: first.y, w: 0, h: HEADER_H };
}

/** The heading of a lane, where what is done to the whole lane is offered. */
export function laneHeading(board: Board, format: Format, lane: string, span?: number): Room | undefined {
  const found = plan(board, format, undefined, span).lanes.find((candidate) => candidate.id === lane);
  return found && { x: found.x, y: found.y, w: found.w, h: HEADER_H };
}
