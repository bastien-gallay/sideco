/**
 * Commands become events here, or are refused. `decide` reads the workspace and
 * never changes it; every rule about what a board may contain lives in this file.
 */
import { type Command, CommandError } from "./commands.ts";
import type { Actor, BoardEvent, Todo, VicoEvent } from "./events.ts";
import { type ElementType, type Format, findFormat, findType, NOTE_PREFIX } from "./formats.ts";
import {
  type Board,
  type Element,
  findBoard,
  findElement,
  findSession,
  lastColumn,
  type Note,
  threadOf,
  type Workspace,
} from "./workspace.ts";

export interface Context {
  actor: Actor;
  session?: string;
}

export interface Decision {
  events: VicoEvent[];
  /** The id given to the element or note this command created, if any. */
  minted?: string;
}

type BoardCommand = Extract<Command, { board: string }>;
type SessionCommand = Exclude<Command, { board: string }>;

export function decide(ws: Workspace, cmd: Command, ctx: Context): Decision {
  if (!("board" in cmd)) return { events: decideOnSession(ws, cmd, ctx) };
  const decision = decideOnBoard(ws, cmd, ctx);
  // What one command does is one gesture: one undo takes all of it back.
  const events = decision.events.map((e, i): BoardEvent => (i === 0 ? e : { ...e, joined: true }));
  return { ...decision, events };
}

interface BoardDecision {
  events: BoardEvent[];
  minted?: string;
}

function decideOnBoard(ws: Workspace, cmd: BoardCommand, ctx: Context): BoardDecision {
  if (cmd.kind === "undo" || cmd.kind === "redo") return { events: reverse(ws, cmd, ctx.actor) };
  if (cmd.kind === "create-board") {
    if (findBoard(ws, cmd.board)) {
      throw new CommandError(`board "${cmd.board}" already exists; write to it, or choose another id`);
    }
    requireFormat(cmd.format);
    return { events: [{ event: "BoardCreated", board: cmd.board, title: cmd.title, format: cmd.format }] };
  }

  const board = findBoard(ws, cmd.board);
  if (!board) throw noBoard(ws, cmd.board);
  const format = requireFormat(board.format);
  const b = board.id;

  switch (cmd.kind) {
    case "retitle":
      return { events: [{ event: "BoardRetitled", board: b, title: cmd.title }] };
    case "remove-board":
      return { events: [{ event: "BoardRemoved", board: b, title: board.title }] };
    case "add":
      return add(board, format, cmd);
    case "rename":
      requireElement(board, cmd.id);
      return { events: [{ event: "ElementRenamed", board: b, id: cmd.id, label: cmd.label }] };
    case "annotate":
      requireElement(board, cmd.id);
      return { events: [{ event: "ElementAnnotated", board: b, id: cmd.id, detail: cmd.detail }] };
    case "move":
      return { events: [move(board, format, cmd)] };
    case "remove":
      requireElement(board, cmd.id);
      return { events: [{ event: "ElementRemoved", board: b, id: cmd.id }] };
    case "insert-column":
      if (format.layout !== "timeline")
        throw new CommandError(`${format.name.en} boards have no columns to insert`);
      return { events: [{ event: "ColumnInserted", board: b, at: cmd.at }] };
    case "link":
      requireElement(board, cmd.src);
      requireElement(board, cmd.dst);
      if (cmd.src === cmd.dst) throw new CommandError(`${cmd.src} cannot link to itself`);
      return { events: [{ event: "EdgeAdded", board: b, src: cmd.src, dst: cmd.dst, label: cmd.label }] };
    case "unlink":
      if (!board.edges.some((e) => e.src === cmd.src && e.dst === cmd.dst)) {
        throw new CommandError(`no link ${cmd.src} → ${cmd.dst} on "${b}"`);
      }
      return { events: [{ event: "EdgeRemoved", board: b, src: cmd.src, dst: cmd.dst }] };
    case "focus":
      for (const id of cmd.ids) requireElement(board, id);
      return {
        events: [
          cmd.ids.length === 0
            ? { event: "FocusCleared", board: b }
            : { event: "FocusSet", board: b, ids: cmd.ids, reason: cmd.reason },
        ],
      };
    case "note": {
      if (cmd.target) requireElement(board, cmd.target);
      const id = mint(board, NOTE_PREFIX);
      return {
        events: [{ event: "NoteAdded", board: b, id, text: cmd.text, target: cmd.target }],
        minted: id,
      };
    }
    case "reply": {
      const note = requireNote(board, cmd.to);
      if (note.resolved) throw new CommandError(`note ${threadOf(note)} is resolved: open a new note`);
      const id = mint(board, NOTE_PREFIX);
      return {
        events: [
          { event: "NoteAdded", board: b, id, text: cmd.text, target: note.target, thread: threadOf(note) },
        ],
        minted: id,
      };
    }
    case "resolve": {
      const note = requireNote(board, cmd.id);
      return { events: note.resolved ? [] : [{ event: "NoteResolved", board: b, id: threadOf(note) }] };
    }
    case "pass":
      return { events: [{ event: "TurnPassed", board: b, to: cmd.to, message: cmd.message }] };
  }
}

function noBoard(ws: Workspace, id: string): CommandError {
  const known = ws.boards.map((b) => b.id).join(", ") || "none yet";
  return new CommandError(`no board "${id}" (boards: ${known})`);
}

/**
 * Undo and redo say again what the board kept as the way back, marked with the
 * gesture they answer. On a removed board, the only thing to take back is the removal.
 */
function reverse(ws: Workspace, cmd: { kind: "undo" | "redo"; board: string }, actor: Actor): BoardEvent[] {
  const live = findBoard(ws, cmd.board);
  const board = live ?? ws.removed.find((b) => b.id === cmd.board);
  if (!board) throw noBoard(ws, cmd.board);
  const gesture = board.trails[actor]?.[cmd.kind].at(-1);
  if (!gesture || (!live && gesture.inverse[0]?.event !== "BoardRestored")) {
    throw new CommandError(`nothing to ${cmd.kind} on "${board.id}"`);
  }
  const answers = cmd.kind === "undo" ? { undoes: gesture.seq } : { redoes: gesture.seq };
  return gesture.inverse.map((e): BoardEvent => ({ ...e, ...answers }));
}

function add(board: Board, format: Format, cmd: Extract<Command, { kind: "add" }>): BoardDecision {
  const type = findType(format, cmd.type);
  if (!type) {
    const allowed = format.types.map((t) => t.id).join(", ");
    throw new CommandError(`${format.name.en} has no "${cmd.type}" (types: ${allowed})`);
  }
  if (cmd.from) requireElement(board, cmd.from);
  const id = cmd.id === undefined ? mint(board, type.prefix) : claim(board, type, cmd.id);
  const { col, lane } = placeNew(board, format, cmd);
  const events: BoardEvent[] = [
    {
      event: "ElementAdded",
      board: board.id,
      id,
      type: type.id,
      label: cmd.label,
      col,
      lane,
      detail: cmd.detail,
    },
  ];
  if (cmd.from)
    events.push({ event: "EdgeAdded", board: board.id, src: cmd.from, dst: id, label: cmd.edgeLabel });
  return { events, minted: id };
}

function placeNew(
  board: Board,
  format: Format,
  cmd: { col?: number; lane?: string },
): { col: number; lane: string } {
  switch (format.layout) {
    case "timeline":
      refuse(cmd.lane, "lane", format, "elements are placed by column");
      return { col: cmd.col ?? lastColumn(board) + 1, lane: "" };
    case "columns":
      refuse(cmd.col, "col", format, "elements are placed by lane");
      return { col: 1, lane: requireLane(format, cmd.lane ?? format.lanes[0]?.id ?? "") };
    case "graph":
      refuse(cmd.col, "col", format, "positions follow the links");
      refuse(cmd.lane, "lane", format, "positions follow the links");
      return { col: 1, lane: "" };
  }
}

function move(board: Board, format: Format, cmd: Extract<Command, { kind: "move" }>): BoardEvent {
  const el = requireElement(board, cmd.id);
  switch (format.layout) {
    case "timeline":
      refuse(cmd.lane, "lane", format, "elements move between columns");
      refuse(cmd.before, "before", format, "elements move between columns");
      if (cmd.col === undefined) throw new CommandError(`moving ${el.id} needs a column`);
      return { event: "ElementMoved", board: board.id, id: el.id, col: cmd.col, lane: el.lane };
    case "columns": {
      refuse(cmd.col, "col", format, "elements move between lanes");
      const lane = requireLane(format, cmd.lane ?? el.lane);
      if (cmd.before !== undefined) {
        const anchor = requireElement(board, cmd.before);
        if (anchor.id === el.id) throw new CommandError(`${el.id} cannot be placed before itself`);
        if (anchor.lane !== lane) throw new CommandError(`${anchor.id} is not in lane "${lane}"`);
      }
      return { event: "ElementMoved", board: board.id, id: el.id, col: el.col, lane, before: cmd.before };
    }
    case "graph":
      throw new CommandError(
        `${format.name.en} boards place elements from their links; link or unlink instead`,
      );
  }
}

function refuse(value: unknown, field: string, format: Format, why: string): void {
  if (value !== undefined) throw new CommandError(`${format.name.en} boards take no \`${field}\`: ${why}`);
}

function requireFormat(id: string): Format {
  const format = findFormat(id);
  if (!format) throw new CommandError(`unknown format "${id}"`);
  return format;
}

function requireElement(board: Board, id: string): Element {
  const el = findElement(board, id);
  if (!el) throw new CommandError(`no element ${id} on "${board.id}"`);
  return el;
}

function requireNote(board: Board, id: string): Note {
  const note = board.notes.find((n) => n.id === id);
  if (!note) throw new CommandError(`no note ${id} on "${board.id}"`);
  return note;
}

function requireLane(format: Format, lane: string): string {
  if (!format.lanes.some((l) => l.id === lane)) {
    throw new CommandError(
      `${format.name.en} has no lane "${lane}" (lanes: ${format.lanes.map((l) => l.id).join(", ")})`,
    );
  }
  return lane;
}

function mint(board: Board, prefix: string): string {
  return `${prefix}${(board.minted[prefix] ?? 0) + 1}`;
}

/** An id chosen by the caller is accepted only if no element, present or removed, ever had it. */
function claim(board: Board, type: ElementType, id: string): string {
  if (id.charAt(0) !== type.prefix) {
    throw new CommandError(`a ${type.id} id starts with ${type.prefix}, got ${id}`);
  }
  if (findElement(board, id) || board.retired.includes(id)) {
    throw new CommandError(
      `${id} was already used on "${board.id}"; ids are never reused (next: ${mint(board, type.prefix)})`,
    );
  }
  return id;
}

function decideOnSession(ws: Workspace, cmd: SessionCommand, ctx: Context): VicoEvent[] {
  if (!ctx.session) throw new CommandError(`\`${cmd.kind}\` needs a session`);
  const todos = findSession(ws, ctx.session)?.todos ?? [];
  switch (cmd.kind) {
    case "session-start":
      return [{ event: "SessionStarted", cwd: cmd.cwd }];
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
    case "delivered":
      return [{ event: "ChangesDelivered", upTo: cmd.upTo }];
  }
}
