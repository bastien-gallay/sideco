/**
 * The columns of a timeline, numbered from 1: the last one in use, and the
 * number a column takes when another moves past it.
 */
import type { Board } from "./workspace.ts";

/** The number a column carries once the column `from` has moved to `to`: the ones it passes close the gap. */
export function columnAfterMove(col: number, from: number, to: number): number {
  if (col === from) return to;
  if (from < to && col > from && col <= to) return col - 1;
  if (to < from && col >= to && col < from) return col + 1;
  return col;
}

/** The highest column in use; 0 on an empty board, since columns are numbered from 1. */
export function lastColumn(board: Board): number {
  return board.elements.reduce((max, e) => Math.max(max, e.col), 0);
}
