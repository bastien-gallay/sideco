/**
 * The card chosen lives in the address, `#/b/BOARD/ID` (out of main.ts, T171):
 * a reload, a restart of the companion or a link pasted elsewhere comes back on
 * it, centred and lit up, the keyboard on it. This module chooses the card the
 * address names once the journal is replayed, then keeps the address on the
 * choice; main.ts paints, and asks which card is arriving.
 */
import { caughtUpYet, currentBoard, linkedCard, markFresh, showChosen, state } from "./store.ts";

let toRestore = linkedCard();
window.addEventListener("hashchange", () => {
  toRestore = linkedCard();
});

/** A card reached by its address, or found on another board: the keyboard lands on it once its board is painted. */
let arriving: { board: string; id: string } | undefined;

/** Once the journal is replayed (again, after a restart): the card linked is chosen, then the address follows the choice. */
export function keepChosen(board: string | undefined): void {
  if (!caughtUpYet()) {
    toRestore ??= linkedCard();
    return;
  }
  if (!board) return;
  const kept = toRestore;
  toRestore = undefined;
  if (kept?.board === board && currentBoard()?.elements.some((e) => e.id === kept.id)) {
    state.selected = kept.id;
    arriving = kept;
    markFresh(`${board}/${kept.id}`);
  }
  showChosen(board, state.selected);
}

/** The card arriving on `board`, once: the page gives it the keyboard when the board is painted. */
export function arrived(board: string | undefined): string | undefined {
  if (!arriving || arriving.board !== board) return undefined;
  const { id } = arriving;
  arriving = undefined;
  return id;
}
