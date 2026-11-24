/**
 * From a board to its scene. The format picks the layout; this module is the only
 * place that knows there are several.
 */
import { type ElementType, type Format, findFormat, findType, wearsDone } from "../formats.ts";
import { DEFAULT_LOCALE, formerly, type Locale, WORDS } from "../i18n.ts";
import { threads } from "../threads.ts";
import type { Board, Element } from "../workspace.ts";
import {
  dropLane,
  headingSlide,
  laneHeading,
  layoutColumns,
  locateInColumns,
  roomInColumns,
  roomOnLaneEdge,
} from "./columns.ts";
import { placeConnectorLabels } from "./connector-labels.ts";
import { layoutGraph, NODE_LINES } from "./graph.ts";
import { layoutByHand } from "./hand.ts";
import {
  BLURB_LINES,
  blurbHeight,
  CARD_W,
  type Card,
  cardHeight,
  charsFor,
  curve,
  KIND_H,
  labelsHeight,
  PERSON_HEAD,
  plainDetail,
  type Room,
  type Scene,
  type Target,
  WRAP_LINES,
  wrap,
} from "./scene.ts";
import {
  dropStep,
  layoutTimeline,
  locateInTimeline,
  roomInTimeline,
  roomOnBoundary,
  stepHeading,
  stepTop,
} from "./timeline.ts";

const EMPTY: Scene = { width: 0, height: 0, bands: [], cards: [], connectors: [] };

/**
 * The board as geometry and text. `locale` is the reader's language: it names
 * lanes, rows and tooltips. `span` is the width the board has on screen, when
 * it has one: lanes that can share it out do; without it, as on paper, every
 * lane keeps its own width.
 */
export function layoutBoard(board: Board, locale: Locale = DEFAULT_LOCALE, span?: number): Scene {
  const format = findFormat(board.format);
  if (!format) return EMPTY;
  const card = cardMaker(board, format, locale);
  if (format.layout === "graph" && board.byHand) return placeConnectorLabels(layoutByHand(board, card));
  if (format.layout === "graph")
    return placeConnectorLabels(layoutGraph(board, card, span, format.relations === true));

  const scene =
    format.layout === "timeline"
      ? layoutTimeline(board, format, card, locale)
      : layoutColumns(board, format, card, locale, span);
  const byId = new Map(scene.cards.map((c) => [c.id, c]));
  for (const edge of board.edges) {
    const a = byId.get(edge.src);
    const b = byId.get(edge.dst);
    if (a && b) scene.connectors.push(curve(a, b, edge.label));
  }
  return placeConnectorLabels(scene);
}

/** What a point of the scene means on this board: a cell, a slot in a lane, or nothing. */
export function locate(board: Board, x: number, y: number, moving?: string, span?: number): Target {
  const format = findFormat(board.format);
  if (format?.layout === "timeline") return locateInTimeline(board, format, x, y, moving);
  if (format?.layout === "columns") return locateInColumns(board, format, x, y, moving, span);
  return { kind: "none" };
}

/**
 * The free room where an element added at `target` would go, so that the page
 * can offer it there; for an edge between two steps, where a column is offered.
 * Undefined where nothing is added by place: off the board, and on a flow,
 * whose elements are placed by their links.
 */
export function vacancy(board: Board, target: Target, span?: number): Room | undefined {
  const format = findFormat(board.format);
  if (format?.layout === "timeline" && target.kind === "cell")
    return roomInTimeline(board, format, target.col, target.type);
  if (format?.layout === "timeline" && target.kind === "boundary") return roomOnBoundary(target.col);
  if (format?.layout === "timeline" && target.kind === "step-head") return stepHeading(target.col);
  if (format?.layout === "columns" && target.kind === "slot")
    return roomInColumns(board, format, target.lane, span);
  if (format?.layout === "columns" && target.kind === "lane-edge")
    return roomOnLaneEdge(board, format, target.before, span);
  return undefined;
}

/** The number a step of a timeline dragged by its heading would take; undefined where it is, or off a timeline. */
export function stepDrop(board: Board, x: number, from: number): number | undefined {
  return findFormat(board.format)?.layout === "timeline" ? dropStep(board, x, from) : undefined;
}

/** Where a lane of a kanban dragged by its heading would land; undefined where it is, or off a kanban. */
export function laneDrop(
  board: Board,
  x: number,
  moving: string,
  span?: number,
): { before?: string; x: number } | undefined {
  const format = findFormat(board.format);
  return format?.ownLanes && !format.grid ? dropLane(board, format, x, moving, span) : undefined;
}

/** The top of a step of a timeline: where what is done to the whole step is offered. */
export function stepOf(board: Board, col: number): Room | undefined {
  return findFormat(board.format)?.layout === "timeline" ? stepTop(col) : undefined;
}

/** The heading of a lane of a columns board: where what is done to the whole lane is offered. */
export function headingOf(board: Board, lane: string, span?: number): Room | undefined {
  const format = findFormat(board.format);
  return format?.layout === "columns" ? laneHeading(board, format, lane, span) : undefined;
}

function cardMaker(
  board: Board,
  format: Format,
  locale: Locale,
): (e: Element, x: number, y: number, w?: number) => Card {
  const openNotes = new Map<string, number>();
  for (const thread of threads(board)) {
    if (thread.target && !thread.resolved)
      openNotes.set(thread.target, (openNotes.get(thread.target) ?? 0) + 1);
  }
  const maxLines = format.layout === "graph" ? NODE_LINES : WRAP_LINES;
  return (e, x, y, w = format.look?.width ?? CARD_W) => {
    const type = findType(format, e.type);
    const lines = wrap(e.label, charsFor(w), maxLines);
    const blurb = blurbOf(format, e, w);
    const look = lookOf(format, type, locale);
    const head = type?.shape === "person" ? PERSON_HEAD : 0;
    return {
      id: e.id,
      x,
      y,
      w,
      h:
        cardHeight(lines.length) +
        head +
        (look.kind ? KIND_H : 0) +
        blurbHeight(blurb?.length ?? 0) +
        labelsHeight(e.labels),
      lines,
      ...(blurb ? { blurb } : {}),
      ...look,
      ...(e.labels && e.labels.length > 0 ? { labels: [...e.labels] } : {}),
      fill: type?.fill ?? "#E8EEF4",
      ink: type?.ink ?? "#1F2328",
      shape: type?.shape ?? "box",
      label: oneLineOf(e.label),
      tip: `${[e.id, formerly(e.formerIds, locale)].filter(Boolean).join(" · ")} · ${type?.label[locale] ?? e.type} · ${WORDS[locale].addedBy[e.by]}${wearsDone(board, e) ? ` · ${WORDS[locale].done}` : ""}`,
      by: e.by,
      hasDetail: Boolean(e.detail),
      ...(e.detail ? { detail: e.detail } : {}),
      done: wearsDone(board, e),
      notes: openNotes.get(e.id) ?? 0,
    };
  };
}

/** The description a card shows under its name, on a format that shows one, cut to the lines it allows. */
function blurbOf(format: Format, e: Element, w: number): string[] | undefined {
  const said = format.describes && e.detail ? plainDetail(e.detail) : "";
  if (!said) return undefined;
  return wrap(said, Math.floor((charsFor(w) * 13) / 11), format.look?.blurbLines ?? BLURB_LINES);
}

/** What a card drawn in outline wears beyond a sticky: the tones of its kind, and its kind in words. */
function lookOf(format: Format, type: ElementType | undefined, locale: Locale): Pick<Card, "tone" | "kind"> {
  if (!format.look || !type) return {};
  return { tone: { light: type.fill, dark: type.dark ?? type.fill }, kind: `[${type.label[locale]}]` };
}

/** A label on one line: the name a card is heard by. */
const oneLineOf = (label: string): string => label.replace(/\s+/g, " ").trim();

export type { Band, Card, Connector, Room, Scene, Target } from "./scene.ts";
export { headingSlide };
