/**
 * What the page and the board drawn in it say to each other: the hooks the board
 * calls, and what the page may ask of the board. Moved out of board-view.ts (T172).
 */
import type { Board } from "../domain/workspace.ts";

export interface BoardHooks {
  /** A card or a lane left the board by a gesture: the page says so, and offers to take it back. */
  removed(said: string): void;
  /** Something a screen reader should hear, that the eye sees on the board: a card moved by a key. */
  announce(text: string): void;
  /** Something every reader is told, in the page's notice: why a key did nothing. */
  notice(text: string): void;
  /** The card's detail is to be written: the page opens it in its panel. */
  editDetail(id: string): void;
  /** The card's detail is to be read: the page shows it in its panel, unfolded if need be. */
  showDetail(id: string): void;
  /** The card's discussions are to be read: the page opens its Notes tab on them. */
  showNotes(id: string): void;
}

export interface BoardView {
  /** `unread` lists the cards that carry a change Claude has not read; `changed`, those Claude changed while the reader was away. */
  paint(board: Board | undefined, unread: readonly string[], changed?: readonly string[]): void;
  /** Opens the label editor for a new element of this type. */
  beginAdd(typeId: string, place?: { col?: number; lane?: string; x: number; y: number }): void;
  zoomBy(step: -1 | 1): number;
  /** The whole board in the window; pressed again, back to 100 %. */
  fit(): number;
  /** Marks one card as the one being talked about, without selecting it; no id clears the mark. */
  point(id: string | undefined): void;
  /** Scrolls the board so that the card is in view. */
  reveal(id: string): void;
  /** Gives the card the keyboard: it is where Tab enters the board from now on; `centred` brings it to the middle. */
  focus(id: string, centred?: boolean): void;
  /** Lets the card chosen go, as a click on the board beside it does; a drop that ended there is no such click. */
  letGo(): void;
  /** A card was given a new id: the keyboard, and the words being written on it, go on with it. */
  renamed(from: string, to: string): void;
}
