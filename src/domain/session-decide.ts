/**
 * Commands about a terminal session, not a board, become events here: what it
 * follows, what it is called, what its turn and its tools do.
 */
import type { Command } from "./commands.ts";
import { CommandError } from "./commands.ts";
import type { Context } from "./decide.ts";
import type { SidecoEvent, Todo } from "./events.ts";
import { noBoard } from "./guards.ts";
import { findBoard, findSession, type Workspace } from "./workspace.ts";

export type SessionCommand = Exclude<Command, { board: string }>;

export function decideOnSession(ws: Workspace, cmd: SessionCommand, ctx: Context): SidecoEvent[] {
  if (!ctx.session) throw new CommandError(`\`${cmd.kind}\` needs a session`);
  const todos = findSession(ws, ctx.session)?.todos ?? [];
  switch (cmd.kind) {
    case "session-start":
      return [{ event: "SessionStarted", cwd: cmd.cwd }];
    case "name-session":
      if (findSession(ws, ctx.session)?.name === cmd.name) return [];
      return [{ event: "SessionNamed", name: cmd.name }];
    case "follow":
    case "unfollow": {
      for (const board of cmd.boards) if (!findBoard(ws, board)) throw noBoard(ws, board);
      const follows = cmd.kind === "follow";
      const session = ctx.session;
      const boards = cmd.boards.filter((board) =>
        follows ? !ws.follows[session]?.includes(board) : !ws.left[session]?.includes(board),
      );
      if (boards.length === 0) return [];
      return [{ event: follows ? "BoardsFollowed" : "BoardsLeft", boards }];
    }
    case "prompt":
      return [{ event: "PromptSubmitted", text: cmd.text }];
    case "tool-start":
      return [{ event: "ToolStarted", call: cmd.call, tool: cmd.tool, summary: cmd.summary }];
    case "tool-finish":
      return [{ event: "ToolFinished", call: cmd.call, ok: cmd.ok }];
    case "todos":
      return [{ event: "TodosUpdated", todos: cmd.todos }];
    case "task-created": {
      if (todos.some((t) => t.id === cmd.id)) return [];
      const created: Todo = { id: cmd.id, text: cmd.text, status: "pending" };
      return [{ event: "TodosUpdated", todos: [...todos, created] }];
    }
    case "task-completed": {
      if (!todos.some((t) => t.id === cmd.id && t.status !== "completed")) return [];
      const done = todos.map((t): Todo => (t.id === cmd.id ? { ...t, status: "completed" } : t));
      return [{ event: "TodosUpdated", todos: done }];
    }
    case "notify":
      return [{ event: "AgentNotified", message: cmd.message }];
    case "turn-end":
      return [{ event: "TurnEnded" }];
    case "session-end":
      return [{ event: "SessionEnded" }];
    case "delivered":
      return [{ event: "ChangesDelivered", upTo: cmd.upTo }];
  }
}
