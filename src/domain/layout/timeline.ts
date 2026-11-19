/**
 * Timeline layout: one row per element type, one column per step in time.
 * Columns are numbered from 1. Elements sharing a cell stack in board order. A
 * spare column stays open on the right so the timeline can always be extended.
 */

import type { Format } from "../formats.ts";
import type { Locale } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";
import { lastColumn } from "../workspace.ts";
import {
  type Band,
  CARD_W,
  type Card,
  labelHeight,
  MARGIN,
  type Room,
  type Scene,
  type Target,
} from "./scene.ts";

export const COL_W = 176;
const HEADER_W = 136;
const TOP_H = 32;
const ROW_PAD = 12;
const STACK_GAP = 8;
const EMPTY_ROW_H = 44;

interface Row {
  type: string;
  y: number;
  h: number;
}

export interface TimelineGrid {
  rows: Row[];
  columns: number;
}

export function timelineGrid(board: Board, format: Format): TimelineGrid {
  let y = TOP_H;
  const rows = format.types.map((type) => {
    const tallest = Math.max(0, ...cellHeights(board.elements.filter((e) => e.type === type.id)));
    const h = tallest === 0 ? EMPTY_ROW_H : 2 * ROW_PAD + tallest;
    const row = { type: type.id, y, h };
    y += h;
    return row;
  });
  return { rows, columns: lastColumn(board) + 1 };
}

/** Per column, the room its stack takes: each card as tall as its label, a gap between two. */
function cellHeights(elements: Element[]): number[] {
  const heights = new Map<number, number>();
  for (const e of elements) {
    const above = heights.get(e.col);
    heights.set(e.col, (above === undefined ? 0 : above + STACK_GAP) + labelHeight(e.label));
  }
  return [...heights.values()];
}

export function layoutTimeline(
  board: Board,
  format: Format,
  card: (e: Element, x: number, y: number) => Card,
  locale: Locale,
): Scene {
  const grid = timelineGrid(board, format);
  const width = HEADER_W + grid.columns * COL_W + MARGIN;
  const bottom = grid.rows.reduce((max, row) => Math.max(max, row.y + row.h), TOP_H);

  const bands: Band[] = [];
  for (let col = 1; col <= grid.columns; col++) {
    bands.push({
      kind: "step",
      id: String(col),
      label: String(col),
      x: columnX(col),
      y: 0,
      w: COL_W,
      h: bottom,
    });
  }
  for (const row of grid.rows) {
    const type = format.types.find((t) => t.id === row.type);
    bands.push({
      kind: "row",
      id: row.type,
      label: type?.label[locale] ?? row.type,
      x: 0,
      y: row.y,
      w: width,
      h: row.h,
      swatch: type?.fill,
    });
  }

  const cards: Card[] = [];
  /** Per cell, where its next card goes, below the ones already placed. */
  const filled = new Map<string, number>();
  for (const e of board.elements) {
    const row = grid.rows.find((candidate) => candidate.type === e.type);
    if (!row) continue;
    const cell = `${e.type}:${e.col}`;
    const above = filled.get(cell) ?? 0;
    const x = columnX(e.col) + (COL_W - CARD_W) / 2;
    const placed = card(e, x, row.y + ROW_PAD + above);
    cards.push(placed);
    filled.set(cell, above + placed.h + STACK_GAP);
  }
  return { width, height: bottom + MARGIN, bands, cards, connectors: [] };
}

/**
 * The cell under a point; above the rows, the edge between two steps nearest
 * to it, as far as steps hold cards; `none` outside the grid.
 */
export function locateInTimeline(
  board: Board,
  format: Format,
  x: number,
  y: number,
  moving?: string,
): Target {
  if (y >= 0 && y < TOP_H) {
    const edge = columnBoundary(x);
    const inReach = x >= HEADER_W - COL_W / 2 && edge <= lastColumn(board);
    return inReach ? { kind: "boundary", col: edge } : { kind: "none" };
  }
  const grid = timelineGrid(board, format);
  const row = grid.rows.find((candidate) => y >= candidate.y && y < candidate.y + candidate.h);
  const col = Math.floor((x - HEADER_W) / COL_W) + 1;
  if (!row || col < 1 || col > grid.columns) return { kind: "none" };
  // The stack as it would be without the card in the hand: the drop lands before the first card whose upper half is under the pointer.
  let top = row.y + ROW_PAD;
  const before = board.elements
    .filter((e) => e.col === col && e.type === row.type && e.id !== moving)
    .find((e) => {
      const h = labelHeight(e.label);
      const under = y < top + h / 2;
      top += h + STACK_GAP;
      return under;
    });
  return { kind: "cell", col, type: row.type, ...(before ? { before: before.id } : {}) };
}

/** The free room of a cell: under its stack, or from the top of an empty cell, down to the foot of its row. */
export function roomInTimeline(board: Board, format: Format, col: number, type: string): Room | undefined {
  const grid = timelineGrid(board, format);
  const row = grid.rows.find((candidate) => candidate.type === type);
  if (!row || col < 1 || col > grid.columns) return undefined;
  const [stack] = cellHeights(board.elements.filter((e) => e.type === type && e.col === col));
  const y = stack === undefined ? row.y : row.y + ROW_PAD + stack;
  return { x: columnX(col) + (COL_W - CARD_W) / 2, y, w: CARD_W, h: row.y + row.h - y };
}

/** Where an edge between two steps is pointed at: on its rule, as high as the heading of the steps. */
export function roomOnBoundary(col: number): Room {
  return { x: columnX(col), y: 0, w: 0, h: TOP_H };
}

/** The column whose left edge is nearest to `x`: a column inserted there takes that number. */
function columnBoundary(x: number): number {
  return Math.max(1, Math.round((x - HEADER_W) / COL_W) + 1);
}

function columnX(col: number): number {
  return HEADER_W + (col - 1) * COL_W;
}
