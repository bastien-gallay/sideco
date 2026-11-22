/**
 * The address of a board in the page, and of a card on it: `#/b/BOARD` and
 * `#/b/BOARD/ID`. An element id is unique only within its board, so a card's
 * link always carries the board. The page reads it, and the CLI prints it.
 */
import { type BoardId, type ElementId, isBoardId, isElementId } from "./ids.ts";

export interface Linked {
  board: BoardId;
  card?: ElementId;
}

/** Every board at a glance: the home page (T90). */
export const HOME_LINK = "#/boards";

export const boardLink = (board: BoardId): string => `#/b/${board}`;

export const cardLink = (board: BoardId, card: ElementId): string => `${boardLink(board)}/${card}`;

/** The board and the card an address names; nothing when it is not one of ours. */
export function readLink(hash: string): Linked | undefined {
  const [head, kind, board, card, ...rest] = hash.split("/");
  if (head !== "#" || kind !== "b" || board === undefined || !isBoardId(board) || rest.length > 0)
    return undefined;
  if (card === undefined) return { board };
  return isElementId(card) ? { board, card } : undefined;
}
