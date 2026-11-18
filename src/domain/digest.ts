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
import { findFormat } from "./formats.ts";
import {
  apply,
  type Board,
  type Element,
  emptyWorkspace,
  findBoard,
  findElement,
  type Workspace,
} from "./workspace.ts";

export function describeBoard(board: Board): string {
  const format = findFormat(board.format);
  const lines = [`# ${board.id} — ${board.title} (${board.format}, seq ${board.changedSeq})`];
  const show = (id: string): string => {
    const e = findElement(board, id);
    if (!e) return id;
    return `  ${e.id} ${e.type} ${quote(e.label)}${e.detail ? ` — ${e.detail}` : ""}`;
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
      lines.push(`lane ${lane.id} (${lane.label})`);
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
  const open = board.notes.filter((n) => !n.resolved);
  if (open.length > 0) {
    lines.push("open notes");
    for (const n of open) lines.push(`  ${n.id} by ${n.by}${n.target ? ` on ${n.target}` : ""}: ${n.text}`);
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
}

interface Entry {
  board: string;
  line: string;
}

/** Where an element was, and what it said, when the reader last saw it. */
interface Origin {
  label: string;
  col: number;
  lane: string;
  /** The element that followed it in its lane; position in a lane is meaning (priority). */
  next: string | undefined;
}

/** What `by` changed on the boards in events after `after`. */
export function describeChanges(events: readonly Recorded[], after: number, by: Actor = "human"): Changes {
  const ws = emptyWorkspace();
  const entries = new Map<string, Entry>();
  const added = new Set<string>();
  const origin = new Map<string, Origin>();
  /** Moves are worded at the end, against the final board: a later change can undo them. */
  const moves = new Map<string, { board: string; id: string; from: Origin }>();
  /** Boards `by` made in this window: removing one of those is no news. */
  const made = new Set<string>();
  /** Boards the reader knew that `by` removed, with the title they had. */
  const gone = new Map<string, string>();
  let passed = false;
  let message: string | undefined;

  /** A removed board takes every pending line about it along, whoever removed it. */
  const forget = (board: string): void => {
    for (const [key, entry] of entries) if (entry.board === board) entries.delete(key);
    for (const [key, move] of moves) if (move.board === board) moves.delete(key);
    for (const key of added) if (key.startsWith(`${board}/`)) added.delete(key);
    for (const key of origin.keys()) if (key.startsWith(`${board}/`)) origin.delete(key);
  };

  for (const e of events) {
    if (e.event === "BoardRemoved") {
      const mine = e.seq > after && e.actor === by;
      if (mine && !made.delete(e.board)) gone.set(e.board, e.title);
      forget(e.board);
      if (gone.has(e.board)) entries.set(`${e.board}/removed/`, { board: e.board, line: "− board removed" });
    } else if (e.seq > after && e.actor === by && "board" in e) {
      const board = findBoard(ws, e.board);
      const k = (kind: string, id: string): string => `${e.board}/${kind}/${id}`;
      const put = (kind: string, id: string, line: string): void => {
        entries.set(k(kind, id), { board: e.board, line });
      };
      const el = "id" in e && board ? findElement(board, e.id) : undefined;

      switch (e.event) {
        case "BoardCreated":
          made.add(e.board);
          put("board", "", `+ board created: ${quote(e.title)} (${e.format})`);
          break;
        case "BoardRetitled":
          put("title", "", `~ board retitled ${quote(e.title)}`);
          break;
        case "ElementAdded":
          added.add(k("el", e.id));
          put("add", e.id, addedLine(ws, e.board, e.id, e.type, e.label, e.col, e.lane));
          break;
        case "ElementRenamed":
          if (!el) break;
          if (added.has(k("el", e.id)))
            put("add", e.id, addedLine(ws, e.board, e.id, el.type, e.label, el.col, el.lane));
          else {
            const from = remember(origin, k("el", e.id), board, el);
            if (from.label === e.label) entries.delete(k("rename", e.id));
            else put("rename", e.id, `~ ${e.id} renamed ${quote(from.label)} → ${quote(e.label)}`);
          }
          break;
        case "ElementMoved":
          if (!el) break;
          if (added.has(k("el", e.id)))
            put("add", e.id, addedLine(ws, e.board, e.id, el.type, el.label, e.col, e.lane));
          else {
            moves.set(k("move", e.id), {
              board: e.board,
              id: e.id,
              from: remember(origin, k("el", e.id), board, el),
            });
            if (!entries.has(k("move", e.id))) put("move", e.id, "");
          }
          break;
        case "ElementAnnotated":
          put("detail", e.id, `~ ${e.id} detail: ${e.detail || "(cleared)"}`);
          break;
        case "ElementRemoved":
          for (const kind of ["add", "rename", "move", "detail"]) entries.delete(k(kind, e.id));
          moves.delete(k("move", e.id));
          if (added.delete(k("el", e.id))) break;
          if (el) put("remove", e.id, `− ${e.id} ${el.type} ${quote(el.label)} removed`);
          break;
        case "ColumnInserted":
          put(
            "column",
            String(e.seq),
            `+ empty column inserted at ${e.at} (columns from ${e.at} shifted right)`,
          );
          break;
        case "EdgeAdded":
          entries.delete(k("unlink", `${e.src}>${e.dst}`));
          put(
            "link",
            `${e.src}>${e.dst}`,
            `+ link ${e.src} -> ${e.dst}${e.label ? ` ${quote(e.label)}` : ""}`,
          );
          break;
        case "EdgeRemoved":
          if (!entries.delete(k("link", `${e.src}>${e.dst}`)))
            put("unlink", `${e.src}>${e.dst}`, `− link ${e.src} -> ${e.dst}`);
          break;
        case "FocusSet":
          put("focus", "", `focus on ${e.ids.join(", ")}${e.reason ? `: ${e.reason}` : ""}`);
          break;
        case "FocusCleared":
          entries.delete(k("focus", ""));
          break;
        case "NoteAdded":
          put("note", e.id, `note ${e.id}${e.target ? ` on ${e.target}` : ""}: ${e.text}`);
          break;
        case "NoteResolved":
          if (!entries.delete(k("note", e.id))) put("resolve", e.id, `✓ note ${e.id} resolved`);
          break;
        case "TurnPassed":
          if (e.to === "agent") {
            passed = true;
            message = e.message;
          }
          break;
      }
    }
    apply(ws, e);
  }

  for (const [key, move] of moves) {
    const line = movedLine(ws, move.board, move.id, move.from);
    if (line) entries.set(key, { board: move.board, line });
    else entries.delete(key);
  }
  return {
    text: render(ws, gone, [...entries.values()], passed, message),
    count: entries.size,
    upTo: ws.seq,
    passed,
  };
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

function addedLine(
  ws: Workspace,
  boardId: string,
  id: string,
  type: string,
  label: string,
  col: number,
  lane: string,
): string {
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

function render(
  ws: Workspace,
  gone: ReadonlyMap<string, string>,
  entries: Entry[],
  passed: boolean,
  message: string | undefined,
): string {
  if (entries.length === 0 && !passed) return "";
  const lines: string[] = [];
  for (const board of new Set(entries.map((entry) => entry.board))) {
    lines.push(`board ${board} ${quote(findBoard(ws, board)?.title ?? gone.get(board) ?? board)}`);
    for (const entry of entries) if (entry.board === board) lines.push(`  ${entry.line}`);
  }
  if (passed)
    lines.push(message ? `The human passed you the turn: ${message}` : "The human passed you the turn.");
  return lines.join("\n");
}

function quote(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}
