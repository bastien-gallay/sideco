/**
 * Element ids: how a board gives one out, and checks one a caller chose.
 *
 * A board never gives an id twice: `minted` keeps the highest number used per
 * prefix, and `retired` the ids of the elements it removed.
 */

import { CommandError } from "./commands.ts";
import type { ElementType } from "./formats.ts";
import type { Board } from "./workspace.ts";

/** The number part of an id shaped `<letter><digits>`, or 0. */
export function idNumber(id: string): number {
  const n = Number(id.slice(1));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** The next id with this prefix: one above the highest ever used. */
export function mint(board: Board, prefix: string): string {
  return `${prefix}${(board.minted[prefix] ?? 0) + 1}`;
}

/** An id chosen by the caller is accepted only if no element, present or removed, ever had it. */
export function claim(board: Board, type: ElementType, id: string): string {
  if (id.charAt(0) !== type.prefix && id.charAt(0) !== type.formerPrefix) {
    throw new CommandError(`a ${type.id} id starts with ${type.prefix}, got ${id}`);
  }
  if (board.elements.some((e) => e.id === id) || board.retired.includes(id)) {
    throw new CommandError(
      `${id} was already used on "${board.id}"; ids are never reused (next: ${mint(board, type.prefix)})`,
    );
  }
  return id;
}

/** Count an id the board now holds, so that none is minted twice. */
export function remember(board: Board, id: string): void {
  const prefix = id.charAt(0);
  board.minted[prefix] = Math.max(board.minted[prefix] ?? 0, idNumber(id));
}
