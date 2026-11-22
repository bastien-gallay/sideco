/**
 * The sessions of the workspace as their events tell them: started, named,
 * thinking, running a tool, waiting, ended; and the boards each follows.
 * Folded by `apply` in workspace.ts, the one place a projection changes.
 */
import type { Recorded, Todo } from "./events.ts";
import { handledAll } from "./handled-all.ts";
import { findBoard, findSession, type Workspace } from "./workspace.ts";

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

export function follow(ws: Workspace, session: string, boards: readonly string[]): void {
  ws.follows[session] = [...without(ws.follows[session], boards), ...boards];
  ws.left[session] = without(ws.left[session], boards);
}

function without(list: readonly string[] | undefined, boards: readonly string[]): string[] {
  return (list ?? []).filter((board) => !boards.includes(board));
}

/** A session event, with the session it belongs to. */
export type SessionRecorded = Exclude<Recorded, { board: string }> & { session: string };

export function applyToSession(ws: Workspace, e: SessionRecorded): void {
  let session = ws.sessions.find((s) => s.id === e.session);
  if (!session) {
    session = {
      id: e.session,
      startedAt: e.ts,
      turns: [],
      todos: [],
      status: "idle",
      // What another session was told is no news to one that starts now (T175).
      deliveredUpTo: Math.max(0, ...ws.sessions.map((other) => other.deliveredUpTo)),
      lastSeq: e.seq,
      lastAt: e.ts,
    };
    ws.sessions.push(session);
  }
  session.lastSeq = e.seq;
  session.lastAt = e.ts;
  const turn = session.turns.at(-1);

  switch (e.event) {
    case "SessionNamed":
      session.name = e.name;
      break;
    case "SessionStarted":
      session.cwd = e.cwd;
      if (session.status === "ended") setStatus(session, "idle");
      break;
    case "BoardsFollowed":
      follow(ws, session.id, e.boards);
      break;
    case "BoardsLeft":
      ws.follows[session.id] = without(ws.follows[session.id], e.boards);
      ws.left[session.id] = [...without(ws.left[session.id], e.boards), ...e.boards];
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
    default:
      handledAll(e);
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

/** The turns of a session its panel shows: the last ones. */
export const TURNS_SHOWN = 4;

const isTool = (e: Recorded): boolean => e.event === "ToolStarted" || e.event === "ToolFinished";

/**
 * Whether a page is sent `e`. Every fact is, but of the tools each session ran
 * only those of the turns its panel shows: four fifths of a journal are tools.
 * Travelling back in time, an older turn shows its prompt and not its tools.
 */
export function forThePage(ws: Workspace): (e: Recorded) => boolean {
  const since = new Map(ws.sessions.map((s) => [s.id, s.turns.at(-TURNS_SHOWN)?.startedSeq ?? 0]));
  return (e) => !isTool(e) || e.seq >= (since.get(e.session ?? "") ?? 0);
}

/**
 * Whether the human or the agent did anything in the session: a prompt, or a
 * tool. A claude started and left untouched did not; the page does not offer it.
 */
export function hasSpoken(session: Session): boolean {
  return session.turns.length > 0;
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
