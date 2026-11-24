/**
 * The kin of a card: where a kind is split into another (`leadsTo.splits`, as a
 * kanban's story into its tasks), a link from one to the other is a split. The story
 * then has tasks, and so many of them done; the task has its story. Any other
 * link is a link, and says nothing here.
 */
import { findFormat, findType, isDone } from "./formats.ts";
import { DEFAULT_LOCALE, type Locale, WORDS } from "./i18n.ts";
import { type Board, type Element, findElement } from "./workspace.ts";

export interface Kin {
  /** The card it splits, by its id: the first linked, when it splits several. */
  parent: string | undefined;
  /** How many other cards it splits. */
  others: number;
  /** The cards that split it, in the order they were linked, and how many are done. */
  children: string[];
  done: number;
}

/** Whether a link from `src` to `dst` is a split: the kind of the first is split into the kind of the second. */
function splits(board: Board, src: Element | undefined, dst: Element | undefined): boolean {
  const format = findFormat(board.format);
  if (!format || !src || !dst) return false;
  const leadsTo = findType(format, src.type)?.leadsTo;
  return leadsTo?.splits === true && leadsTo.type === dst.type;
}

export function kinOf(board: Board, id: string): Kin {
  const el = findElement(board, id);
  const ends = (edges: typeof board.edges, pick: (e: (typeof board.edges)[number]) => string): Element[] =>
    edges.map((e) => findElement(board, pick(e))).filter((other): other is Element => other !== undefined);
  const from = ends(
    board.edges.filter((e) => e.dst === id),
    (e) => e.src,
  ).filter((other) => splits(board, other, el));
  const to = ends(
    board.edges.filter((e) => e.src === id),
    (e) => e.dst,
  ).filter((other) => splits(board, el, other));
  return {
    parent: from[0]?.id,
    others: Math.max(0, from.length - 1),
    children: to.map((child) => child.id),
    done: to.filter((child) => isDone(board, child)).length,
  };
}

/** What the card wears beside its id: its story for a task, its tasks done among all for a story. */
export function kinMark(kin: Kin): string | undefined {
  if (kin.parent) return `↳ ${kin.parent}${kin.others > 0 ? ` +${kin.others}` : ""}`;
  return kin.children.length > 0 ? `${kin.done}/${kin.children.length}` : undefined;
}

/** The same in words, for the tooltip and the Detail tab; undefined for a card without kin. */
export function kinSaid(board: Board, id: string, locale: Locale = DEFAULT_LOCALE): string | undefined {
  const kin = kinOf(board, id);
  const w = WORDS[locale];
  const parent = kin.parent ? findElement(board, kin.parent) : undefined;
  if (parent) return w.splits(`${parent.id} ${parent.label.replace(/\s+/g, " ").trim()}`, kin.others);
  return kin.children.length > 0 ? w.splitDone(kin.done, kin.children.length) : undefined;
}
