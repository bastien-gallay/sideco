/**
 * From a board to its scene. The format picks the layout; this module is the only
 * place that knows there are several.
 */
import { type Format, findFormat, findType } from "../formats.ts";
import { DEFAULT_LOCALE, type Locale, WORDS } from "../i18n.ts";
import { type Board, type Element, threads } from "../workspace.ts";
import { layoutColumns, locateInColumns } from "./columns.ts";
import { layoutGraph, NODE_LINES } from "./graph.ts";
import {
  CARD_H,
  CARD_W,
  type Card,
  curve,
  type Scene,
  type Target,
  WRAP_CHARS,
  WRAP_LINES,
  wrap,
} from "./scene.ts";
import { layoutTimeline, locateInTimeline } from "./timeline.ts";

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

function cardMaker(board: Board, format: Format, locale: Locale): (e: Element, x: number, y: number) => Card {
  const openNotes = new Map<string, number>();
  for (const thread of threads(board)) {
    if (thread.target && !thread.resolved)
      openNotes.set(thread.target, (openNotes.get(thread.target) ?? 0) + 1);
  }
  const maxLines = format.layout === "graph" ? NODE_LINES : WRAP_LINES;
  return (e, x, y) => {
    const type = findType(format, e.type);
    return {
      id: e.id,
      x,
      y,
      w: CARD_W,
      h: CARD_H,
      lines: wrap(e.label, WRAP_CHARS, maxLines),
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

export type { Band, Card, Connector, Scene, Target } from "./scene.ts";
