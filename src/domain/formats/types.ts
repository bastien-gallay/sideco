/**
 * What a workshop format is made of, and the small helpers every workshop writes
 * itself with. The workshops live beside this file, one each; `../formats.ts` lists them.
 */
import type { Text } from "../i18n.ts";

/** How semantic positions become geometry. */
export type LayoutKind =
  /** Rows are element types, columns are steps in time (`col`). */
  | "timeline"
  /** Columns are named lanes; elements stack in each. */
  | "columns"
  /** Positions follow the edges: a layered, top-down graph. */
  | "graph";

/** `sticky` is a paper note, `sharp` a square-cornered alarm, `box` a process step. */
/** `person` is C4's: a rounded box with a head and shoulders above the name. */
export type Shape = "sticky" | "sharp" | "box" | "pill" | "diamond" | "person";

export interface ElementType {
  id: string;
  label: Text;
  /** Ids are minted as `<prefix><n>`: E1, C2. One letter per concept in the whole project (formats.test.ts), never `N`. */
  prefix: string;
  fill: string;
  ink: string;
  shape: Shape;
  /** One line for the palette tooltip and the agent's guidance. */
  hint: Text;
  /** Only for `columns` layouts: the lane a card of this kind goes to when none is said, if the board has it. */
  home?: string;
  /** The kind a card of this one leads to: the page offers, by `label`, to make one from it, linked. */
  leadsTo?: { type: string; label: Text };
  /**
   * The letters the kind minted before, oldest first: a card made then keeps its id
   * until `sideco renumber --all`, and one may still be chosen while no kind of the
   * format holds it now.
   */
  formerPrefixes?: string[];
  /** On a format drawn in outline: this kind's colour on a dark page, as legible there as `fill` is on white. */
  dark?: string;
}

/** How a graph's cards are drawn when they are not stickies: as c4model draws them now. */
export interface Look {
  /** An outline in the kind's colour on the page, the words in that colour too, the name in bold. */
  outline: true;
  /** The kind written under the name, in brackets: C4 asks every element to say what it is. */
  kinds: true;
  /** Wide enough, and lines enough, for the whole of a description. */
  width: number;
  blurbLines: number;
}

export interface Lane {
  id: string;
  label: Text;
  /** What the lane stands for, under its name, when the name alone does not say it. */
  hint?: Text;
}

/**
 * Lanes laid as the cells of a plan, row after row: `perRow` lanes side by
 * side, `abreast` cards side by side in a cell, and a name for each axis.
 */
export interface Grid {
  perRow: number;
  abreast: number;
  /** What grows from left to right. */
  x: Text;
  /** What grows from bottom to top. */
  y: Text;
  /** The words for the two ends of an axis: where it starts, where it ends. */
  low: Text;
  high: Text;
}

export interface Format {
  id: string;
  name: Text;
  /** The question this workshop answers, shown when choosing a format. */
  purpose: Text;
  layout: LayoutKind;
  types: readonly ElementType[];
  /** Only for `columns` layouts. */
  lanes: readonly Lane[];
  /** Only for `columns` layouts: the lanes are the cells of a plan. */
  grid?: Grid;
  /** Only for `columns` layouts: each board adds, moves and removes its own lanes, starting from these. */
  ownLanes?: true;
  /** With `ownLanes`: a card in the last lane is done, and wears no other mark. */
  doneLast?: true;
  /**
   * Only for `timeline` layouts: the kinds, first rows of the board, that say
   * where a step belongs. The first runs on into the steps after it; the page
   * keeps them in sight under the step numbers once they have scrolled away.
   */
  backbone?: readonly string[];
  /**
   * Only for `timeline` layouts: the kind of the last row, under which the board
   * draws its slices, the lines that say what ships first.
   */
  sliced?: string;
  /** Only for `graph` layouts: a card shows the start of its detail under its name, as C4 shows a description. */
  describes?: true;
  /**
   * Only for `graph` layouts: a link is a relation, not a step. One that goes back
   * along another is its answer, drawn beside it, not a loop round the board.
   */
  relations?: true;
  /** Only for `graph` layouts: cards drawn other than as stickies. */
  look?: Look;
}

export const t = (en: string, fr: string): Text => ({ en, fr });

export const DARK = "#1F2328";
export const LIGHT = "#FFFFFF";
