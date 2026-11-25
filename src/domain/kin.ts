/**
 * The kin of a card: where a kind is split into another (`leadsTo.splits`, as a
 * kanban's story into its tasks), a link from one to the other is a split. The story
 * then has tasks, and so many of them done; the task has its story. Where a
 * kind gathers (`gathers`, as a retro's observation), a link from one card of it
 * to another says they are one idea: the first counts the others, which name
 * it. Any other link is a link, and says nothing here.
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
  /** The cards linked say the same as this one, where they would be its parts: they are counted, not done. */
  gathered: boolean;
}

/** Whether a link from `src` to `dst` is a split: the kind of the first is split into the kind of the second. */
function splits(board: Board, src: Element | undefined, dst: Element | undefined): boolean {
  const format = findFormat(board.format);
  if (!format || !src || !dst) return false;
  const type = findType(format, src.type);
  if (type?.gathers === true && src.type === dst.type) return true;
  return type?.leadsTo?.splits === true && type.leadsTo.type === dst.type;
}

/** Whether the cards of this kind are gathered by a link, where another kind is split. */
function gathers(board: Board, el: Element | undefined): boolean {
  const format = findFormat(board.format);
  return format !== undefined && el !== undefined && findType(format, el.type)?.gathers === true;
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
    gathered: gathers(board, el),
  };
}

/** What the card wears beside its id: its story for a task, its tasks done among all for a story. */
export function kinMark(kin: Kin): string | undefined {
  if (kin.parent) return `↳ ${kin.parent}${kin.others > 0 ? ` +${kin.others}` : ""}`;
  if (kin.children.length === 0) return undefined;
  return kin.gathered ? `+${kin.children.length}` : `${kin.done}/${kin.children.length}`;
}

/** The same in words, for the tooltip and the Detail tab; undefined for a card without kin. */
export function kinSaid(board: Board, id: string, locale: Locale = DEFAULT_LOCALE): string | undefined {
  const kin = kinOf(board, id);
  const w = WORDS[locale];
  const parent = kin.parent ? findElement(board, kin.parent) : undefined;
  const named = parent ? `${parent.id} ${parent.label.replace(/\s+/g, " ").trim()}` : "";
  if (parent) return kin.gathered ? w.sameAs(named) : w.splits(named, kin.others);
  if (kin.children.length === 0) return undefined;
  return kin.gathered ? w.sameCount(kin.children.length) : w.splitDone(kin.done, kin.children.length);
}

/** Among cards chosen together, the one the others can be joined to: the first that takes them all. */
export function headOf(board: Board, ids: readonly string[]): string | undefined {
  const of = (id: string): Element | undefined => findElement(board, id);
  if (ids.length < 2) return undefined;
  return ids.find((head) => ids.every((other) => other === head || splits(board, of(head), of(other))));
}

/** The cards chosen that are not joined to their head yet, nor it to them: those a link from it would join. */
export function toJoin(board: Board, ids: readonly string[]): string[] {
  const head = headOf(board, ids);
  if (head === undefined) return [];
  const linked = (a: string, b: string): boolean => board.edges.some((e) => e.src === a && e.dst === b);
  return ids.filter((id) => id !== head && !linked(head, id) && !linked(id, head));
}
