/**
 * The rules of a reader's folds (S307), as plain rules: which lanes stay folded
 * once a card is at work in one, what a fold button does, and what press is a
 * carry rather than a click. No page here: lane-fold.ts keeps the folds in the
 * browser and answers the gestures.
 */
import { type Board, findElement } from "../domain/workspace.ts";

/** The lanes folded once `lane`'s button is pressed: folded if it was open, open if it was folded. */
export function toggled(lanes: readonly string[], lane: string): string[] {
  return lanes.includes(lane) ? lanes.filter((other) => other !== lane) : [...lanes, lane];
}

/**
 * The lanes that stay folded while the cards `atWork` are the reader's: the one
 * chosen, the one that holds the keyboard. The lane of each opens: what the
 * reader works on is in sight. The same list when nothing opens.
 */
export function stillFolded<T extends readonly string[]>(
  board: Board,
  lanes: T,
  atWork: readonly (string | null | undefined)[],
): T | string[] {
  const open = atWork.map((id) => (id ? findElement(board, id)?.lane : undefined));
  return lanes.some((lane) => open.includes(lane)) ? lanes.filter((lane) => !open.includes(lane)) : lanes;
}

/** How far a press travels, in units of the board, before the board takes it for a carry (its DRAG_THRESHOLD). */
const CARRY = 4;

/**
 * Whether a press that travelled `px` on screen is a carry on a board drawn at
 * `zoom`: the board counts in its own units, so the fold must count as it does,
 * or one press would be both a carry and a click, or neither.
 */
export function isCarry(px: number, zoom: number): boolean {
  return px / (zoom > 0 ? zoom : 1) > CARRY;
}
