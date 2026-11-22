/**
 * Element ids: how the project gives one out, and checks one a caller chose.
 *
 * An id is given once in the whole project, per letter: `minted` keeps, on each
 * board, the highest number used per prefix, and `retired` the ids of the
 * elements it removed. Removed boards count too, since an undo brings them back.
 * Lanes and slices are the exception: they are numbered per board (decide.ts).
 */

import { CommandError } from "./commands.ts";
import type { ElementType, Format } from "./formats.ts";
import type { Board, Workspace } from "./workspace.ts";

/** The number part of an id shaped `<letter><digits>`, or 0. */
export function idNumber(id: string): number {
  const n = Number(id.slice(1));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Every board whose ids are taken: those on the page and those an undo can bring back. */
function everyBoard(ws: Workspace): Board[] {
  return [...ws.boards, ...ws.removed];
}

/** The highest number ever used with this prefix in the project, 0 if none. */
export function highestUsed(ws: Workspace, prefix: string): number {
  return Math.max(0, ...everyBoard(ws).map((b) => b.minted[prefix] ?? 0));
}

/** The next id with this prefix: one above the highest ever used in the project. */
export function mint(ws: Workspace, prefix: string): string {
  return `${prefix}${highestUsed(ws, prefix) + 1}`;
}

/** The board that holds this id, or held it before removing its element. */
export function heldBy(ws: Workspace, id: string): Board | undefined {
  return everyBoard(ws).find((b) => b.elements.some((e) => e.id === id) || b.retired.includes(id));
}

/** "an actor", "a task": the article a kind takes in a refusal. */
function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

/** An id chosen by the caller is accepted only if no element of the project, present or removed, ever had it. */
export function claim(ws: Workspace, type: ElementType, id: string, format: Format): string {
  const letter = id.charAt(0);
  const former = type.formerPrefixes?.includes(letter) && !format.types.some((t) => t.prefix === letter);
  if (letter !== type.prefix && !former) {
    throw new CommandError(`${article(type.id)} ${type.id} id starts with ${type.prefix}, got ${id}`);
  }
  const holder = heldBy(ws, id);
  if (holder) {
    throw new CommandError(
      `${id} was already used on "${holder.id}"; ids are never reused (next: ${mint(ws, type.prefix)})`,
    );
  }
  return id;
}

/** Count an id the board now holds, so that none is minted twice. */
export function remember(board: Board, id: string): void {
  const prefix = id.charAt(0);
  board.minted[prefix] = Math.max(board.minted[prefix] ?? 0, idNumber(id));
}

/** Ids that an older journal gave on more than one board, with those boards, in id order. */
export function sharedIds(ws: Workspace): { id: string; boards: string[] }[] {
  const holders = new Map<string, string[]>();
  for (const board of ws.boards) {
    for (const e of board.elements) holders.set(e.id, [...(holders.get(e.id) ?? []), board.id]);
  }
  return [...holders]
    .filter(([, boards]) => boards.length > 1)
    .map(([id, boards]) => ({ id, boards: boards.sort() }))
    .sort((x, y) => x.id.charAt(0).localeCompare(y.id.charAt(0)) || idNumber(x.id) - idNumber(y.id));
}

/** The status line for those ids, a few named and the rest counted; none when every id is unique. */
export function sharedIdsLine(ws: Workspace): string[] {
  const shared = sharedIds(ws);
  if (shared.length === 0) return [];
  const named = shared.slice(0, 5).map((s) => `${s.id} (${s.boards.join(", ")})`);
  const more = shared.length > 5 ? `, and ${shared.length - 5} more` : "";
  return [`ids        ${shared.length} on several boards: ${named.join(", ")}${more}`];
}
