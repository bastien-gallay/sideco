/**
 * Where a card goes: the place a new card takes, beside a card or in its kind's
 * home, and where a move sends one. Read by `decide`; nothing here changes the board.
 */
import { lastColumn } from "./columns.ts";
import { type Command, CommandError } from "./commands.ts";
import type { BoardEvent } from "./events.ts";
import { type ElementType, type Format, lanesOf } from "./formats.ts";
import { refuse, requireElement, requireLane } from "./guards.ts";
import { type Board, type Element, findElement } from "./workspace.ts";

/** A new card goes before `anchor` only if they share a cell: a lane, or a column and a row. */
export function besideIn(
  format: Format,
  anchor: Element,
  place: { type: string; col: number; lane: string },
): void {
  switch (format.layout) {
    case "timeline":
      if (anchor.type !== place.type)
        throw new CommandError(`${anchor.id} is a ${anchor.type}, not a ${place.type}`);
      if (anchor.col !== place.col) throw new CommandError(`${anchor.id} is not in column ${place.col}`);
      return;
    case "columns":
      if (anchor.lane !== place.lane) throw new CommandError(`${anchor.id} is not in lane "${place.lane}"`);
      return;
    case "graph":
      throw new CommandError(
        `${format.name.en} boards place elements from their links; link or unlink instead`,
      );
  }
}

export function placeNew(
  board: Board,
  format: Format,
  type: ElementType,
  cmd: { col?: number; lane?: string },
): { col: number; lane: string } {
  switch (format.layout) {
    case "timeline":
      refuse(cmd.lane, "lane", format, "elements are placed by column");
      return { col: cmd.col ?? lastColumn(board) + 1, lane: "" };
    case "columns":
      refuse(cmd.col, "col", format, "elements are placed by lane");
      return { col: 1, lane: requireLane(board, format, cmd.lane ?? homeOf(board, type)) };
    case "graph":
      refuse(cmd.col, "col", format, "positions follow the links");
      refuse(cmd.lane, "lane", format, "positions follow the links");
      return { col: 1, lane: "" };
  }
}

export type Moved = Extract<BoardEvent, { event: "ElementMoved" }>;

export function move(board: Board, format: Format, cmd: Extract<Command, { kind: "move" }>): Moved {
  const el = requireElement(board, cmd.id);
  switch (format.layout) {
    case "timeline":
      refuse(cmd.lane, "lane", format, "elements move between columns");
      return moveInTimeline(board, el, cmd);
    case "columns": {
      refuse(cmd.col, "col", format, "elements move between lanes");
      const lane = requireLane(board, format, cmd.lane ?? el.lane);
      if (cmd.before !== undefined) {
        const anchor = requireElement(board, cmd.before);
        if (anchor.id === el.id) throw new CommandError(`${el.id} cannot be placed before itself`);
        if (anchor.lane !== lane) throw new CommandError(`${anchor.id} is not in lane "${lane}"`);
      }
      return { event: "ElementMoved", board: board.id, id: el.id, col: el.col, lane, before: cmd.before };
    }
    case "graph":
      throw new CommandError(
        `${format.name.en} boards place elements from their links; link or unlink instead`,
      );
  }
}

/**
 * Whether a move leaves the card where it is: same lane and column, and the same
 * card after it in its cell (none, when it is sent to the end and already last).
 * A cell is a lane of a kanban, whatever the types; a column and a type row of a timeline.
 */
export function stays(board: Board, format: Format, moved: Moved): boolean {
  const el = findElement(board, moved.id);
  if (!el || el.lane !== moved.lane || el.col !== moved.col) return false;
  const cell = board.elements.filter(
    (other) =>
      other.lane === el.lane &&
      other.col === el.col &&
      (format.layout !== "timeline" || other.type === el.type),
  );
  return cell[cell.indexOf(el) + 1]?.id === moved.before;
}

/** Where a card goes when no lane is said: its kind's home, when the board has it, else the first lane. */
function homeOf(board: Board, type: ElementType): string {
  const lanes = lanesOf(board);
  return type.home && lanes.includes(type.home) ? type.home : (lanes[0] ?? "");
}

/**
 * To a column, last in its cell; or before a card of that cell, which says the
 * column when none is named. A cell is a column and a row: the cards of one type.
 */
function moveInTimeline(board: Board, el: Element, cmd: Extract<Command, { kind: "move" }>): Moved {
  const anchor = cmd.before === undefined ? undefined : requireElement(board, cmd.before);
  const col = cmd.col ?? anchor?.col;
  if (col === undefined) throw new CommandError(`moving ${el.id} needs a column`);
  if (anchor) {
    if (anchor.id === el.id) throw new CommandError(`${el.id} cannot be placed before itself`);
    if (anchor.type !== el.type) throw new CommandError(`${anchor.id} is not a ${el.type}, like ${el.id}`);
    if (anchor.col !== col) throw new CommandError(`${anchor.id} is not in column ${col}`);
  }
  return { event: "ElementMoved", board: board.id, id: el.id, col, lane: el.lane, before: anchor?.id };
}
