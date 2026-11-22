/**
 * A card given a new id (`sideco renumber`) stays the card the reader holds:
 * chosen, linked from, focused or written on, it goes on under its new id.
 */

/** What the journal says of a card renumbered: on which board, from which id, to which. */
export interface Renumbering {
  board: string;
  id: string;
  to: string;
}

/** The id a card held on the board shown goes by once the journal renumbers one: the new one if it is that card. */
export function heldAfter(held: string | null, shown: string | null, r: Renumbering): string | null {
  return held === r.id && shown === r.board ? r.to : held;
}
