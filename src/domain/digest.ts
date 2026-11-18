/**
 * Boards as text, for the agent. Two readings:
 *
 * - `describeBoard`: the whole board, compact enough to read on every turn.
 * - `describeChanges`: what one actor did since a given point, net of back-and-forth
 *   (an element renamed twice shows once; one added then removed does not show).
 *
 * Lines carry a sign so the meaning survives without colour: + added, − removed,
 * ~ renamed, → moved.
 */
import type { Actor, Recorded } from "./events.ts";
import { findFormat, laneName } from "./formats.ts";
import {
  apply,
  type Board,
  type Element,
  emptyWorkspace,
  findBoard,
  findElement,
  threads,
  type Workspace,
} from "./workspace.ts";

export function describeBoard(board: Board): string {
  const format = findFormat(board.format);
  const lines = [`# ${board.id} — ${board.title} (${board.format}, seq ${board.changedSeq})`];
  const show = (id: string): string => {
    const e = findElement(board, id);
    if (!e) return id;
    return `  ${e.id} ${e.type} ${quote(e.label)}${e.done ? " ✓ done" : ""}${e.detail ? ` — ${under(e.detail)}` : ""}`;
  };

  if (board.elements.length === 0) lines.push("(empty)");
  else if (format?.layout === "timeline") {
    const columns = [...new Set(board.elements.map((e) => e.col))].sort((a, b) => a - b);
    for (const col of columns) {
      lines.push(`col ${col}`);
      for (const type of format.types) {
        for (const e of board.elements) if (e.col === col && e.type === type.id) lines.push(show(e.id));
      }
    }
  } else if (format?.layout === "columns") {
    for (const lane of format.lanes) {
      const name = laneName(format, board, lane.id, "en");
      lines.push(`lane ${lane.id} (${lane.hint ? `${name}: ${lane.hint.en}` : name})`);
      for (const e of board.elements) if (e.lane === lane.id) lines.push(show(e.id));
    }
  } else {
    lines.push("elements");
    for (const e of board.elements) lines.push(show(e.id));
  }

  if (board.edges.length > 0) {
    lines.push("links");
    for (const edge of board.edges)
      lines.push(`  ${edge.src} -> ${edge.dst}${edge.label ? ` ${quote(edge.label)}` : ""}`);
  }
  const open = threads(board).filter((thread) => !thread.resolved);
  if (open.length > 0) {
    lines.push("open notes");
    for (const thread of open) {
      const [first, ...replies] = thread.notes;
      if (!first) continue;
      lines.push(`  ${first.id} by ${first.by}${first.target ? ` on ${first.target}` : ""}: ${first.text}`);
      for (const reply of replies) lines.push(`    ${reply.id} by ${reply.by}: ${reply.text}`);
    }
  }
  if (board.focus)
    lines.push(`focus: ${board.focus.ids.join(", ")}${board.focus.reason ? ` — ${board.focus.reason}` : ""}`);
  return lines.join("\n");
}

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
export function describeChanges(events: readonly Recorded[], after: number, by: Actor = "human"): Changes {
  const net = netChanges(events, after, by);
  const told = net.entries.flatMap((entry) => {
    const line = word(net.ws, entry.board, entry.change);
    return line === undefined ? [] : [{ ...entry, line }];
  });
  return {
    text: render(net, told),
    count: told.length,
    upTo: net.ws.seq,
    passed: net.passed,
    about: subjects(told),
  };
}

/** One thing to tell, as data: netted while the journal is read, worded once it is read. */
type Change =
  | { kind: "board-created"; title: string; format: string }
  | { kind: "board-retitled"; title: string }
  | { kind: "lane-named"; lane: string; label: string }
  | { kind: "board-removed" }
  | { kind: "board-restored" }
  | { kind: "added"; id: string; type: string; label: string; col: number; lane: string; restored?: true }
  | { kind: "renamed"; id: string; from: string; to: string }
  /** Judged at the end, against the final board: a later change can put the card back. */
  | { kind: "moved"; id: string; from: Origin }
  | { kind: "annotated"; id: string; detail: string }
  | { kind: "marked"; id: string; done: boolean }
  | { kind: "removed"; id: string; type: string; label: string }
  | { kind: "column-inserted"; at: number }
  | { kind: "column-moved"; from: number; to: number }
  | { kind: "linked"; src: string; dst: string; label?: string }
  | { kind: "unlinked"; src: string; dst: string }
  | { kind: "focused"; ids: string[]; reason?: string }
  | { kind: "noted"; id: string; text: string; target?: string; thread?: string }
  | { kind: "resolved"; id: string };

interface Entry {
  board: string;
  change: Change;
}

/** Where an element was, and what it said, when the reader last saw it. */
interface Origin {
  label: string;
  col: number;
  lane: string;
  /** The element that followed it in its lane; position in a lane is meaning (priority). */
  next: string | undefined;
}

/** What one actor changed in a span of the journal, net of back-and-forth, not worded yet. */
interface Net {
  /** The workspace at the end of the journal: the changes are worded against it. */
  ws: Workspace;
  entries: Entry[];
  /** Boards the reader knew that the actor removed, with the title they had. */
  gone: ReadonlyMap<string, string>;
  passed: boolean;
  /** Every word said while handing over, once each: a later hand-over does not erase an earlier word. */
  words: string[];
}

interface Shelf {
  entries: [string, Entry][];
  origin: [string, Origin][];
  added: string[];
  made: boolean;
}

/** Removes and returns what `map` holds about a board: every key starts with the board's id. */
function take<V>(map: Map<string, V>, board: string): [string, V][] {
  const taken = [...map].filter(([key]) => key.startsWith(`${board}/`));
  for (const [key] of taken) map.delete(key);
  return taken;
}

function netChanges(events: readonly Recorded[], after: number, by: Actor): Net {
  const ws = emptyWorkspace();
  const entries = new Map<string, Entry>();
  /** Per thread, the replies told in this span. */
  const replies = new Map<string, string[]>();
  const added = new Set<string>();
  const origin = new Map<string, Origin>();
  /** Boards `by` made in this window: removing one of those is no news. */
  const made = new Set<string>();
  const gone = new Map<string, string>();
  /** Boards that were already removed when the reader last looked. */
  const absent = new Set<string>();
  /** What was pending about a removed board, kept for the case it comes back. */
  const shelved = new Map<string, Shelf>();
  let passed = false;
  const words: string[] = [];

  /** A removed board takes every pending change about it along, whoever removed it. */
  const shelve = (board: string): void => {
    const mine = [...added].filter((key) => key.startsWith(`${board}/`));
    for (const key of mine) added.delete(key);
    shelved.set(board, {
      entries: take(entries, board),
      origin: take(origin, board),
      added: mine,
      made: made.delete(board),
    });
  };
  /** A restored board is back with what was pending about it. */
  const unshelve = (board: string): void => {
    const shelf = shelved.get(board);
    if (!shelf) return;
    shelved.delete(board);
    for (const [key, entry] of shelf.entries) entries.set(key, entry);
    for (const [key, first] of shelf.origin) origin.set(key, first);
    for (const key of shelf.added) added.add(key);
    if (shelf.made) made.add(board);
  };

  for (const e of events) {
    const mine = e.seq > after && e.actor === by;
    if (e.event === "BoardCreated") {
      shelved.delete(e.board);
      absent.delete(e.board);
    }
    if (e.event === "BoardRemoved") {
      if (e.seq <= after) absent.add(e.board);
      // Restored and removed again since the reader looked: for them, it never came back.
      const news = !entries.delete(`${e.board}/restored/`) && !made.has(e.board);
      shelve(e.board);
      if (mine && news) gone.set(e.board, e.title);
      if (gone.has(e.board))
        entries.set(`${e.board}/removed/`, { board: e.board, change: { kind: "board-removed" } });
    } else if (e.event === "BoardRestored") {
      if (e.seq <= after) absent.delete(e.board);
      unshelve(e.board);
      entries.delete(`${e.board}/removed/`);
      gone.delete(e.board);
      if (mine && absent.has(e.board))
        entries.set(`${e.board}/restored/`, { board: e.board, change: { kind: "board-restored" } });
    } else if (mine && "board" in e) {
      const board = findBoard(ws, e.board);
      const k = (kind: string, id: string): string => `${e.board}/${kind}/${id}`;
      const put = (kind: string, id: string, change: Change): void => {
        entries.set(k(kind, id), { board: e.board, change });
      };
      const el = "id" in e && board ? findElement(board, e.id) : undefined;

      switch (e.event) {
        case "BoardCreated":
          made.add(e.board);
          put("board", "", { kind: "board-created", title: e.title, format: e.format });
          break;
        case "BoardRetitled":
          put("title", "", { kind: "board-retitled", title: e.title });
          break;
        case "LaneNamed":
          put("lane", e.lane, { kind: "lane-named", lane: e.lane, label: e.label });
          break;
        case "ElementAdded":
          added.add(k("el", e.id));
          put("add", e.id, asAdded(e));
          break;
        case "ElementRenamed":
          if (!el) break;
          if (added.has(k("el", e.id))) put("add", e.id, { ...asAdded(el), label: e.label });
          else {
            const from = remember(origin, k("el", e.id), board, el);
            if (from.label === e.label) entries.delete(k("rename", e.id));
            else put("rename", e.id, { kind: "renamed", id: e.id, from: from.label, to: e.label });
          }
          break;
        case "ElementMoved":
          if (!el) break;
          if (added.has(k("el", e.id))) put("add", e.id, { ...asAdded(el), col: e.col, lane: e.lane });
          else {
            // The first move keeps its place among the changes, and where the card was then.
            const from = remember(origin, k("el", e.id), board, el);
            if (!entries.has(k("move", e.id))) put("move", e.id, { kind: "moved", id: e.id, from });
          }
          break;
        case "ElementAnnotated":
          put("detail", e.id, { kind: "annotated", id: e.id, detail: e.detail });
          break;
        case "ElementMarked":
          // Marked and cleared since the reader looked, or the reverse: no news.
          if (!entries.delete(k("done", e.id))) put("done", e.id, { kind: "marked", id: e.id, done: e.done });
          break;
        case "ElementRemoved":
          for (const kind of ["add", "rename", "move", "detail", "done"]) entries.delete(k(kind, e.id));
          if (added.delete(k("el", e.id)) || entries.delete(k("restore", e.id))) break;
          if (el) put("remove", e.id, { kind: "removed", id: e.id, type: el.type, label: el.label });
          break;
        case "ElementRestored":
          // Removed and restored since the reader looked: no news. Otherwise it is back, and they are told where.
          if (!entries.delete(k("remove", e.id))) put("restore", e.id, { ...asAdded(e), restored: true });
          break;
        case "ColumnInserted":
          put("column", String(e.seq), { kind: "column-inserted", at: e.at });
          break;
        case "ColumnMoved":
          put("column", String(e.seq), { kind: "column-moved", from: e.from, to: e.to });
          break;
        case "EdgeAdded":
          entries.delete(k("unlink", `${e.src}>${e.dst}`));
          put("link", `${e.src}>${e.dst}`, { kind: "linked", src: e.src, dst: e.dst, label: e.label });
          break;
        case "EdgeRemoved":
          if (!entries.delete(k("link", `${e.src}>${e.dst}`)))
            put("unlink", `${e.src}>${e.dst}`, { kind: "unlinked", src: e.src, dst: e.dst });
          break;
        case "FocusSet":
          put("focus", "", { kind: "focused", ids: e.ids, reason: e.reason });
          break;
        case "FocusCleared":
          entries.delete(k("focus", ""));
          break;
        case "NoteAdded":
          put("note", e.id, { kind: "noted", id: e.id, text: e.text, target: e.target, thread: e.thread });
          if (e.thread)
            replies.set(k("thread", e.thread), [...(replies.get(k("thread", e.thread)) ?? []), e.id]);
          break;
        case "NoteResolved":
          // A thread opened and closed before the reader looked never existed for them, replies included.
          if (entries.delete(k("note", e.id))) {
            for (const reply of replies.get(k("thread", e.id)) ?? []) entries.delete(k("note", reply));
          } else put("resolve", e.id, { kind: "resolved", id: e.id });
          break;
        case "TurnPassed":
          if (e.to === "agent") {
            passed = true;
            if (e.message && !words.includes(e.message)) words.push(e.message);
          }
          break;
      }
    }
    apply(ws, e);
  }

  return { ws, entries: [...entries.values()], gone, passed, words };
}

type Added = Extract<Change, { kind: "added" }>;

/** An element as an addition to tell: what it is and where it sits. */
function asAdded(el: Pick<Element, "id" | "type" | "label" | "col" | "lane">): Added {
  return { kind: "added", id: el.id, type: el.type, label: el.label, col: el.col, lane: el.lane };
}

function remember(origin: Map<string, Origin>, key: string, board: Board | undefined, el: Element): Origin {
  const known = origin.get(key);
  if (known) return known;
  const first = {
    label: el.label,
    col: el.col,
    lane: el.lane,
    next: board ? nextInLane(board, el) : undefined,
  };
  origin.set(key, first);
  return first;
}

function nextInLane(board: Board, el: Element): string | undefined {
  const lane = board.elements.filter((other) => other.lane === el.lane);
  return lane[lane.indexOf(el) + 1]?.id;
}

/** One change as a line for the reader; undefined for a move that ended where it started. */
function word(ws: Workspace, boardId: string, change: Change): string | undefined {
  switch (change.kind) {
    case "board-created":
      return `+ board created: ${quote(change.title)} (${change.format})`;
    case "board-retitled":
      return `~ board retitled ${quote(change.title)}`;
    case "lane-named":
      return change.label
        ? `~ lane ${change.lane} named ${quote(change.label)}`
        : `~ lane ${change.lane} back to its workshop's name`;
    case "board-removed":
      return "− board removed";
    case "board-restored":
      return "+ board restored";
    case "added":
      return `${addedLine(ws, boardId, change)}${change.restored ? " restored" : ""}`;
    case "renamed":
      return `~ ${change.id} renamed ${quote(change.from)} → ${quote(change.to)}`;
    case "moved":
      return movedLine(ws, boardId, change.id, change.from);
    case "annotated":
      return `~ ${change.id} detail: ${under(change.detail) || "(cleared)"}`;
    case "marked":
      return `~ ${change.id} ${change.done ? "marked done" : "no longer done"}`;
    case "removed":
      return `− ${change.id} ${change.type} ${quote(change.label)} removed`;
    case "column-inserted":
      return `+ empty column inserted at ${change.at} (columns from ${change.at} shifted right)`;
    case "column-moved": {
      const [first, last] =
        change.from < change.to ? [change.from + 1, change.to] : [change.to, change.from - 1];
      const passed = first === last ? `column ${first}` : `columns ${first} to ${last}`;
      const way = change.from < change.to ? "left" : "right";
      return `~ column ${change.from} moved to ${change.to} with its cards (${passed} shifted ${way})`;
    }
    case "linked":
      return `+ link ${change.src} -> ${change.dst}${change.label ? ` ${quote(change.label)}` : ""}`;
    case "unlinked":
      return `− link ${change.src} -> ${change.dst}`;
    case "focused":
      return `focus on ${change.ids.join(", ")}${change.reason ? `: ${change.reason}` : ""}`;
    case "noted": {
      const on = change.target ? ` on ${change.target}` : "";
      return change.thread
        ? `reply ${change.id} to ${change.thread}${on}: ${change.text}`
        : `note ${change.id}${on}: ${change.text}`;
    }
    case "resolved":
      return `✓ note ${change.id} resolved`;
  }
}

/** The cards a change is about, and the discussion it belongs to: what its line names. */
function named(change: Change): { elements: string[]; thread?: string } {
  switch (change.kind) {
    case "added":
    case "renamed":
    case "moved":
    case "annotated":
    case "marked":
    case "removed":
      return { elements: [change.id] };
    case "linked":
    case "unlinked":
      return { elements: [change.src, change.dst] };
    case "focused":
      return { elements: change.ids };
    case "noted":
      return { elements: change.target ? [change.target] : [], thread: change.thread ?? change.id };
    case "resolved":
      return { elements: [], thread: change.id };
    case "board-created":
    case "board-retitled":
    case "lane-named":
    case "board-removed":
    case "board-restored":
    case "column-inserted":
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
  if (findFormat(board.format)?.layout !== "columns") {
    return from.col === el.col ? undefined : `→ ${id} moved col ${from.col} → ${el.col}`;
  }
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

/** A text of several lines, its later lines set under the line that carries it. */
function under(text: string): string {
  return text.replace(/\n/g, "\n      ");
}

function quote(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}
