/**
 * From a board to its scene. The format picks the layout; this module is the only
 * place that knows there are several.
 */
import { type Format, findFormat, findType } from "../formats.ts";
import { DEFAULT_LOCALE, type Locale, WORDS } from "../i18n.ts";
import { type Board, type Element, threads } from "../workspace.ts";
import { layoutColumns, locateInColumns, roomInColumns } from "./columns.ts";
import { layoutGraph, NODE_LINES } from "./graph.ts";
import {
  CARD_W,
  type Card,
  cardHeight,
  curve,
  type Room,
  type Scene,
  type Target,
  WRAP_CHARS,
  WRAP_LINES,
  wrap,
} from "./scene.ts";
import { layoutTimeline, locateInTimeline, roomInTimeline, roomOnBoundary } from "./timeline.ts";

const EMPTY: Scene = { width: 0, height: 0, bands: [], cards: [], connectors: [] };

/** The board as geometry and text. `locale` is the reader's language: it names lanes, rows and tooltips. */
export function layoutBoard(board: Board, locale: Locale = DEFAULT_LOCALE): Scene {
  const format = findFormat(board.format);
  if (!format) return EMPTY;
  const card = cardMaker(board, format, locale);
  if (format.layout === "graph") return layoutGraph(board, card);

  const scene =
    format.layout === "timeline"
      ? layoutTimeline(board, format, card, locale)
      : layoutColumns(board, format, card, locale);
  const byId = new Map(scene.cards.map((c) => [c.id, c]));
  for (const edge of board.edges) {
    const a = byId.get(edge.src);
    const b = byId.get(edge.dst);
    if (a && b) scene.connectors.push(curve(a, b, edge.label));
  }
  return scene;
}

/** What a point of the scene means on this board: a cell, a slot in a lane, or nothing. */
export function locate(board: Board, x: number, y: number, moving?: string): Target {
  const format = findFormat(board.format);
  if (format?.layout === "timeline") return locateInTimeline(board, format, x, y);
  if (format?.layout === "columns") return locateInColumns(board, format, x, y, moving);
  return { kind: "none" };
}

/**
 * The free room where an element added at `target` would go, so that the page
 * can offer it there; for an edge between two steps, where a column is offered.
 * Undefined where nothing is added by place: off the board, and on a flow,
 * whose elements are placed by their links.
 */
export function vacancy(board: Board, target: Target): Room | undefined {
  const format = findFormat(board.format);
  if (format?.layout === "timeline" && target.kind === "cell")
    return roomInTimeline(board, format, target.col, target.type);
  if (format?.layout === "timeline" && target.kind === "boundary") return roomOnBoundary(target.col);
  if (format?.layout === "columns" && target.kind === "slot")
    return roomInColumns(board, format, target.lane);
  return undefined;
}

function cardMaker(board: Board, format: Format, locale: Locale): (e: Element, x: number, y: number) => Card {
  const openNotes = new Map<string, number>();
  for (const thread of threads(board)) {
    if (thread.target && !thread.resolved)
      openNotes.set(thread.target, (openNotes.get(thread.target) ?? 0) + 1);
  }
  const maxLines = format.layout === "graph" ? NODE_LINES : WRAP_LINES;
  return (e, x, y) => {
    const type = findType(format, e.type);
    const lines = wrap(e.label, WRAP_CHARS, maxLines);
    return {
      id: e.id,
      x,
      y,
      w: CARD_W,
      h: cardHeight(lines.length),
      lines,
      fill: type?.fill ?? "#E8EEF4",
      ink: type?.ink ?? "#1F2328",
      shape: type?.shape ?? "box",
      tip: `${e.id} · ${type?.label[locale] ?? e.type} · ${WORDS[locale].addedBy[e.by]}`,
      by: e.by,
      hasDetail: Boolean(e.detail),
      notes: openNotes.get(e.id) ?? 0,
    };
  };
}

export type { Band, Card, Connector, Room, Scene, Target } from "./scene.ts";
