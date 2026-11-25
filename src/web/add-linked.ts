/**
 * A card added from another and linked from it, on any board (T272): where it
 * goes and of which kind, and the words of the gesture. A diagram had it by
 * Alt and an arrow; a card that leads to a kind had its plus. A does it
 * everywhere, and so does the list under ⋯.
 */
import { findFormat, findType } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import { type Board, findElement } from "../domain/workspace.ts";
import { type AddPlace, type Direction, keyAdd } from "./view.ts";

/** The name of the gesture, in the list under ⋯ of a card. */
export const ADD_LINKED: Record<Locale, string> = {
  en: "Add a linked card",
  fr: "Ajouter une carte liée",
};

/** Where the editor of a card added beside another stands: against its box, on the side the arrow points to. */
export function besideBox(r: DOMRect, direction: Direction, gap: number): { x: number; y: number } {
  const x = direction === "right" ? r.right + gap : direction === "left" ? r.left - r.width - gap : r.left;
  const y = direction === "down" ? r.bottom + gap : direction === "up" ? r.top - r.height - gap : r.top;
  return { x, y };
}

const under = (place: AddPlace | undefined, from: string): AddPlace | undefined =>
  place && { ...place, from };

/**
 * The `add` that makes a card linked from `id`: of the kind the card leads to where it leads to one (a story to
 * a task), the board placing it; else of its own kind, just under it in its cell. Undefined for a card not there.
 */
export function linkedAdd(board: Board, id: string): AddPlace | undefined {
  const format = findFormat(board.format);
  const el = findElement(board, id);
  if (!format || !el) return undefined;
  const leads = findType(format, el.type)?.leadsTo;
  if (leads) return { type: leads.type, from: id };
  // In a grid, below is another cell: the card stays in the cell of the one it comes from, just under it.
  if (!format.grid) return under(keyAdd(board, id, "down"), id);
  const cell = board.elements.filter((other) => other.lane === el.lane);
  const after = cell[cell.indexOf(el) + 1];
  return { type: el.type, lane: el.lane, ...(after ? { before: after.id } : {}), from: id };
}
