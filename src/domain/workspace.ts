/**
 * The projection: a workspace is what you get by folding the journal.
 *
 * `apply` mutates the workspace it is given and trusts its input: an event in the
 * journal already passed `decide`. `replay` is the pure entry point, and the only
 * way to get a workspace for a past moment.
 */
import { columnAfterMove } from "./columns.ts";
import type { Recorded } from "./events.ts";
import { LANE_PREFIX, lanesOf, SLICE_PREFIX } from "./formats.ts";
import { handledAll } from "./handled-all.ts";
import { applyToProject } from "./label-colour.ts";
import { hasLabel, sameLabel } from "./labels.ts";
import { remember } from "./minting.ts";
import type { Board, Element, Workspace } from "./model.ts";
import { renumber } from "./renumber.ts";
import { applyToSession, follow, type Session, type SessionRecorded } from "./sessions.ts";
import { threadOf } from "./threads.ts";
import { invert, leaveBehind, remapColumns, remember as rememberGesture, supersede } from "./undo.ts";

export type { Axis, Board, Edge, Element, Note, Slice, Thread, Turn, Workspace } from "./model.ts";

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

export function apply(ws: Workspace, e: Recorded): void {
  ws.seq = e.seq;
  if ("board" in e) {
    applyToBoard(ws, e);
    // Writing on a board is following it.
    if (e.session && e.actor === "agent") follow(ws, e.session, [e.board]);
  } else if (e.event === "LabelColoured") applyToProject(ws, e);
  else if (e.session) applyToSession(ws, e as SessionRecorded);
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
    case "ElementPlaced":
      touch(board, e.id, e.seq, (el) => {
        if (e.at) el.at = { ...e.at };
        else delete el.at;
      });
      break;
    case "BoardPlacing":
      if (e.byHand) board.byHand = true;
      else delete board.byHand;
      break;
    case "ElementRemoved":
      if (findElement(board, e.id)) board.retired.push(e.id);
      board.elements = board.elements.filter((el) => el.id !== e.id);
      board.edges = board.edges.filter((edge) => edge.src !== e.id && edge.dst !== e.id);
      if (board.focus) {
        const ids = board.focus.ids.filter((id) => id !== e.id);
        board.focus = ids.length > 0 ? { ...board.focus, ids } : null;
      }
      break;
    case "ElementRenumbered":
      renumber(board, e);
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
        ...(e.formerIds?.length ? { formerIds: [...e.formerIds] } : {}),
        col: e.col,
        lane: e.lane,
        ...(e.at ? { at: { ...e.at } } : {}),
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
