/**
 * Timeline layout: one row per element type, one column per step in time.
 * Columns are numbered from 1. Elements sharing a cell stack in board order. A
 * spare column stays open on the right so the timeline can always be extended.
 */
import type { Format } from "../formats.ts";
import type { Board, Element } from "../workspace.ts";
import { lastColumn } from "../workspace.ts";
import { type Band, CARD_H, CARD_W, type Card, MARGIN, type Scene, type Target } from "./scene.ts";

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
    const deepest = Math.max(0, ...stackSizes(board.elements.filter((e) => e.type === type.id)));
    const h = deepest === 0 ? EMPTY_ROW_H : 2 * ROW_PAD + deepest * CARD_H + (deepest - 1) * STACK_GAP;
    const row = { type: type.id, y, h };
    y += h;
    return row;
  });
  return { rows, columns: lastColumn(board) + 1 };
}

function stackSizes(elements: Element[]): number[] {
  const sizes = new Map<number, number>();
  for (const e of elements) sizes.set(e.col, (sizes.get(e.col) ?? 0) + 1);
  return [...sizes.values()];
}

export function layoutTimeline(
  board: Board,
  format: Format,
  card: (e: Element, x: number, y: number) => Card,
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
      label: type?.label ?? row.type,
      x: 0,
      y: row.y,
      w: width,
      h: row.h,
      swatch: type?.fill,
    });
  }

  const cards: Card[] = [];
  const depth = new Map<string, number>();
  for (const e of board.elements) {
    const row = grid.rows.find((candidate) => candidate.type === e.type);
    if (!row) continue;
    const cell = `${e.type}:${e.col}`;
    const k = depth.get(cell) ?? 0;
    depth.set(cell, k + 1);
    const x = columnX(e.col) + (COL_W - CARD_W) / 2;
    cards.push(card(e, x, row.y + ROW_PAD + k * (CARD_H + STACK_GAP)));
  }
  return { width, height: bottom + MARGIN, bands, cards, connectors: [] };
}

/** The cell under a point, or `none` outside the grid. */
export function locateInTimeline(board: Board, format: Format, x: number, y: number): Target {
  const grid = timelineGrid(board, format);
  const row = grid.rows.find((candidate) => y >= candidate.y && y < candidate.y + candidate.h);
  const col = Math.floor((x - HEADER_W) / COL_W) + 1;
  if (!row || col < 1 || col > grid.columns) return { kind: "none" };
  return { kind: "cell", col, type: row.type };
}

/** The column whose left edge is nearest to `x`: a column inserted there takes that number. */
export function columnBoundary(x: number): number {
  return Math.max(1, Math.round((x - HEADER_W) / COL_W) + 1);
}

function columnX(col: number): number {
  return HEADER_W + (col - 1) * COL_W;
}
