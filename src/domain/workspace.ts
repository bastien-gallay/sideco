/**
 * The projection: a workspace is what you get by folding the journal.
 *
 * `apply` mutates the workspace it is given and trusts its input: an event in the
 * journal already passed `decide`. `replay` is the pure entry point, and the only
 * way to get a workspace for a past moment.
 */
import type { Actor, Recorded, Todo } from "./events.ts";
import { invert, remember as rememberGesture, shiftColumns, supersede, type Trails } from "./undo.ts";

export interface Element {
  id: string;
  type: string;
  label: string;
  detail?: string;
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
  message?: string;
  seq: number;
}

export interface Board {
  id: string;
  title: string;
  format: string;
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
}

export interface Workspace {
  /** In the order they were created. */
  boards: Board[];
  /** Removed boards, kept aside as they were: undoing the removal brings one back. */
  removed: Board[];
  sessions: Session[];
  seq: number;
}

export function emptyWorkspace(): Workspace {
  return { boards: [], removed: [], sessions: [], seq: 0 };
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

/** The session the agent most recently acted in, if any. */
export function latestSession(ws: Workspace): Session | undefined {
  return ws.sessions.reduce<Session | undefined>((a, s) => (a && a.lastSeq > s.lastSeq ? a : s), undefined);
}

/** The highest column in use; 0 on an empty board, since columns are numbered from 1. */
export function lastColumn(board: Board): number {
  return board.elements.reduce((max, e) => Math.max(max, e.col), 0);
}

/** The number part of an id shaped `<letter><digits>`, or 0. */
export function idNumber(id: string): number {
  const n = Number(id.slice(1));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function apply(ws: Workspace, e: Recorded): void {
  ws.seq = e.seq;
  if ("board" in e) applyToBoard(ws, e);
  else if (e.session) applyToSession(ws, e as Recorded & { session: string });
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
      notes: [],
      focus: null,
      turn: null,
      minted: {},
      retired: [],
      trails: {},
      createdSeq: e.seq,
      changedSeq: e.seq,
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
      shiftColumns(board, e.at);
      break;
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
      board.turn = { to: e.to, message: e.message, seq: e.seq };
      break;
  }
  if (inverse) rememberGesture(board, e, inverse);
  supersede(board, e);
}

function remember(board: Board, id: string): void {
  const prefix = id.charAt(0);
  board.minted[prefix] = Math.max(board.minted[prefix] ?? 0, idNumber(id));
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

function applyToSession(ws: Workspace, e: Recorded & { session: string }): void {
  let session = findSession(ws, e.session);
  if (!session) {
    session = {
      id: e.session,
      startedAt: e.ts,
      turns: [],
      todos: [],
      status: "idle",
      deliveredUpTo: 0,
      lastSeq: e.seq,
    };
    ws.sessions.push(session);
  }
  session.lastSeq = e.seq;
  const turn = session.turns.at(-1);

  switch (e.event) {
    case "SessionStarted":
      session.cwd = e.cwd;
      if (session.status === "ended") setStatus(session, "idle");
      break;
    case "PromptSubmitted":
      session.turns.push({ prompt: e.text, startedSeq: e.seq, startedAt: e.ts, tools: [], ended: false });
      setStatus(session, "thinking");
      break;
    case "ToolStarted": {
      const open = turn && !turn.ended ? turn : openTurn(session, e);
      open.tools.push({ call: e.call, tool: e.tool, summary: e.summary, status: "running", seq: e.seq });
      setStatus(session, "running", `${e.tool} ${e.summary}`.trim());
      break;
    }
    case "ToolFinished": {
      const tool = turn?.tools.find((t) => t.call === e.call);
      if (tool) tool.status = e.ok ? "ok" : "failed";
      setStatus(session, "thinking");
      break;
    }
    case "TodosUpdated":
      session.todos = e.todos;
      break;
    case "AgentNotified":
      setStatus(session, "waiting", e.message);
      break;
    case "TurnEnded":
      closeTurn(turn);
      setStatus(session, "idle");
      break;
    case "SessionEnded":
      closeTurn(turn);
      setStatus(session, "ended");
      break;
    case "ChangesDelivered":
      session.deliveredUpTo = Math.max(session.deliveredUpTo, e.upTo);
      break;
  }
}

/** A tool can start with no prompt before it: a resumed session, or hooks installed mid-turn. */
function openTurn(session: Session, e: Recorded): SessionTurn {
  const turn: SessionTurn = { prompt: "", startedSeq: e.seq, startedAt: e.ts, tools: [], ended: false };
  session.turns.push(turn);
  return turn;
}

function closeTurn(turn: SessionTurn | undefined): void {
  if (!turn) return;
  turn.ended = true;
  for (const t of turn.tools) if (t.status === "running") t.status = "ok";
}

function setStatus(session: Session, status: AgentStatus, detail?: string): void {
  session.status = status;
  session.statusDetail = detail;
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
