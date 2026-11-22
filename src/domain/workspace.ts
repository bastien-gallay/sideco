/**
 * The projection: a workspace is what you get by folding the journal.
 *
 * `apply` mutates the workspace it is given and trusts its input: an event in the
 * journal already passed `decide`. `replay` is the pure entry point, and the only
 * way to get a workspace for a past moment.
 */
import type { Actor, Recorded, Todo } from "./events.ts";
import { LANE_PREFIX, lanesOf, SLICE_PREFIX } from "./formats.ts";
import { handledAll } from "./handled-all.ts";
import { hasLabel, sameLabel } from "./labels.ts";
import { remember } from "./minting.ts";
import { applyToSession, follow, hasSpoken, type SessionRecorded } from "./sessions.ts";
import {
  invert,
  leaveBehind,
  remapColumns,
  remember as rememberGesture,
  supersede,
  type Trails,
} from "./undo.ts";

export interface Element {
  id: string;
  type: string;
  label: string;
  detail?: string;
  /** What the card stands for is done; absent while it is not. */
  done?: boolean;
  /** Free words shared by every board: `type:bug`, `assignee:bastien`, `release 0.4`. Absent while none. */
  labels?: string[];
  col: number;
  lane: string;
  by: Actor;
  addedSeq: number;
  changedSeq: number;
}

export interface Edge {
  src: string;
  dst: string;
  label?: string;
  by: Actor;
}

export interface Note {
  id: string;
  text: string;
  /** The element the discussion is about; a reply carries the one of its thread. */
  target?: string;
  /** The note that opened the discussion this one answers. */
  thread?: string;
  by: Actor;
  seq: number;
  resolved: boolean;
}

/** A discussion: the note that opened it, then its replies, in order. Its id is the opening note's. */
export interface Thread {
  id: string;
  target?: string;
  resolved: boolean;
  notes: Note[];
}

export interface Turn {
  to: "agent" | "human";
  /** The session a hand-over to the agent is for; none, and it is for every session the board concerns. */
  target?: string;
  message?: string;
  seq: number;
}

/** A named line across a story map: the stories above it ship before the ones below. */
export interface Slice {
  id: string;
  label: string;
}

/** An axis of a plan as a board names it: an end left out is the workshop's. */
export interface Axis {
  label: string;
  low?: string;
  high?: string;
}

export interface Board {
  id: string;
  title: string;
  format: string;
  /** The lanes this board calls its own way, by lane id; the others keep the name their workshop gives. */
  lanes: Record<string, string>;
  /** The question the board answers, where it asks its own. */
  purpose?: string;
  /** What a lane stands for, by lane id, where the board says it its own way. */
  hints?: Record<string, string>;
  /** The axes of a plan the board names its own way. */
  axes?: Partial<Record<"x" | "y", Axis>>;
  /** The board's own lanes, in order, once it added, moved or removed one; until then, its workshop's (see `lanesOf`). */
  laneOrder?: string[];
  /** The lines under the stories of a story map, top to bottom: what ships first is above. */
  slices?: Slice[];
  /** In stacking order: within a cell, earlier elements sit first. */
  elements: Element[];
  edges: Edge[];
  notes: Note[];
  focus: { ids: string[]; reason?: string } | null;
  turn: Turn | null;
  /** Highest number ever used per id prefix: the next minted id is one above. */
  minted: Record<string, number>;
  /** Ids of removed elements. With the ids in use, they are every id ever given: none is given twice. */
  retired: string[];
  /** Per author, the gestures they can still take back on this board, and put back. */
  trails: Trails;
  createdSeq: number;
  changedSeq: number;
  /** The last session whose agent wrote on the board: a hand-over goes to it by default. */
  writer?: string;
}

export interface ToolCall {
  call: string;
  tool: string;
  summary: string;
  status: "running" | "ok" | "failed";
  seq: number;
}

export interface SessionTurn {
  prompt: string;
  startedSeq: number;
  startedAt: string;
  tools: ToolCall[];
  ended: boolean;
}

/** `ended`: the terminal session is over; it comes back to `idle` if it is resumed. */
export type AgentStatus = "idle" | "thinking" | "running" | "waiting" | "ended";

export interface Session {
  id: string;
  /** What the session goes by, once it was named; else the start of its id (see `sessionLabel`). */
  name?: string;
  cwd?: string;
  startedAt: string;
  turns: SessionTurn[];
  todos: Todo[];
  status: AgentStatus;
  /** What the status is about: the running tool, or the notification text. */
  statusDetail?: string;
  /** Human changes up to this seq have been handed to the agent. */
  deliveredUpTo: number;
  lastSeq: number;
  /** When it last said anything: a session silent too long was killed (see `isOpen`). */
  lastAt: string;
}

/**
 * A session silent for this long was killed rather than ended: it never sent
 * `SessionEnded`. A working day, as long as a session at rest stays reachable.
 */
export const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/** Whether a session is still open at `now`: it has not ended, and spoke within `staleMs`. */
export function isOpen(session: Session, now: number, staleMs = STALE_SESSION_MS): boolean {
  return session.status !== "ended" && now - Date.parse(session.lastAt) < staleMs;
}

export interface Workspace {
  /** In the order they were created. */
  boards: Board[];
  /** Removed boards, kept aside as they were: undoing the removal brings one back. */
  removed: Board[];
  sessions: Session[];
  /** Per session, the boards it follows: those it wrote on, and those it said it takes. */
  follows: Record<string, string[]>;
  /** Per session, the boards it let go of: not for it, even when nobody else follows them. */
  left: Record<string, string[]>;
  seq: number;
}

export function emptyWorkspace(): Workspace {
  return { boards: [], removed: [], sessions: [], follows: {}, left: {}, seq: 0 };
}

export function replay(events: readonly Recorded[]): Workspace {
  const ws = emptyWorkspace();
  for (const e of events) apply(ws, e);
  return ws;
}

export function findBoard(ws: Workspace, id: string): Board | undefined {
  return ws.boards.find((b) => b.id === id);
}

export function findElement(board: Board, id: string): Element | undefined {
  return board.elements.find((e) => e.id === id);
}

export function findSession(ws: Workspace, id: string): Session | undefined {
  return ws.sessions.find((s) => s.id === id);
}

/** The session the agent most recently acted in, if any, among those `keep` keeps. */
export function latestSession(ws: Workspace, keep = (_: Session) => true): Session | undefined {
  const kept = ws.sessions.filter(keep);
  return kept.reduce<Session | undefined>((a, s) => (a && a.lastSeq > s.lastSeq ? a : s), undefined);
}

/** What a session goes by: its name, else the start of its id. */
export function sessionLabel(session: Session): string {
  return session.name ?? session.id.slice(0, 8);
}

/**
 * The session the page tells about: the one the reader chose, while it exists; else
 * the one the board in view is for (`addressee`); else the last spoken to (`hasSpoken`).
 */
export function shownSession(ws: Workspace, board?: string, chosen?: string): Session | undefined {
  const picked = chosen ? findSession(ws, chosen) : undefined;
  const latest = latestSession(ws, hasSpoken) ?? latestSession(ws);
  return picked ?? (board ? addressee(ws, board) : undefined) ?? latest;
}

/**
 * The session a hand-over on `board` goes to when none is named: the last one
 * to write on it, while it runs; else the latest session the board is for.
 */
export function addressee(ws: Workspace, board: string): Session | undefined {
  const writer = findBoard(ws, board)?.writer;
  const session = writer ? findSession(ws, writer) : undefined;
  if (session && session.status !== "ended") return session;
  return latestSession(ws, (s) => s.status !== "ended" && concerns(ws, s.id, board));
}

/** The number a column carries once the column `from` has moved to `to`: the ones it passes close the gap. */
export function columnAfterMove(col: number, from: number, to: number): number {
  if (col === from) return to;
  if (from < to && col > from && col <= to) return col - 1;
  if (to < from && col >= to && col < from) return col + 1;
  return col;
}

/** The highest column in use; 0 on an empty board, since columns are numbered from 1. */
export function lastColumn(board: Board): number {
  return board.elements.reduce((max, e) => Math.max(max, e.col), 0);
}

export function apply(ws: Workspace, e: Recorded): void {
  ws.seq = e.seq;
  if ("board" in e) {
    applyToBoard(ws, e);
    // Writing on a board is following it.
    if (e.session && e.actor === "agent") follow(ws, e.session, [e.board]);
  } else if (e.session) applyToSession(ws, e as SessionRecorded);
}

function applyToBoard(ws: Workspace, e: Extract<Recorded, { board: string }>): void {
  if (e.event === "BoardCreated") {
    // The id is taken again: the board that had it can no longer come back.
    ws.removed = ws.removed.filter((b) => b.id !== e.board);
    ws.boards.push({
      id: e.board,
      title: e.title,
      format: e.format,
      elements: [],
      edges: [],
      lanes: {},
      notes: [],
      focus: null,
      turn: null,
      minted: {},
      retired: [],
      trails: {},
      createdSeq: e.seq,
      changedSeq: e.seq,
      ...(e.actor === "agent" && e.session ? { writer: e.session } : {}),
    });
    return;
  }
  if (e.event === "BoardRestored") {
    const back = ws.removed.find((b) => b.id === e.board);
    if (!back || findBoard(ws, e.board)) return;
    const inverse = invert(back, e);
    ws.removed.splice(ws.removed.indexOf(back), 1);
    ws.boards.push(back);
    ws.boards.sort((a, b) => a.createdSeq - b.createdSeq);
    back.changedSeq = e.seq;
    if (inverse) rememberGesture(back, e, inverse);
    return;
  }
  const board = findBoard(ws, e.board);
  if (!board) return;
  // A refused undo says something about the trail, not about the board.
  if (e.event === "UndoRefused") {
    leaveBehind(board, e.actor, e.way, e.gestures);
    return;
  }
  if (e.actor === "agent" && e.session) board.writer = e.session;
  const inverse = invert(board, e);
  if (e.event === "BoardRemoved") {
    ws.boards.splice(ws.boards.indexOf(board), 1);
    ws.removed.push(board);
    if (inverse) rememberGesture(board, e, inverse);
    return;
  }
  board.changedSeq = e.seq;

  switch (e.event) {
    case "BoardRetitled":
      board.title = e.title;
      break;
    case "BoardPurposed":
      if (e.purpose) board.purpose = e.purpose;
      else delete board.purpose;
      break;
    case "LaneNamed":
      if (e.label) board.lanes[e.lane] = e.label;
      else delete board.lanes[e.lane];
      break;
    case "LaneHinted": {
      const hints = { ...board.hints };
      if (e.hint) hints[e.lane] = e.hint;
      else delete hints[e.lane];
      board.hints = hints;
      break;
    }
    case "AxisNamed": {
      const axes = { ...board.axes };
      if (e.label)
        axes[e.axis] = {
          label: e.label,
          ...(e.low ? { low: e.low } : {}),
          ...(e.high ? { high: e.high } : {}),
        };
      else delete axes[e.axis];
      board.axes = axes;
      break;
    }
    case "LaneAdded": {
      const order = lanesOf(board).filter((lane) => lane !== e.lane);
      const at = e.before === undefined ? -1 : order.indexOf(e.before);
      order.splice(at === -1 ? order.length : at, 0, e.lane);
      board.laneOrder = order;
      if (e.label) board.lanes[e.lane] = e.label;
      else delete board.lanes[e.lane];
      const n = /^lane-(\d+)$/.exec(e.lane)?.[1];
      if (n) board.minted[LANE_PREFIX] = Math.max(board.minted[LANE_PREFIX] ?? 0, Number(n));
      break;
    }
    case "SliceAdded": {
      const order = (board.slices ?? []).filter((slice) => slice.id !== e.slice);
      const at = e.before === undefined ? -1 : order.findIndex((slice) => slice.id === e.before);
      order.splice(at === -1 ? order.length : at, 0, { id: e.slice, label: e.label });
      board.slices = order;
      const n = /^slice-(\d+)$/.exec(e.slice)?.[1];
      if (n) board.minted[SLICE_PREFIX] = Math.max(board.minted[SLICE_PREFIX] ?? 0, Number(n));
      break;
    }
    case "SliceRemoved":
      board.slices = (board.slices ?? []).filter((slice) => slice.id !== e.slice);
      break;
    case "LaneRemoved":
      board.laneOrder = lanesOf(board).filter((lane) => lane !== e.lane);
      delete board.lanes[e.lane];
      if (board.hints?.[e.lane] !== undefined) {
        const { [e.lane]: _gone, ...hints } = board.hints;
        board.hints = hints;
      }
      break;
    case "LaneMoved": {
      const order = lanesOf(board).filter((lane) => lane !== e.lane);
      if (order.length === lanesOf(board).length) break;
      const at = e.before === undefined ? -1 : order.indexOf(e.before);
      order.splice(at === -1 ? order.length : at, 0, e.lane);
      board.laneOrder = order;
      break;
    }
    case "ElementAdded": {
      remember(board, e.id);
      board.elements.push({
        id: e.id,
        type: e.type,
        label: e.label,
        detail: e.detail,
        col: e.col,
        lane: e.lane,
        by: e.actor,
        addedSeq: e.seq,
        changedSeq: e.seq,
      });
      break;
    }
    case "ElementRenamed":
      touch(board, e.id, e.seq, (el) => {
        el.label = e.label;
      });
      break;
    case "ElementAnnotated":
      touch(board, e.id, e.seq, (el) => {
        el.detail = e.detail || undefined;
      });
      break;
    case "ElementMarked":
      touch(board, e.id, e.seq, (el) => {
        el.done = e.done || undefined;
      });
      break;
    case "ElementLabeled":
      touch(board, e.id, e.seq, (el) => {
        if (!hasLabel(el, e.label)) el.labels = [...(el.labels ?? []), e.label];
      });
      break;
    case "ElementUnlabeled":
      touch(board, e.id, e.seq, (el) => {
        const left = (el.labels ?? []).filter((label) => !sameLabel(label, e.label));
        el.labels = left.length > 0 ? left : undefined;
      });
      break;
    case "ElementMoved": {
      const el = touch(board, e.id, e.seq, (moved) => {
        moved.col = e.col;
        moved.lane = e.lane;
      });
      if (el) restack(board, el, e.before);
      break;
    }
    case "ElementRemoved":
      if (findElement(board, e.id)) board.retired.push(e.id);
      board.elements = board.elements.filter((el) => el.id !== e.id);
      board.edges = board.edges.filter((edge) => edge.src !== e.id && edge.dst !== e.id);
      if (board.focus) {
        const ids = board.focus.ids.filter((id) => id !== e.id);
        board.focus = ids.length > 0 ? { ...board.focus, ids } : null;
      }
      break;
    case "ElementRestored": {
      if (findElement(board, e.id)) break;
      board.retired = board.retired.filter((id) => id !== e.id);
      const el: Element = {
        id: e.id,
        type: e.type,
        label: e.label,
        detail: e.detail,
        done: e.done || undefined,
        ...(e.labels?.length ? { labels: [...e.labels] } : {}),
        col: e.col,
        lane: e.lane,
        by: e.by,
        addedSeq: e.addedSeq,
        changedSeq: e.seq,
      };
      board.elements.push(el);
      restack(board, el, e.before);
      // A link comes back only if its other end is still there, and no newer link took its place.
      for (const edge of e.edges) {
        const known = board.edges.some((other) => other.src === edge.src && other.dst === edge.dst);
        if (!known && findElement(board, edge.src) && findElement(board, edge.dst))
          board.edges.push({ ...edge });
      }
      break;
    }
    case "ColumnInserted":
      for (const el of board.elements) if (el.col >= e.at) el.col += 1;
      remapColumns(board, (col) => (col >= e.at ? col + 1 : col));
      break;
    case "ColumnRemoved":
      for (const el of board.elements) if (el.col > e.at) el.col -= 1;
      remapColumns(board, (col) => (col > e.at ? col - 1 : col));
      break;
    case "ColumnMoved": {
      const moved = (col: number): number => columnAfterMove(col, e.from, e.to);
      for (const el of board.elements) el.col = moved(el.col);
      remapColumns(board, moved);
      break;
    }
    case "EdgeAdded":
      board.edges = board.edges.filter((edge) => !(edge.src === e.src && edge.dst === e.dst));
      board.edges.push({ src: e.src, dst: e.dst, label: e.label, by: e.by ?? e.actor });
      break;
    case "EdgeRemoved":
      board.edges = board.edges.filter((edge) => !(edge.src === e.src && edge.dst === e.dst));
      break;
    case "FocusSet":
      board.focus = { ids: e.ids, reason: e.reason };
      break;
    case "FocusCleared":
      board.focus = null;
      break;
    case "NoteAdded":
      remember(board, e.id);
      board.notes.push({
        id: e.id,
        text: e.text,
        target: e.target,
        thread: e.thread,
        by: e.actor,
        seq: e.seq,
        resolved: false,
      });
      break;
    case "NoteResolved": {
      for (const note of board.notes) if (threadOf(note) === e.id) note.resolved = true;
      break;
    }
    case "TurnPassed":
      board.turn = { to: e.to, message: e.message, seq: e.seq, ...(e.target ? { target: e.target } : {}) };
      break;
    default:
      handledAll(e);
  }
  if (inverse) rememberGesture(board, e, inverse);
  supersede(board, e);
}

function touch(board: Board, id: string, seq: number, change: (el: Element) => void): Element | undefined {
  const el = findElement(board, id);
  if (!el) return undefined;
  change(el);
  el.changedSeq = seq;
  return el;
}

/** Puts `el` just before `before` in stacking order, or last when `before` is absent. */
function restack(board: Board, el: Element, before: string | undefined): void {
  const rest = board.elements.filter((other) => other !== el);
  const at = before === undefined ? -1 : rest.findIndex((other) => other.id === before);
  if (at === -1) rest.push(el);
  else rest.splice(at, 0, el);
  board.elements = rest;
}

/**
 * True when what happens on `board` is for `session`: it follows the board; or
 * no other session still running does, and it did not let go of it.
 */
export function concerns(ws: Workspace, session: string, board: string): boolean {
  if (ws.follows[session]?.includes(board)) return true;
  if (ws.left[session]?.includes(board)) return false;
  return !ws.sessions.some(
    (other) => other.id !== session && other.status !== "ended" && ws.follows[other.id]?.includes(board),
  );
}

/**
 * The session that reads what happens on `board`: the latest that it concerns.
 * Its delivery cursor says what on the board is not read yet; another session's
 * cursor moves past changes it was never told about.
 */
export function readerOf(ws: Workspace, board: string): Session | undefined {
  return latestSession(ws, (s) => concerns(ws, s.id, board));
}

/** The id of the discussion a note belongs to. */
export function threadOf(note: Note): string {
  return note.thread ?? note.id;
}

/** The board's notes as discussions, in the order they were opened. */
export function threads(board: Board): Thread[] {
  const byId = new Map<string, Thread>();
  for (const note of board.notes) {
    const thread = byId.get(threadOf(note));
    if (thread) thread.notes.push(note);
    else byId.set(note.id, { id: note.id, target: note.target, resolved: note.resolved, notes: [note] });
  }
  return [...byId.values()];
}
