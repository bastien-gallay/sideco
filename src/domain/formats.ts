/**
 * Workshop formats. A format is data: the kinds of sticky a board accepts, how the
 * board is laid out, and what to tell the agent about it. Adding a workshop means
 * adding a file under formats/ and an entry here, not writing a renderer.
 */
import { C4_CONTEXT } from "./formats/c4-context.ts";
import { EVENT_STORMING } from "./formats/event-storming.ts";
import { FLOW } from "./formats/flow.ts";
import { IMPACT_EFFORT } from "./formats/impact-effort.ts";
import { KANBAN } from "./formats/kanban.ts";
import { RETRO } from "./formats/retro.ts";
import { STORY_MAP } from "./formats/story-map.ts";
import type { ElementType, Format } from "./formats/types.ts";
import type { Locale } from "./i18n.ts";

export type { ElementType, Format, Grid, Lane, LayoutKind, Shape } from "./formats/types.ts";

export const FORMATS: readonly Format[] = [
  EVENT_STORMING,
  FLOW,
  KANBAN,
  STORY_MAP,
  RETRO,
  IMPACT_EFFORT,
  C4_CONTEXT,
];

/** The prefix reserved for notes, on every board. */
export const NOTE_PREFIX = "N";

export function findFormat(id: string): Format | undefined {
  return FORMATS.find((f) => f.id === id);
}

/** A lane's name on a board: the one the board gave it, else its workshop's in the reader's language. */
export function laneName(
  format: Format | undefined,
  board: { lanes: Record<string, string> },
  lane: string,
  locale: Locale,
): string {
  return board.lanes[lane] ?? format?.lanes.find((l) => l.id === lane)?.label[locale] ?? lane;
}

/** The key of `minted` that counts the lanes a board added: they are lane-1, lane-2… */
export const LANE_PREFIX = "lane-";
/** The ids a board gives its slices: `slice-1`, `slice-2`… */
export const SLICE_PREFIX = "slice-";

/** The lanes of a board, in order: its own when it changed them, else its workshop's. */
export function lanesOf(board: { format: string; laneOrder?: readonly string[] }): string[] {
  return board.laneOrder ? [...board.laneOrder] : (findFormat(board.format)?.lanes.map((l) => l.id) ?? []);
}

/** The question a board answers: its own, else its workshop's. */
export function boardPurpose(
  format: Format | undefined,
  board: { purpose?: string },
  locale: Locale,
): string {
  return board.purpose ?? format?.purpose[locale] ?? "";
}

/** What a lane stands for: the board's words, else its workshop's, else nothing. */
export function laneHint(
  format: Format | undefined,
  board: { hints?: Record<string, string> },
  lane: string,
  locale: Locale,
): string | undefined {
  return board.hints?.[lane] ?? format?.lanes.find((l) => l.id === lane)?.hint?.[locale];
}

/** An axis of a plan as the board reads: its name and its two ends, each the board's or its workshop's. */
export function planAxis(
  format: Format,
  board: { axes?: Partial<Record<"x" | "y", { label: string; low?: string; high?: string }>> },
  axis: "x" | "y",
  locale: Locale,
): { label: string; low: string; high: string } | undefined {
  const grid = format.grid;
  if (!grid) return undefined;
  const own = board.axes?.[axis];
  return {
    label: own?.label ?? grid[axis][locale],
    low: own?.low ?? grid.low[locale],
    high: own?.high ?? grid.high[locale],
  };
}

/** Whether what a card stands for is done: on a kanban, it sits in the last lane; elsewhere, it was marked so. */
export function isDone(
  board: { format: string; laneOrder?: readonly string[] },
  el: { lane: string; done?: boolean },
): boolean {
  if (findFormat(board.format)?.doneLast) return el.lane === lanesOf(board).at(-1);
  return el.done === true;
}

/** Whether a card wears the tick and the strike: where done is a mark, not a lane. */
export function wearsDone(board: { format: string }, el: { done?: boolean }): boolean {
  return !findFormat(board.format)?.doneLast && el.done === true;
}

export function findType(format: Format, typeId: string): ElementType | undefined {
  return format.types.find((t) => t.id === typeId);
}

export function typeOfId(format: Format, elementId: string): ElementType | undefined {
  return format.types.find((t) => t.prefix === elementId.charAt(0));
}
