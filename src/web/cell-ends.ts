/**
 * A card sent to the top or the foot of its cell in one gesture (S355): the
 * move it asks, and the words of the gesture. A cell is a lane of a kanban or
 * of a grid, a step and a kind of a timeline; a diagram has none.
 */
import type { Command } from "../domain/commands.ts";
import { findFormat } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import { type Board, findElement } from "../domain/workspace.ts";

/** The names of the two gestures, in the list under ⋯ of a card. */
export const TO_END: Record<Locale, { top: string; foot: string }> = {
  en: { top: "Send to top", foot: "Send to bottom" },
  fr: { top: "Envoyer en haut", foot: "Envoyer en bas" },
};

/** The keys of the two gestures, as a tooltip says them. */
export const KEYS: Record<Locale, { top: string; foot: string }> = {
  en: { top: "Shift + Home", foot: "Shift + End" },
  fr: { top: "Maj + Début", foot: "Maj + Fin" },
};

/** The move that sends the card to the top of its cell, or to its foot; undefined where it is there already. */
export function toEnd(board: Board, id: string, top: boolean): Command | undefined {
  const format = findFormat(board.format);
  const el = findElement(board, id);
  if (!format || !el || format.layout === "graph") return undefined;
  const timeline = format.layout === "timeline";
  const cell = board.elements.filter((other) =>
    timeline ? other.col === el.col && other.type === el.type : other.lane === el.lane,
  );
  const first = cell[0];
  if (!first || (top ? first : cell.at(-1)) === el) return undefined;
  const place = timeline ? { col: el.col } : { lane: el.lane };
  return { kind: "move", board: board.id, id, ...place, ...(top ? { before: first.id } : {}) };
}

/** The move to the top of the cell, then the one to its foot. */
export type Ends = readonly [Command | undefined, Command | undefined];

export const endsOf = (board: Board, id: string): Ends => [toEnd(board, id, true), toEnd(board, id, false)];
