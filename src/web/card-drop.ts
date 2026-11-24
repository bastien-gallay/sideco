/**
 * What a card carried by the pointer and let go asks for: a move to the step,
 * the cell or the lane it was let go on; on a diagram, the point it was let go
 * at, `to`, its top left corner (S344). Undefined where it already is, or where
 * it was let go on nothing.
 */
import type { Command } from "../domain/commands.ts";
import { findFormat } from "../domain/formats.ts";
import type { Scene, Target } from "../domain/layout/index.ts";
import type { Board } from "../domain/workspace.ts";
import { t } from "./locale.ts";
import { type Direction, keyMove } from "./view.ts";

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

/** How far Shift and an arrow carry a card of a diagram: half the gap between two cards. */
const NUDGE = 16;
const NUDGES: Record<Direction, [number, number]> = {
  left: [-NUDGE, 0],
  right: [NUDGE, 0],
  up: [0, -NUDGE],
  down: [0, NUDGE],
};

/** What Shift and an arrow ask for: a move on a board of rows and columns; on a diagram, a place. */
export function keyCommand(board: Board, scene: Scene, id: string, direction: Direction, span?: number) {
  if (findFormat(board.format)?.layout !== "graph") return keyMove(board, id, direction);
  return keyPlace(board, scene, id, direction, span);
}

/** Shift and an arrow on a card of a diagram: a little that way, and the diagram goes Snap (S344). */
function keyPlace(board: Board, scene: Scene, id: string, direction: Direction, span?: number) {
  const card = scene.cards.find((c) => c.id === id);
  const [dx, dy] = NUDGES[direction];
  return card && dropCommand(board, id, { kind: "none" }, { x: card.x + dx, y: card.y + dy, span });
}

/** Where a move sends a card, in words for the ear: a step, a lane, or a point of a diagram. */
export function whereTo(command: Command, scene: Scene): string | undefined {
  if (command.kind === "place") return command.cards.map((spot) => `${spot.x}, ${spot.y}`).join("; ");
  if (command.kind !== "move") return undefined;
  if (command.col !== undefined) return t.step(command.col);
  return scene.bands.find((band) => band.kind === "lane" && band.id === command.lane)?.label;
}

/** The Snap switch of a diagram: on, its cards stay where the page shows them, `span` wide. */
export function snapCommand(board: Board, on: boolean, span?: number): Command {
  return { kind: "placing", board: board.id, byHand: on, ...(span ? { span: Math.round(span) } : {}) };
}
