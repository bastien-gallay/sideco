/**
 * The checks a command passes before it becomes events: the board, the format,
 * the element, the note, the lane or the slice it names must be there, or the
 * command is refused with a message that says which one is missing.
 */
import { CommandError } from "./commands.ts";
import { type Format, findFormat, lanesOf } from "./formats.ts";
import { type Board, type Element, findElement, type Note, type Workspace } from "./workspace.ts";

export function noBoard(ws: Workspace, id: string): CommandError {
  const known = ws.boards.map((b) => b.id).join(", ") || "none yet";
  return new CommandError(`no board "${id}" (boards: ${known})`);
}

export function refuse(value: unknown, field: string, format: Format, why: string): void {
  if (value !== undefined) throw new CommandError(`${format.name.en} boards take no \`${field}\`: ${why}`);
}

export function requireFormat(id: string): Format {
  const format = findFormat(id);
  if (!format) throw new CommandError(`unknown format "${id}"`);
  return format;
}

export function requireElement(board: Board, id: string): Element {
  const el = findElement(board, id);
  if (!el) throw new CommandError(`no element ${id} on "${board.id}"`);
  return el;
}

export function requireNote(board: Board, id: string): Note {
  const note = board.notes.find((n) => n.id === id);
  if (!note) throw new CommandError(`no note ${id} on "${board.id}"`);
  return note;
}

export function requireSliced(format: Format): void {
  if (!format.sliced) throw new CommandError(`${format.name.en} boards have no slices`);
}

export function requireSlice(board: Board, slice: string): string {
  const ids = (board.slices ?? []).map((s) => s.id);
  if (!ids.includes(slice))
    throw new CommandError(`no slice "${slice}" on "${board.id}" (slices: ${ids.join(", ") || "none"})`);
  return slice;
}

export function requireLane(board: Board, format: Format, lane: string): string {
  const lanes = lanesOf(board);
  if (!lanes.includes(lane)) {
    throw new CommandError(`${format.name.en} has no lane "${lane}" (lanes: ${lanes.join(", ")})`);
  }
  return lane;
}
export function requireOwnLanes(format: Format, verb: string): void {
  if (!format.ownLanes)
    throw new CommandError(`${format.name.en} boards have no lanes to ${verb}: their workshop sets them`);
}
