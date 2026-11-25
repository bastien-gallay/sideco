/**
 * What a key asks of the board (out of board-view.ts, T259): on a card, and on
 * the name of a lane. Plain rules, tested without a page; board-view.ts does
 * what is asked. A key that only reads (`reads`) works on the past too; every
 * other one needs the board live.
 */
import type { Direction } from "./view.ts";

/** What of a key press the rules read. */
export type Keyed = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "metaKey" | "ctrlKey">;

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** One member per thing asked, so each can be told from the others by its `ask`. */
type Ask<K extends string, More = unknown> = K extends string ? { ask: K } & More : never;

export type CardKey =
  | { ask: "go"; direction: Direction; reads: true }
  | Ask<"move" | "beside", { direction: Direction }>
  | Ask<"rename" | "choose" | "remove" | "done" | "link" | "note" | "detail">;

export type LaneKey =
  | { ask: "to-lane"; by: 1 | -1; reads: true }
  | { ask: "to-cards"; reads: true }
  | { ask: "move"; direction: Direction }
  /** A new lane, after this one or before it. */
  | { ask: "add"; after: boolean }
  | Ask<"hint" | "rename" | "remove">;

/** Which of Shift and Alt is held alone; "none" for neither, undefined for any other chord. */
function held(e: Keyed): "none" | "shift" | "alt" | undefined {
  if (e.metaKey || e.ctrlKey || (e.shiftKey && e.altKey)) return undefined;
  return e.shiftKey ? "shift" : e.altKey ? "alt" : "none";
}

/** The gestures a card has on one key, whatever is held with it; a letter in either case. */
const CARD: Record<string, CardKey> = {
  F2: { ask: "rename" },
  " ": { ask: "choose" },
  Delete: { ask: "remove" },
  Backspace: { ask: "remove" },
  d: { ask: "done" },
  l: { ask: "link" },
  n: { ask: "note" },
  e: { ask: "detail" },
};

/** What a key asks with the keyboard on a card; undefined for a key that is not the board's. */
export function cardKey(e: Keyed): CardKey | undefined {
  const direction = ARROWS[e.key];
  const chord = held(e);
  // The arrows read, so they work on the past too; Shift and an arrow move, so only live.
  if (direction && chord === "none") return { ask: "go", direction, reads: true };
  if (direction && chord === "shift") return { ask: "move", direction };
  if (direction && chord === "alt") return { ask: "beside", direction };
  // ⌘↵ or Ctrl+Enter is the page's: it sends to Claude, whatever holds the keyboard.
  if (e.key === "Enter") return e.metaKey || e.ctrlKey ? undefined : { ask: "rename" };
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return Object.hasOwn(CARD, key) ? CARD[key] : undefined;
}

function laneArrow(direction: Direction, e: Keyed): LaneKey | undefined {
  const chord = held(e);
  const sideways = direction === "left" || direction === "right";
  if (sideways && chord === "none")
    return { ask: "to-lane", by: direction === "right" ? 1 : -1, reads: true };
  if (direction === "down" && chord === "none") return { ask: "to-cards", reads: true };
  if (chord === "shift") return { ask: "move", direction };
  if (sideways && e.altKey) return { ask: "add", after: direction === "right" };
  return undefined;
}

/** What a key asks with the keyboard on the name of a lane; undefined for a key that is not the board's. */
export function laneKey(e: Keyed): LaneKey | undefined {
  const direction = ARROWS[e.key];
  if (direction) return laneArrow(direction, e);
  if (e.key === "+") return { ask: "add", after: true };
  if (e.key === "Enter" && e.shiftKey) return { ask: "hint" };
  if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "F2") return { ask: "rename" };
  if (e.key === "Delete" || e.key === "Backspace") return { ask: "remove" };
  return undefined;
}
