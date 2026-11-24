/**
 * The links of a card, as its Detail tab lists them (S310): those it leads by,
 * then those it comes by, each with the card at its other end and the link's
 * name. The board offers a link to the pointer only; the panel, to the keyboard.
 */
import { type Board, findElement } from "../domain/workspace.ts";

export interface LinkRow {
  src: string;
  dst: string;
  /** The card leads by it, rather than comes by it. */
  out: boolean;
  /** The card at its other end: its id and its words. */
  other: string;
  label: string | undefined;
}

export function linkRows(board: Board, id: string): LinkRow[] {
  const row = (src: string, dst: string, label: string | undefined, out: boolean): LinkRow => {
    const end = out ? dst : src;
    const el = findElement(board, end);
    const other = el ? `${end} ${el.label.replace(/\s+/g, " ").trim()}` : end;
    return { src, dst, out, other, label };
  };
  return [
    ...board.edges.filter((e) => e.src === id).map((e) => row(e.src, e.dst, e.label, true)),
    ...board.edges.filter((e) => e.dst === id).map((e) => row(e.src, e.dst, e.label, false)),
  ];
}
