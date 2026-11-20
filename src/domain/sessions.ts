/**
 * The sessions of the workspace as their events tell them: started, named,
 * thinking, running a tool, waiting, ended; and the boards each follows.
 * Folded by `apply` in workspace.ts, the one place a projection changes.
 */
import type { Recorded } from "./events.ts";
import { handledAll } from "./handled-all.ts";
import type { AgentStatus, Session, SessionTurn, Workspace } from "./workspace.ts";

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
      deliveredUpTo: 0,
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
