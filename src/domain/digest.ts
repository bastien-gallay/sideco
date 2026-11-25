/**
 * Boards as text, for the agent. Two readings, the first in describe.ts:
 *
 * - `describeBoard`: the whole board, compact enough to read on every turn, or a
 *   part of it; `describeCard`: one card with what is tied to it.
 * - `describeChanges`: what one actor did since a given point, net of back-and-forth
 *   (an element renamed twice shows once; one added then removed does not show; a
 *   gesture and the undo that takes it back show neither).
 *
 * Lines carry a sign so the meaning survives without colour: + added, − removed,
 * ~ renamed, → moved.
 */

import { quote, under } from "./describe.ts";
import {
  type Added,
  type Change,
  type Entry,
  type Net,
  netChanges,
  nextInLane,
  type Origin,
} from "./digest-net.ts";
import type { Actor, Recorded } from "./events.ts";
import { findFormat, planAxis } from "./formats.ts";
import { findBoard, findElement, type Workspace } from "./workspace.ts";

export { describeBoard, describeCard, type Part } from "./describe.ts";

export interface Changes {
  /** Empty when nothing changed. */
  text: string;
  count: number;
  /** The journal position this digest is current to. */
  upTo: number;
  /** Whether the actor handed the turn to the agent in this span. */
  passed: boolean;
  /** What the lines name, board by board, so a page can mark what the reader has not read yet. */
  about: Subjects[];
}

/** The cards and the discussions the lines of a digest name on one board, each once. */
export interface Subjects {
  board: string;
  elements: string[];
  /** Each discussion by the id of the note that opened it. */
  threads: string[];
}

/** What `by` changed on the boards in events after `after`. */
export function describeChanges(
  events: readonly Recorded[],
  after: number,
  by: Actor = "human",
  /** The boards the reader is told about; all of them when not given. */
  only?: (board: string) => boolean,
): Changes {
  const read = only ? events.filter((e) => !("board" in e) || only(e.board)) : events;
  const net = netChanges(read, after, by);
  const told = net.entries.flatMap((entry) => {
    const line = word(net.ws, entry.board, entry.change);
    return line === undefined ? [] : [{ ...entry, line }];
  });
  return {
    text: render(net, told),
    count: told.length,
    // Up to the last event of all: what was left out is not for this reader later either.
    upTo: events.at(-1)?.seq ?? 0,
    passed: net.passed,
    about: subjects(told),
  };
}

type Said<K extends Change["kind"]> = (
  change: Extract<Change, { kind: K }>,
  ws: Workspace,
  boardId: string,
) => string | undefined;

/** Where a lane or a slice was added: before another, else at the end. */
const placed = (before: string | undefined): string => (before ? ` before ${before}` : " at the end");

/** How each kind of change is said, in one line. */
const SAID: { [K in Change["kind"]]: Said<K> } = {
  passed: () => undefined, // said at the foot
  "board-created": (c) => `+ board created: ${quote(c.title)} (${c.format})`,
  "board-retitled": (c) => `~ board retitled ${quote(c.title)}`,
  "board-purposed": (c) =>
    c.purpose ? `~ board asks ${quote(c.purpose)}` : "~ board back to its workshop's question",
  "lane-named": (c) =>
    c.label ? `~ lane ${c.lane} named ${quote(c.label)}` : `~ lane ${c.lane} back to its workshop's name`,
  "lane-hinted": (c) =>
    c.hint ? `~ lane ${c.lane} hinted ${quote(c.hint)}` : `~ lane ${c.lane} back to its workshop's hint`,
  "axis-named": (c, ws, boardId) => {
    if (!c.label) return `~ axis ${c.axis} back to its workshop's`;
    const board = findBoard(ws, boardId);
    const format = board && findFormat(board.format);
    const axis = format && planAxis(format, { axes: { [c.axis]: c } }, c.axis, "en");
    return `~ axis ${c.axis} named ${quote(c.label)}${axis ? ` (${axis.low} → ${axis.high})` : ""}`;
  },
  "lane-added": (c) => `+ lane ${c.lane}${c.label ? ` ${quote(c.label)}` : ""} added${placed(c.before)}`,
  "lane-removed": (c) => `− lane ${c.lane} removed`,
  "slice-added": (c) => `+ slice ${c.slice} ${quote(c.label)} added${placed(c.before)}`,
  "slice-removed": (c) => `− slice ${c.slice} removed`,
  "lane-moved": (c) => `~ lane ${c.lane} moved ${c.before ? `before ${c.before}` : "to the end"}`,
  "board-removed": () => "− board removed",
  "board-restored": () => "+ board restored",
  added: (c, ws, boardId) => `${addedLine(ws, boardId, c)}${c.restored ? " restored" : ""}`,
  renamed: (c) => `~ ${c.id} renamed ${quote(c.from)} → ${quote(c.to)}`,
  moved: (c, ws, boardId) => movedLine(ws, boardId, c.id, c.from),
  placed: (c) => `→ ${c.id} placed at ${c.at.x},${c.at.y}`,
  placing: (c) => `~ cards placed ${c.byHand ? "by hand" : "by their links"}`,
  labeled: (c) => `~ ${c.id} ${c.on ? "labeled" : "unlabeled"} ${c.label}`,
  annotated: (c) => `~ ${c.id} detail: ${under(c.detail) || "(cleared)"}`,
  marked: (c) => `~ ${c.id} ${c.done ? "marked done" : "no longer done"}`,
  removed: (c) => `− ${c.id} ${c.type} ${quote(c.label)} removed`,
  renumbered: (c) => `~ ${c.id} renumbered as ${c.to}${c.type ? `, a ${c.type}` : ""}`,
  "column-inserted": (c) => `+ empty column inserted at ${c.at} (columns from ${c.at} shifted right)`,
  "column-removed": (c) => `− empty column ${c.at} removed (columns from ${c.at + 1} shifted left)`,
  "column-moved": (c) => {
    const [first, last] = c.from < c.to ? [c.from + 1, c.to] : [c.to, c.from - 1];
    const passed = first === last ? `column ${first}` : `columns ${first} to ${last}`;
    return `~ column ${c.from} moved to ${c.to} with its cards (${passed} shifted ${c.from < c.to ? "left" : "right"})`;
  },
  linked: (c) => `+ link ${c.src} -> ${c.dst}${c.label ? ` ${quote(c.label)}` : ""}`,
  unlinked: (c) => `− link ${c.src} -> ${c.dst}`,
  focused: (c) => `focus on ${c.ids.join(", ")}${c.reason ? `: ${c.reason}` : ""}`,
  noted: (c) => {
    const on = c.target ? ` on ${c.target}` : "";
    return c.thread ? `reply ${c.id} to ${c.thread}${on}: ${c.text}` : `note ${c.id}${on}: ${c.text}`;
  },
  resolved: (c) => `✓ note ${c.id} resolved`,
};

/** One change as a line for the reader; undefined for a move that ended where it started. */
function word(ws: Workspace, boardId: string, change: Change): string | undefined {
  return (SAID[change.kind] as Said<Change["kind"]>)(change, ws, boardId);
}

/** The cards a change is about, and the discussion it belongs to: what its line names. */
function named(change: Change): { elements: string[]; thread?: string } {
  switch (change.kind) {
    case "added":
    case "renamed":
    case "moved":
    case "placed":
    case "annotated":
    case "labeled":
    case "marked":
    case "removed":
      return { elements: [change.id] };
    case "renumbered":
      return { elements: [change.to] };
    case "linked":
    case "unlinked":
      return { elements: [change.src, change.dst] };
    case "focused":
      return { elements: change.ids };
    case "noted":
      return { elements: change.target ? [change.target] : [], thread: change.thread ?? change.id };
    case "resolved":
      return { elements: [], thread: change.id };
    case "placing":
    case "board-created":
    case "board-retitled":
    case "board-purposed":
    case "lane-named":
    case "lane-hinted":
    case "axis-named":
    case "lane-added":
    case "lane-removed":
    case "lane-moved":
    case "slice-added":
    case "slice-removed":
    case "board-removed":
    case "board-restored":
    case "passed":
    case "column-inserted":
    case "column-removed":
    case "column-moved":
      return { elements: [] };
  }
}

/** What the changes told name, grouped by board; a board whose lines name nothing is left out. */
function subjects(told: readonly Entry[]): Subjects[] {
  const boards = new Map<string, { elements: Set<string>; threads: Set<string> }>();
  for (const { board, change } of told) {
    const { elements, thread } = named(change);
    if (elements.length === 0 && thread === undefined) continue;
    const on = boards.get(board) ?? { elements: new Set(), threads: new Set() };
    boards.set(board, on);
    for (const id of elements) on.elements.add(id);
    if (thread !== undefined) on.threads.add(thread);
  }
  return [...boards].map(([board, on]) => ({
    board,
    elements: [...on.elements],
    threads: [...on.threads],
  }));
}

function addedLine(ws: Workspace, boardId: string, { id, type, label, col, lane }: Added): string {
  const layout = findFormat(findBoard(ws, boardId)?.format ?? "")?.layout;
  const where = layout === "timeline" ? ` (col ${col})` : layout === "columns" ? ` (lane ${lane})` : "";
  return `+ ${id} ${type} ${quote(label)}${where}`;
}

/** The move from where the reader last saw the element to where it is now; undefined when it is back in place. */
function movedLine(ws: Workspace, boardId: string, id: string, from: Origin): string | undefined {
  const board = findBoard(ws, boardId);
  const el = board ? findElement(board, id) : undefined;
  if (!board || !el) return undefined;
  if (findFormat(board.format)?.layout !== "columns")
    return from.col === el.col ? undefined : `→ ${id} moved col ${from.col} → ${el.col}`;
  const next = nextInLane(board, el);
  if (from.lane !== el.lane)
    return `→ ${id} moved lane ${from.lane} → ${el.lane}${next ? `, before ${next}` : ""}`;
  if (from.next === next) return undefined;
  return next
    ? `→ ${id} moved before ${next} in lane ${el.lane}`
    : `→ ${id} moved to the end of lane ${el.lane}`;
}

function render({ ws, gone, passed, words }: Net, told: { board: string; line: string }[]): string {
  if (told.length === 0 && !passed) return "";
  const lines: string[] = [];
  for (const board of new Set(told.map((entry) => entry.board))) {
    lines.push(`board ${board} ${quote(findBoard(ws, board)?.title ?? gone.get(board) ?? board)}`);
    for (const entry of told) if (entry.board === board) lines.push(`  ${entry.line}`);
  }
  const message = words.join(" / ");
  if (passed)
    lines.push(message ? `The human passed you the turn: ${message}` : "The human passed you the turn.");
  return lines.join("\n");
}
