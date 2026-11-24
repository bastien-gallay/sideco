/**
 * What a card carried by the pointer and let go asks for: a move to the step,
 * the cell or the lane it was let go on; on a diagram, the point it was let go
 * at, `to`, its top left corner (S344). Undefined where it already is, or where
 * it was let go on nothing.
 */
import type { Command } from "../domain/commands.ts";
import { findFormat } from "../domain/formats.ts";
import type { Target } from "../domain/layout/index.ts";
import type { Board } from "../domain/workspace.ts";

export function dropCommand(
  board: Board,
  id: string,
  target: Target,
  to: { x: number; y: number; span?: number },
): Command | undefined {
  const element = board.elements.find((e) => e.id === id);
  if (element && findFormat(board.format)?.layout === "graph") {
    const spot = { id, x: Math.max(0, Math.round(to.x)), y: Math.max(0, Math.round(to.y)) };
    return {
      kind: "place",
      board: board.id,
      cards: [spot],
      ...(to.span ? { span: Math.round(to.span) } : {}),
    };
  }
  if (element && target.kind === "cell" && target.type === element.type) {
    // Into another step, or to another place in its own cell; where it already is, nothing is sent.
    const cell = board.elements.filter((e) => e.col === element.col && e.type === element.type);
    const next = cell[cell.indexOf(element) + 1]?.id;
    if (target.col === element.col && target.before === next) return undefined;
    return {
      kind: "move",
      board: board.id,
      id,
      col: target.col,
      ...(target.before ? { before: target.before } : {}),
    };
  }
  if (element && target.kind === "cell" && target.col !== element.col)
    return { kind: "move", board: board.id, id, col: target.col };
  if (element && target.kind === "slot")
    return { kind: "move", board: board.id, id, lane: target.lane, before: target.before };
  return undefined;
}
