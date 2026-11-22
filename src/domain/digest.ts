/**
 * Boards as text, for the agent. Two readings:
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

import { cancelledOut } from "./cancelled.ts";
import { CommandError } from "./commands.ts";
import type { Actor, Recorded } from "./events.ts";
import { findFormat, laneHint, laneName, lanesOf, planAxis, wearsDone } from "./formats.ts";
import { threads } from "./threads.ts";
import {
  apply,
  type Board,
  type Element,
  emptyWorkspace,
  findBoard,
  findElement,
  type Thread,
  type Workspace,
} from "./workspace.ts";

/** A part of a board to read instead of the whole; the fields combine. */
export interface Part {
  /** One lane, with the links and the notes that touch its cards. */
  lane?: string;
  /** One column of a timeline, likewise. */
  col?: number;
  /** The cards without their details. */
  brief?: boolean;
  /** The open notes and nothing else. */
  notes?: boolean;
}

/** The first line of every reading: the board, and the part read when it is not all of it. */
function heading(board: Board, part: string[]): string {
  const whole = `# ${board.id} — ${board.title} (${board.format}, seq ${board.changedSeq})`;
  return part.length === 0 ? whole : `${whole} · part: ${part.join(", ")}`;
}

function cardLine(board: Board, e: Element, brief = false): string {
  const detail = e.detail && !brief ? ` — ${under(e.detail)}` : "";
  const labels = e.labels?.length ? ` [${e.labels.join(", ")}]` : "";
  const former = e.formerIds?.length ? ` (formerly ${e.formerIds.join(", ")})` : "";
  return `  ${e.id}${former} ${e.type} ${quote(e.label)}${wearsDone(board, e) ? " ✓ done" : ""}${labels}${detail}`;
}

function linkLine(edge: { src: string; dst: string; label?: string }): string {
  return `  ${edge.src} -> ${edge.dst}${edge.label ? ` ${quote(edge.label)}` : ""}`;
}

function threadLines(thread: Thread, sayClosed = false): string[] {
  const [first, ...replies] = thread.notes;
  if (!first) return [];
  const closed = sayClosed && thread.resolved ? " (resolved)" : "";
  return [
    `  ${first.id} by ${first.by}${first.target ? ` on ${first.target}` : ""}: ${first.text}${closed}`,
    ...replies.map((reply) => `    ${reply.id} by ${reply.by}: ${reply.text}`),
  ];
}

export function describeBoard(board: Board, part: Part = {}): string {
  const format = findFormat(board.format);
  const name = format?.name.en ?? board.format;
  if (part.lane !== undefined) {
    if (format?.layout !== "columns") throw new CommandError(`${name} boards have no lanes`);
    const lanes = lanesOf(board);
    if (!lanes.includes(part.lane))
      throw new CommandError(`${name} has no lane "${part.lane}" (lanes: ${lanes.join(", ")})`);
  }
  if (part.col !== undefined && format?.layout !== "timeline")
    throw new CommandError(`${name} boards have no columns`);

  const said = [
    part.lane !== undefined && `lane ${part.lane}`,
    part.col !== undefined && `col ${part.col}`,
    part.brief && "brief",
    part.notes && "notes",
  ].filter((word): word is string => typeof word === "string");
  const lines = [heading(board, said)];
  if (board.purpose) lines.push(`question: ${quote(board.purpose)}`);
  const narrowed = part.lane !== undefined || part.col !== undefined;
  const elements = board.elements.filter(
    (e) =>
      (part.lane === undefined || e.lane === part.lane) && (part.col === undefined || e.col === part.col),
  );
  const shown = new Set(elements.map((e) => e.id));
  const show = (e: Element): string => cardLine(board, e, part.brief);

  if (part.notes) {
    // The notes alone: the cards are left out.
  } else if (elements.length === 0) lines.push("(empty)");
  else if (format?.layout === "timeline") {
    const columns = [...new Set(elements.map((e) => e.col))].sort((a, b) => a - b);
    for (const col of columns) {
      lines.push(`col ${col}`);
      for (const type of format.types) {
        for (const e of elements) if (e.col === col && e.type === type.id) lines.push(show(e));
      }
    }
  } else if (format?.layout === "columns") {
    for (const id of ["x", "y"] as const) {
      const axis = narrowed ? undefined : planAxis(format, board, id, "en");
      if (axis) lines.push(`axis ${id} ${quote(axis.label)} (${axis.low} → ${axis.high})`);
    }
    for (const id of lanesOf(board)) {
      if (part.lane !== undefined && id !== part.lane) continue;
      const hint = laneHint(format, board, id, "en");
      const laneSaid = laneName(format, board, id, "en");
      lines.push(`lane ${id} (${hint ? `${laneSaid}: ${hint}` : laneSaid})`);
      for (const e of elements) if (e.lane === id) lines.push(show(e));
    }
  } else {
    lines.push("elements");
    for (const e of elements) lines.push(show(e));
  }

  const slices = board.slices ?? [];
  if (slices.length > 0 && !narrowed)
    lines.push(`slices: ${slices.map((slice) => `${slice.id} ${quote(slice.label)}`).join(", ")}`);
  // Of a part, the links and the notes that touch a card shown.
  const edges = part.notes
    ? []
    : board.edges.filter((edge) => !narrowed || shown.has(edge.src) || shown.has(edge.dst));
  if (edges.length > 0) lines.push("links", ...edges.map(linkLine));
  const open = threads(board).filter((thread) => {
    const target = thread.notes[0]?.target;
    return !thread.resolved && (!narrowed || (target !== undefined && shown.has(target)));
  });
  if (open.length > 0) lines.push("open notes", ...open.flatMap((thread) => threadLines(thread)));
  if (board.focus && !part.notes)
    lines.push(`focus: ${board.focus.ids.join(", ")}${board.focus.reason ? ` — ${board.focus.reason}` : ""}`);
  return lines.join("\n");
}

/** One card: its line, where it is, its links, and its threads, closed ones included. */
export function describeCard(board: Board, id: string): string {
  const e = findElement(board, id);
  if (!e) throw new CommandError(`no element ${id} on "${board.id}"`);
  const format = findFormat(board.format);
  const lines = [heading(board, [`card ${id}`]), cardLine(board, e)];
  if (format?.layout === "timeline") lines.push(`  in col ${e.col}`);
  else if (format?.layout === "columns")
    lines.push(`  in lane ${e.lane} (${laneName(format, board, e.lane, "en")})`);
  const edges = board.edges.filter((edge) => edge.src === id || edge.dst === id);
  if (edges.length > 0) lines.push("links", ...edges.map(linkLine));
  const about = threads(board).filter((thread) => thread.notes[0]?.target === id);
  if (about.length > 0) lines.push("notes", ...about.flatMap((thread) => threadLines(thread, true)));
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

/** One thing to tell, as data: netted while the journal is read, worded once it is read. */
type Change =
  | { kind: "board-created"; title: string; format: string }
  | { kind: "board-retitled"; title: string }
  | { kind: "board-purposed"; purpose: string }
  | { kind: "lane-named"; lane: string; label: string }
  | { kind: "lane-hinted"; lane: string; hint: string }
  | { kind: "axis-named"; axis: "x" | "y"; label: string; low?: string; high?: string }
  | { kind: "lane-added"; lane: string; label: string; before?: string }
  | { kind: "slice-added"; slice: string; label: string; before?: string }
  | { kind: "slice-removed"; slice: string }
  | { kind: "lane-removed"; lane: string }
  | { kind: "lane-moved"; lane: string; before?: string }
  | { kind: "board-removed" }
  | { kind: "board-restored" }
  | { kind: "added"; id: string; type: string; label: string; col: number; lane: string; restored?: true }
  | { kind: "renamed"; id: string; from: string; to: string }
  /** Judged at the end, against the final board: a later change can put the card back. */
  | { kind: "moved"; id: string; from: Origin }
  | { kind: "annotated"; id: string; detail: string }
  | { kind: "labeled"; id: string; label: string; on: boolean }
  | { kind: "marked"; id: string; done: boolean }
  | { kind: "removed"; id: string; type: string; label: string }
  | { kind: "renumbered"; id: string; to: string; type?: string }
  | { kind: "column-inserted"; at: number }
  | { kind: "column-removed"; at: number }
  | { kind: "column-moved"; from: number; to: number }
  | { kind: "linked"; src: string; dst: string; label?: string }
  | { kind: "unlinked"; src: string; dst: string }
  | { kind: "focused"; ids: string[]; reason?: string }
  | { kind: "noted"; id: string; text: string; target?: string; thread?: string }
  | { kind: "resolved"; id: string }
  | { kind: "passed"; message?: string }; // a hand-over, shelved with its board like any change

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
  const silent = cancelledOut(events, after, by);
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
    const mine = e.seq > after && e.actor === by && !silent.has(e.seq);
    if (e.event === "BoardCreated") {
      shelved.delete(e.board);
      absent.delete(e.board);
    }
    if (silent.has(e.seq) && (e.event === "BoardRemoved" || e.event === "BoardRestored")) {
      // A removal and its undo that cancel out: what was pending is put away, then back, as it was.
      if (e.event === "BoardRemoved") shelve(e.board);
      else unshelve(e.board);
    } else if (e.event === "BoardRemoved") {
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
        case "BoardPurposed":
          put("purpose", "", { kind: "board-purposed", purpose: e.purpose });
          break;
        case "LaneNamed":
          put("lane", e.lane, { kind: "lane-named", lane: e.lane, label: e.label });
          break;
        case "LaneHinted":
          put("lane-hint", e.lane, { kind: "lane-hinted", lane: e.lane, hint: e.hint });
          break;
        case "AxisNamed":
          put("axis", e.axis, { kind: "axis-named", axis: e.axis, label: e.label, low: e.low, high: e.high });
          break;
        case "LaneAdded":
          put("lane-edit", e.lane, { kind: "lane-added", lane: e.lane, label: e.label, before: e.before });
          break;
        case "LaneRemoved":
          // Added and removed since the reader looked: no news.
          if (entries.get(k("lane-edit", e.lane))?.change.kind === "lane-added") {
            entries.delete(k("lane-edit", e.lane));
            entries.delete(k("lane", e.lane));
            entries.delete(k("lane-hint", e.lane));
            entries.delete(k("lane-place", e.lane));
          } else put("lane-edit", e.lane, { kind: "lane-removed", lane: e.lane });
          break;
        case "SliceAdded":
          put("slice", e.slice, { kind: "slice-added", slice: e.slice, label: e.label, before: e.before });
          break;
        case "SliceRemoved":
          // Added and removed since the reader looked: no news.
          if (entries.get(k("slice", e.slice))?.change.kind === "slice-added")
            entries.delete(k("slice", e.slice));
          else put("slice", e.slice, { kind: "slice-removed", slice: e.slice });
          break;
        case "LaneMoved":
          put("lane-place", e.lane, { kind: "lane-moved", lane: e.lane, before: e.before });
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
        case "ElementLabeled":
        case "ElementUnlabeled": {
          // Put and taken since the reader looked, or the reverse: no news.
          const at = `${e.id}/${e.label.toLowerCase()}`;
          if (!entries.delete(k("label", at)))
            put("label", at, { kind: "labeled", id: e.id, label: e.label, on: e.event === "ElementLabeled" });
          break;
        }
        case "ElementMarked":
          // Marked and cleared since the reader looked, or the reverse: no news.
          if (!entries.delete(k("done", e.id))) put("done", e.id, { kind: "marked", id: e.id, done: e.done });
          break;
        case "ElementRemoved":
          for (const kind of ["add", "rename", "move", "detail", "done"]) entries.delete(k(kind, e.id));
          for (const key of [...entries.keys()])
            if (key.startsWith(k("label", `${e.id}/`))) entries.delete(key);
          if (added.delete(k("el", e.id)) || entries.delete(k("restore", e.id))) break;
          if (el) put("remove", e.id, { kind: "removed", id: e.id, type: el.type, label: el.label });
          break;
        case "ElementRenumbered":
          put("renumber", e.id, { kind: "renumbered", id: e.id, to: e.to, type: e.type });
          break;
        case "ElementRestored":
          // Removed and restored since the reader looked: no news. Otherwise it is back, and they are told where.
          if (!entries.delete(k("remove", e.id))) put("restore", e.id, { ...asAdded(e), restored: true });
          break;
        case "ColumnInserted":
          put("column", String(e.seq), { kind: "column-inserted", at: e.at });
          break;
        case "ColumnRemoved":
          put("column", String(e.seq), { kind: "column-removed", at: e.at });
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
          if (e.to === "agent") put("turn", String(e.seq), { kind: "passed", message: e.message });
          break;
      }
    }
    apply(ws, e);
  }

  const turns = [...entries.values()].flatMap(({ change }) => (change.kind === "passed" ? [change] : []));
  const words = [...new Set(turns.flatMap((turn) => (turn.message ? [turn.message] : [])))];
  return { ws, entries: [...entries.values()], gone, passed: turns.length > 0, words };
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
    case "passed":
      return undefined; // said at the foot
    case "board-created":
      return `+ board created: ${quote(change.title)} (${change.format})`;
    case "board-retitled":
      return `~ board retitled ${quote(change.title)}`;
    case "board-purposed":
      return change.purpose
        ? `~ board asks ${quote(change.purpose)}`
        : "~ board back to its workshop's question";
    case "lane-named":
      return change.label
        ? `~ lane ${change.lane} named ${quote(change.label)}`
        : `~ lane ${change.lane} back to its workshop's name`;
    case "lane-hinted":
      return change.hint
        ? `~ lane ${change.lane} hinted ${quote(change.hint)}`
        : `~ lane ${change.lane} back to its workshop's hint`;
    case "axis-named": {
      if (!change.label) return `~ axis ${change.axis} back to its workshop's`;
      const board = findBoard(ws, boardId);
      const format = board && findFormat(board.format);
      const axis = format && planAxis(format, { axes: { [change.axis]: change } }, change.axis, "en");
      return `~ axis ${change.axis} named ${quote(change.label)}${axis ? ` (${axis.low} → ${axis.high})` : ""}`;
    }
    case "lane-added": {
      const named = change.label ? ` ${quote(change.label)}` : "";
      return `+ lane ${change.lane}${named} added${change.before ? ` before ${change.before}` : " at the end"}`;
    }
    case "lane-removed":
      return `− lane ${change.lane} removed`;
    case "slice-added":
      return `+ slice ${change.slice} ${quote(change.label)} added${change.before ? ` before ${change.before}` : " at the end"}`;
    case "slice-removed":
      return `− slice ${change.slice} removed`;
    case "lane-moved":
      return `~ lane ${change.lane} moved ${change.before ? `before ${change.before}` : "to the end"}`;
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
    case "labeled":
      return `~ ${change.id} ${change.on ? "labeled" : "unlabeled"} ${change.label}`;
    case "annotated":
      return `~ ${change.id} detail: ${under(change.detail) || "(cleared)"}`;
    case "marked":
      return `~ ${change.id} ${change.done ? "marked done" : "no longer done"}`;
    case "removed":
      return `− ${change.id} ${change.type} ${quote(change.label)} removed`;
    case "renumbered":
      return `~ ${change.id} renumbered as ${change.to}${change.type ? `, a ${change.type}` : ""}`;
    case "column-inserted":
      return `+ empty column inserted at ${change.at} (columns from ${change.at} shifted right)`;
    case "column-removed":
      return `− empty column ${change.at} removed (columns from ${change.at + 1} shifted left)`;
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

/** A text of several lines, its later lines set under the line that carries it. */
function under(text: string): string {
  return text.replace(/\n/g, "\n      ");
}

function quote(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}
