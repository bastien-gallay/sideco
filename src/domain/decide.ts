/**
 * Commands become events here, or are refused. `decide` reads the workspace and
 * never changes it; every rule about what a board may contain starts in this file,
 * and where a card goes is read from placement.ts.
 */
import { place, placeAdded, placing } from "./by-hand.ts";
import { columnAfterMove, lastColumn } from "./columns.ts";
import { type Command, CommandError } from "./commands.ts";
import type { Actor, BoardEvent, SidecoEvent } from "./events.ts";
import { type Format, findType, LANE_PREFIX, lanesOf, NOTE_PREFIX, SLICE_PREFIX } from "./formats.ts";
import {
  noBoard,
  requireElement,
  requireFormat,
  requireLane,
  requireNote,
  requireOwnLanes,
  requireSlice,
  requireSliced,
} from "./guards.ts";
import { hasLabel, normalLabel, sameLabel } from "./labels.ts";
import { claim, mint } from "./minting.ts";
import { besideIn, move, placeNew, stays } from "./placement.ts";
import { relink } from "./relink.ts";
import { renumbering } from "./renumber.ts";
import { reverse } from "./reverse.ts";
import { decideOnSession } from "./session-decide.ts";
import { addressee } from "./sessions.ts";
import { threadOf } from "./threads.ts";
import { type Board, findBoard, findSession, type Workspace } from "./workspace.ts";

export interface Context {
  actor: Actor;
  session?: string;
}

export interface Decision {
  events: SidecoEvent[];
  /** The id given to the element or note this command created, if any. */
  minted?: string;
  /**
   * The command is refused, and why; its events are still recorded. An undo
   * blocked by the other author's change says so, and the blocked gestures leave
   * the trail, so that the next undo takes the one under them.
   */
  refused?: string;
}

/** A command that asks for what already is: accepted, and nothing is recorded. */
const unchanged = (): { events: never[] } => ({ events: [] });

type BoardCommand = Extract<Command, { board: string }>;

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
  refused?: string;
}

function decideOnBoard(ws: Workspace, cmd: BoardCommand, ctx: Context): BoardDecision {
  if (cmd.kind === "undo" || cmd.kind === "redo") {
    const live = findBoard(ws, cmd.board);
    const board = live ?? ws.removed.find((b) => b.id === cmd.board);
    if (!board) throw noBoard(ws, cmd.board);
    return reverse(board, live !== undefined, cmd, ctx.actor);
  }
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
    case "purpose":
      if ((board.purpose ?? "") === cmd.purpose) return unchanged();
      return { events: [{ event: "BoardPurposed", board: b, purpose: cmd.purpose }] };
    case "retitle":
      if (board.title === cmd.title) return unchanged();
      return { events: [{ event: "BoardRetitled", board: b, title: cmd.title }] };
    case "name-lane": {
      if (format.layout !== "columns")
        throw new CommandError(`${format.name.en} boards have no lanes to name`);
      const lane = requireLane(board, format, cmd.lane);
      if ((board.lanes[lane] ?? "") === cmd.label) return unchanged();
      return { events: [{ event: "LaneNamed", board: b, lane, label: cmd.label }] };
    }
    case "hint-lane": {
      if (format.layout !== "columns") throw new CommandError(`${format.name.en} boards have no lanes`);
      const lane = requireLane(board, format, cmd.lane);
      if ((board.hints?.[lane] ?? "") === cmd.hint) return unchanged();
      return { events: [{ event: "LaneHinted", board: b, lane, hint: cmd.hint }] };
    }
    case "name-axis": {
      if (!format.grid) throw new CommandError(`${format.name.en} boards have no axes`);
      if (cmd.axis !== "x" && cmd.axis !== "y") throw new CommandError(`no axis "${cmd.axis}": x or y`);
      const was = board.axes?.[cmd.axis];
      const low = cmd.label ? (cmd.low ?? was?.low) : undefined;
      const high = cmd.label ? (cmd.high ?? was?.high) : undefined;
      if ((was?.label ?? "") === cmd.label && was?.low === low && was?.high === high) return unchanged();
      return {
        events: [
          {
            event: "AxisNamed",
            board: b,
            axis: cmd.axis,
            label: cmd.label,
            ...(low ? { low } : {}),
            ...(high ? { high } : {}),
          },
        ],
      };
    }
    case "add-lane": {
      requireOwnLanes(format, "add");
      if (cmd.before !== undefined) requireLane(board, format, cmd.before);
      const lane = cmd.lane ?? `${LANE_PREFIX}${(board.minted[LANE_PREFIX] ?? 0) + 1}`;
      if (lanesOf(board).includes(lane)) throw new CommandError(`lane ${lane} is already on "${b}"`);
      return {
        events: [{ event: "LaneAdded", board: b, lane, label: cmd.label, before: cmd.before }],
        minted: lane,
      };
    }
    case "add-slice": {
      requireSliced(format);
      if (cmd.before !== undefined) requireSlice(board, cmd.before);
      const slice = cmd.slice ?? `${SLICE_PREFIX}${(board.minted[SLICE_PREFIX] ?? 0) + 1}`;
      if ((board.slices ?? []).some((s) => s.id === slice))
        throw new CommandError(`slice ${slice} is already on "${b}"`);
      return {
        events: [{ event: "SliceAdded", board: b, slice, label: cmd.label, before: cmd.before }],
        minted: slice,
      };
    }
    case "remove-slice": {
      requireSliced(format);
      const slice = requireSlice(board, cmd.slice);
      return { events: [{ event: "SliceRemoved", board: b, slice }] };
    }
    case "remove-lane": {
      requireOwnLanes(format, "remove");
      const lane = requireLane(board, format, cmd.lane);
      const inside = board.elements.filter((el) => el.lane === lane).map((el) => el.id);
      if (inside.length > 0)
        throw new CommandError(
          `lane ${lane} still has ${inside.length} card${inside.length > 1 ? "s" : ""} (${inside.join(", ")}): move or remove them first`,
        );
      if (lanesOf(board).length === 1)
        throw new CommandError(`a ${format.name.en.toLowerCase()} keeps at least one lane`);
      return { events: [{ event: "LaneRemoved", board: b, lane }] };
    }
    case "move-lane": {
      requireOwnLanes(format, "move");
      const lane = requireLane(board, format, cmd.lane);
      if (cmd.before !== undefined) {
        requireLane(board, format, cmd.before);
        if (cmd.before === lane) throw new CommandError(`lane ${lane} cannot be placed before itself`);
      }
      const order = lanesOf(board);
      const next = order[order.indexOf(lane) + 1];
      if (next === cmd.before) return unchanged();
      return { events: [{ event: "LaneMoved", board: b, lane, before: cmd.before }] };
    }
    case "remove-board":
      return { events: [{ event: "BoardRemoved", board: b, title: board.title }] };
    case "add":
      return add(ws, board, format, cmd);
    case "rename":
      if (requireElement(board, cmd.id).label === cmd.label) return unchanged();
      return { events: [{ event: "ElementRenamed", board: b, id: cmd.id, label: cmd.label }] };
    case "label": {
      const el = requireElement(board, cmd.id);
      const kept: string[] = [];
      for (const raw of cmd.labels) {
        const label = normalLabel(raw);
        if (label && !hasLabel(el, label) && !kept.some((other) => sameLabel(other, label))) kept.push(label);
      }
      if (kept.length === 0) return unchanged();
      return { events: kept.map((label) => ({ event: "ElementLabeled", board: b, id: el.id, label })) };
    }
    case "unlabel": {
      const el = requireElement(board, cmd.id);
      const gone: string[] = [];
      for (const raw of cmd.labels) {
        const label = normalLabel(raw);
        const own = el.labels?.find((other) => sameLabel(other, label));
        if (!own) throw new CommandError(`${el.id} has no label ${label}`);
        if (!gone.includes(own)) gone.push(own);
      }
      return { events: gone.map((label) => ({ event: "ElementUnlabeled", board: b, id: el.id, label })) };
    }
    case "annotate":
      if ((requireElement(board, cmd.id).detail ?? "") === cmd.detail) return unchanged();
      return { events: [{ event: "ElementAnnotated", board: b, id: cmd.id, detail: cmd.detail }] };
    case "mark": {
      const el = requireElement(board, cmd.id);
      if (format.doneLast) {
        // Done is the last lane: the card goes there, or back to the lane before it.
        const lanes = lanesOf(board);
        const to = cmd.done ? lanes.at(-1) : el.lane === lanes.at(-1) ? lanes.at(-2) : undefined;
        if (to === undefined || to === el.lane) return unchanged();
        return { events: [{ event: "ElementMoved", board: b, id: el.id, col: el.col, lane: to }] };
      }
      if ((el.done ?? false) === cmd.done) return unchanged();
      return { events: [{ event: "ElementMarked", board: b, id: cmd.id, done: cmd.done }] };
    }
    case "place":
      return { events: place(board, format, cmd) };
    case "placing":
      return { events: placing(board, format, cmd) };
    case "move": {
      const moved = move(board, format, cmd);
      return stays(board, format, moved) ? unchanged() : { events: [moved] };
    }
    case "remove":
      requireElement(board, cmd.id);
      return { events: [{ event: "ElementRemoved", board: b, id: cmd.id }] };
    case "renumber":
      return renumbering(ws, board, format, cmd);
    case "insert-column":
      if (format.layout !== "timeline")
        throw new CommandError(`${format.name.en} boards have no columns to insert`);
      return { events: [{ event: "ColumnInserted", board: b, at: cmd.at }] };
    case "remove-column": {
      if (format.layout !== "timeline")
        throw new CommandError(`${format.name.en} boards have no columns to remove`);
      const last = lastColumn(board);
      if (cmd.at > last) throw new CommandError(`no column ${cmd.at}: the last one is ${last}`);
      const held = board.elements.filter((el) => el.col === cmd.at).map((el) => el.id);
      if (held.length > 0)
        throw new CommandError(`column ${cmd.at} holds ${held.join(", ")}: move or remove them first`);
      return { events: [{ event: "ColumnRemoved", board: b, at: cmd.at }] };
    }
    case "move-column": {
      if (format.layout !== "timeline")
        throw new CommandError(`${format.name.en} boards have no columns to move`);
      const last = lastColumn(board);
      for (const col of [cmd.from, cmd.to])
        if (col > last) throw new CommandError(`no column ${col}: the last one is ${last}`);
      if (board.elements.every((el) => columnAfterMove(el.col, cmd.from, cmd.to) === el.col))
        return unchanged();
      return { events: [{ event: "ColumnMoved", board: b, from: cmd.from, to: cmd.to }] };
    }
    case "link":
      requireElement(board, cmd.src);
      requireElement(board, cmd.dst);
      if (cmd.src === cmd.dst) throw new CommandError(`${cmd.src} cannot link to itself`);
      if (board.edges.some((e) => e.src === cmd.src && e.dst === cmd.dst && e.label === cmd.label))
        return unchanged();
      return { events: [{ event: "EdgeAdded", board: b, src: cmd.src, dst: cmd.dst, label: cmd.label }] };
    case "unlink":
      if (!board.edges.some((e) => e.src === cmd.src && e.dst === cmd.dst)) {
        throw new CommandError(`no link ${cmd.src} → ${cmd.dst} on "${b}"`);
      }
      return { events: [{ event: "EdgeRemoved", board: b, src: cmd.src, dst: cmd.dst }] };
    case "reverse": {
      const link = board.edges.find((e) => e.src === cmd.src && e.dst === cmd.dst);
      if (!link) throw new CommandError(`no link ${cmd.src} → ${cmd.dst} on "${b}"`);
      if (board.edges.some((e) => e.src === cmd.dst && e.dst === cmd.src))
        throw new CommandError(`${cmd.dst} already links to ${cmd.src}`);
      // Taken off, then laid the other way round: one gesture, one undo.
      return {
        events: [
          { event: "EdgeRemoved", board: b, src: cmd.src, dst: cmd.dst },
          { event: "EdgeAdded", board: b, src: cmd.dst, dst: cmd.src, label: link.label },
        ],
      };
    }
    case "relink":
      return relink(board, cmd);
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
      const id = mint(ws, NOTE_PREFIX);
      return {
        events: [{ event: "NoteAdded", board: b, id, text: cmd.text, target: cmd.target }],
        minted: id,
      };
    }
    case "reply": {
      const note = requireNote(board, cmd.to);
      if (note.resolved) throw new CommandError(`note ${threadOf(note)} is resolved: open a new note`);
      const id = mint(ws, NOTE_PREFIX);
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
    case "pass": {
      if (cmd.to === "human")
        return { events: [{ event: "TurnPassed", board: b, to: cmd.to, message: cmd.message }] };
      if (cmd.target !== undefined && !findSession(ws, cmd.target))
        throw new CommandError(`no session "${cmd.target}" in this project`);
      const target = cmd.target ?? addressee(ws, b)?.id;
      return {
        events: [
          { event: "TurnPassed", board: b, to: cmd.to, message: cmd.message, ...(target ? { target } : {}) },
        ],
      };
    }
  }
}

function add(ws: Workspace, board: Board, format: Format, cmd: BoardCommand & { kind: "add" }) {
  const type = findType(format, cmd.type);
  if (!type) {
    const allowed = format.types.map((t) => t.id).join(", ");
    throw new CommandError(`${format.name.en} has no "${cmd.type}" (types: ${allowed})`);
  }
  if (cmd.from) requireElement(board, cmd.from);
  const id = cmd.id === undefined ? mint(ws, type.prefix) : claim(ws, type, cmd.id, format);
  const anchor = cmd.before === undefined ? undefined : requireElement(board, cmd.before);
  const { col, lane } = placeNew(board, format, type, {
    col: cmd.col ?? (format.layout === "timeline" ? anchor?.col : undefined),
    lane: cmd.lane ?? (format.layout === "columns" ? anchor?.lane : undefined),
  });
  if (anchor) besideIn(format, anchor, { type: type.id, col, lane });
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
  // Added last in its cell, then put in its place: one gesture, one undo.
  if (anchor) events.push({ event: "ElementMoved", board: board.id, id, col, lane, before: anchor.id });
  if (cmd.from)
    events.push({ event: "EdgeAdded", board: board.id, src: cmd.from, dst: id, label: cmd.edgeLabel });
  // By hand, the new card takes a place of its own: only its kind and its words, which size it, matter here.
  const added = {
    id,
    type: type.id,
    label: cmd.label,
    col,
    lane,
    by: "agent",
    addedSeq: 0,
    changedSeq: 0,
  } as const;
  const placed = placeAdded(board, added, cmd.from);
  if (placed) events.push(placed);
  return { events, minted: id };
}
