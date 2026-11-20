/**
 * A scene is geometry and nothing else: where each card, band and connector goes.
 * Layouts produce it from a board; painters (SVG export, the live page) consume it
 * and know nothing about formats.
 */
import type { Actor } from "../events.ts";
import type { Shape } from "../formats.ts";

export interface Card {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  fill: string;
  ink: string;
  shape: Shape;
  /** The whole label, on one line: what `lines` shows of it, uncut. */
  label: string;
  /** The tooltip: id, type and who added it, in the reader's language. */
  tip: string;
  by: Actor;
  hasDetail: boolean;
  /** The detail as written: the tooltip carries it, for a reader who does not open the editor. */
  detail?: string;
  /** The labels it wears, as kept: drawn as chips at its foot. */
  labels?: string[];
  /** The start of the detail, under the name, on a board whose workshop shows it (see `Format.describes`). */
  blurb?: string[];
  /** What the card stands for is done. */
  done: boolean;
  /** Open notes pinned to this card. */
  notes: number;
}

/** A labelled region behind the cards: a type row, a step column, a lane, or the name of an axis beside a plan. */
export interface Band {
  kind: "row" | "step" | "lane" | "axis" | "slice";
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The colour of the stickies this band holds, when it holds one kind. */
  swatch?: string;
  count?: number;
  /** What a lane stands for, when its name alone does not say it. */
  hint?: string;
  /** A step of a story map: the activity and the task it belongs to, one line each. */
  caption?: string[];
  /** An axis: the words for where it starts and where it ends. */
  low?: string;
  high?: string;
}

export interface Connector {
  src: string;
  dst: string;
  /** SVG path data. */
  d: string;
  label?: string;
  labelX: number;
  labelY: number;
  /** Its name found no spot free of cards and other names: it is read on hover, not written. */
  unwritten?: true;
}

export interface Scene {
  width: number;
  height: number;
  bands: Band[];
  cards: Card[];
  connectors: Connector[];
  /** On a story map, where its first backbone row ends: scrolled past it, the steps show their captions. */
  backbone?: number;
}

/** Where a pointer position lands, in the board's own terms. */
/** A free rectangle of the board, in scene coordinates. */
export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Target =
  /** `before`: the card of the cell a drop would land before; none at the foot of its stack. */
  | { kind: "cell"; col: number; type: string; before?: string }
  | { kind: "slot"; lane: string; before?: string }
  /** The edge between two steps of a timeline: a column inserted there takes the number `col`. */
  | { kind: "boundary"; col: number }
  /** The middle of a step's heading: what is done to the whole column. */
  | { kind: "step-head"; col: number }
  /** The edge between two lane headings of a kanban: a lane added there goes before `before`, else last. */
  | { kind: "lane-edge"; before?: string }
  | { kind: "none" };

export const CARD_W = 152;
/** The tallest card: a label of `WRAP_LINES` lines. */
export const CARD_H = 88;
/** The shortest card: one line, with room for the id above it and the marks around it. */
export const CARD_MIN_H = 48;
export const MARGIN = 24;

/** Characters per line and lines per card that fit `CARD_W` × `CARD_H` at 13px. */
export const WRAP_CHARS = 20;
export const WRAP_LINES = 4;
/** The height of one line of label. */
export const LINE_H = 16;
/** What a card needs besides its label: the id strip above, the breathing room below. */
const CARD_CHROME = CARD_H - WRAP_LINES * LINE_H;

/** Lines of description a card shows at most, and the height of one, at 11px. */
export const BLURB_LINES = 3;
export const BLURB_H = 13;
/** Between the name and the description. */
const BLURB_GAP = 4;

/** What a description of this many lines adds to a card. */
export function blurbHeight(lines: number): number {
  return lines > 0 ? BLURB_GAP + lines * BLURB_H : 0;
}

/** A detail as plain words on one line: its first paragraph, without the marks of its markdown. */
export function plainDetail(detail: string): string {
  const first = detail.split(/\n\s*\n/)[0] ?? "";
  return first
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+]|\d{1,9}[.)]|#{1,6})\s+/, ""))
    .join(" ")
    .replace(/\[([^\]\n]+)\]\([^()\s]+\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|\s)[*_]([^*_\s][^*_]*?)[*_](?=\s|[.,;:!?)]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The row of chips at the foot of a card that wears labels. */
export const LABELS_H = 20;

/** What a card's labels add to it: one row of chips, or nothing. */
export function labelsHeight(labels: readonly string[] | undefined): number {
  return labels && labels.length > 0 ? LABELS_H : 0;
}

/** The height of the card an element is drawn as, in a layout of stacked stickies: its label, then its labels. */
export function elementHeight(e: { label: string; labels?: readonly string[] }, chars = WRAP_CHARS): number {
  return labelHeight(e.label, chars) + labelsHeight(e.labels);
}

/** A card is as tall as its label: the height of one that shows this many lines. */
export function cardHeight(lines: number): number {
  return Math.max(CARD_MIN_H, CARD_CHROME + lines * LINE_H);
}

/** The height of the card that shows this label, in a layout of stacked stickies, `chars` to a line. */
export function labelHeight(label: string, chars = WRAP_CHARS): number {
  return cardHeight(wrap(label, chars).length);
}

/** How many characters a line of a card this wide holds: as many as `CARD_W` holds, in proportion. */
export function charsFor(width: number): number {
  return Math.floor((width * WRAP_CHARS) / CARD_W);
}

/** Breaks a label into at most `maxLines` lines of at most `width` characters, ending with … when cut. */
export function wrap(label: string, width = WRAP_CHARS, maxLines = WRAP_LINES): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of label.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      const cut = breakAt(rest, width);
      lines.push(cut.line);
      rest = cut.rest;
    }
    if (current && current.length + 1 + rest.length > width) {
      lines.push(current);
      current = rest;
    } else {
      current = current ? `${current} ${rest}` : rest;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines.length > 0 ? lines : [""];
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] = `${last.slice(0, width - 1).trimEnd()}…`;
  return kept;
}

/**
 * Where a word too long for a line is cut: after its last slash or hyphen that
 * fits, as a reader would; otherwise one character short, with a hyphen that
 * says the word goes on.
 */
function breakAt(word: string, width: number): { line: string; rest: string } {
  const head = word.slice(0, width);
  const own = Math.max(head.lastIndexOf("/"), head.lastIndexOf("-"));
  if (own > 0) return { line: word.slice(0, own + 1), rest: word.slice(own + 1) };
  return { line: `${word.slice(0, width - 1)}-`, rest: word.slice(width - 1) };
}

/** The name a card is heard by: its words first, then what the tooltip says of it. */
export function cardName(card: Pick<Card, "label" | "tip">): string {
  return `${card.label} · ${card.tip}`;
}

/** A smooth connector between two cards, leaving and entering on the sides that face each other. */
export function curve(a: Card, b: Card, label?: string): Connector {
  const gap = 4;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const sideways = Math.abs(bx - ax) >= Math.abs(by - ay);
  let d: string;
  let sx: number;
  let sy: number;
  let tx: number;
  let ty: number;
  if (sideways) {
    const dir = bx >= ax ? 1 : -1;
    sx = ax + (dir * a.w) / 2;
    tx = bx - dir * (b.w / 2 + gap);
    sy = ay;
    ty = by;
    const pull = dir * Math.max(20, Math.abs(tx - sx) / 2);
    d = `M${r(sx)} ${r(sy)} C${r(sx + pull)} ${r(sy)} ${r(tx - pull)} ${r(ty)} ${r(tx)} ${r(ty)}`;
  } else {
    const dir = by >= ay ? 1 : -1;
    sy = ay + (dir * a.h) / 2;
    ty = by - dir * (b.h / 2 + gap);
    sx = ax;
    tx = bx;
    const pull = dir * Math.max(16, Math.abs(ty - sy) / 2);
    d = `M${r(sx)} ${r(sy)} C${r(sx)} ${r(sy + pull)} ${r(tx)} ${r(ty - pull)} ${r(tx)} ${r(ty)}`;
  }
  return { src: a.id, dst: b.id, d, label, labelX: r((sx + tx) / 2), labelY: r((sy + ty) / 2 - 6) };
}

export function r(n: number): number {
  return Math.round(n * 10) / 10;
}
