/**
 * Where a board or a card is in the page, as a whole address: the companion's
 * origin, then the link the page reads (`src/domain/links.ts`). Given only for
 * what exists, so a link printed is never a dead one.
 */
import { asBoardId, asElementId } from "../domain/ids.ts";
import { boardLink, cardLink } from "../domain/links.ts";
import { type Board, findElement } from "../domain/workspace.ts";
import { UsageError } from "./argv.ts";

/** The board's address, or one of its cards' when `card` names one. */
export function addressOf(origin: string, board: Board, card?: string): string {
  const id = asBoardId(board.id);
  if (!id) throw new Error(`board ${board.id} has no board id`);
  if (card === undefined) return `${origin}/${boardLink(id)}`;
  const element = asElementId(card);
  if (!element || !findElement(board, element)) throw new UsageError(`no ${card} on ${board.id}`);
  return `${origin}/${cardLink(id, element)}`;
}
