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
  /** The detail is read, not written: on the past too. */
  | { ask: "read"; reads: true }
  | Ask<"move" | "beside", { direction: Direction }>
  /** To the top of its cell, or to its foot (S355). */
  | { ask: "end"; top: boolean }
  | Ask<"rename" | "choose" | "remove" | "done" | "link" | "linked" | "note" | "detail" | "label">;

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

/** The gestures a card has on one key: a named key whatever is held with it, a letter in either case. */
const CARD: Record<string, CardKey> = {
  F2: { ask: "rename" },
  " ": { ask: "choose" },
  Delete: { ask: "remove" },
  Backspace: { ask: "remove" },
  d: { ask: "done" },
  l: { ask: "link" },
  a: { ask: "linked" },
  n: { ask: "note" },
  e: { ask: "detail" },
  i: { ask: "read", reads: true },
  t: { ask: "label" },
};

/** The gesture of a card on this key, if it has one. */
function gesture(e: Keyed): CardKey | undefined {
  const letter = e.key.length === 1 && e.key !== " ";
  // A letter held with Ctrl, ⌘ or Alt is a chord of the browser, not a gesture of the card.
  if (letter && (e.ctrlKey || e.metaKey || e.altKey)) return undefined;
  const key = letter ? e.key.toLowerCase() : e.key;
  return Object.hasOwn(CARD, key) ? CARD[key] : undefined;
}

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
  if ((e.key === "Home" || e.key === "End") && chord === "shift")
    return { ask: "end", top: e.key === "Home" };
  return gesture(e);
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
