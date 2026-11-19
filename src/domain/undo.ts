/**
 * The way back. While the journal is folded, each board keeps, per author, the
 * gestures that author can still take back, each as the events that say the
 * opposite. Undo and redo append those events; nothing is ever rewritten.
 *
 * The trails are a projection like the rest of the board: replaying the journal
 * rebuilds them, so they survive a restart and a reload.
 */
import type { Actor, BoardEvent, Recorded } from "./events.ts";
import type { Board, Element } from "./workspace.ts";

/** How many gestures an author can take back on one board. */
export const UNDO_DEPTH = 50;

/** One gesture, as what would take it back. `seq` is the last event of the gesture. */
export interface Gesture {
  seq: number;
  inverse: BoardEvent[];
}

export interface Trail {
  undo: Gesture[];
  redo: Gesture[];
}

export type Trails = Partial<Record<Actor, Trail>>;

type Happened = Extract<Recorded, { board: string }>;

/**
 * The events that take `e` back, read from the board as it stands before `e`.
 * Undefined when `e` is not a gesture on the model: a note, a focus, a hand-over
 * are said, not drawn, and are not taken back.
 */
export function invert(board: Board, e: Happened): BoardEvent[] | undefined {
  const b = board.id;
  const el = "id" in e ? board.elements.find((x) => x.id === e.id) : undefined;
  switch (e.event) {
    case "BoardRetitled":
      return [{ event: "BoardRetitled", board: b, title: board.title }];
    case "LaneNamed":
      return [{ event: "LaneNamed", board: b, lane: e.lane, label: board.lanes[e.lane] ?? "" }];
    case "BoardRemoved":
      return [{ event: "BoardRestored", board: b, title: board.title }];
    case "BoardRestored":
      return [{ event: "BoardRemoved", board: b, title: board.title }];
    case "ElementAdded":
    case "ElementRestored":
      return [{ event: "ElementRemoved", board: b, id: e.id }];
    case "ElementRenamed":
      return el && [{ event: "ElementRenamed", board: b, id: el.id, label: el.label }];
    case "ElementAnnotated":
      return el && [{ event: "ElementAnnotated", board: b, id: el.id, detail: el.detail ?? "" }];
    case "ElementMarked":
      return el && [{ event: "ElementMarked", board: b, id: el.id, done: el.done ?? false }];
    case "ElementMoved":
      return (
        el && [
          {
            event: "ElementMoved",
            board: b,
            id: el.id,
            col: el.col,
            lane: el.lane,
            before: after(board, el),
          },
        ]
      );
    case "ElementRemoved":
      return (
        el && [
          {
            event: "ElementRestored",
            board: b,
            id: el.id,
            type: el.type,
            label: el.label,
            col: el.col,
            lane: el.lane,
            detail: el.detail,
            done: el.done,
            by: el.by,
            addedSeq: el.addedSeq,
            before: after(board, el),
            edges: board.edges
              .filter((edge) => edge.src === el.id || edge.dst === el.id)
              .map(({ src, dst, label, by }) => ({ src, dst, label, by })),
          },
        ]
      );
    case "ColumnInserted":
      return [{ event: "ColumnRemoved", board: b, at: e.at }];
    case "ColumnRemoved":
      return [{ event: "ColumnInserted", board: b, at: e.at }];
    case "ColumnMoved":
      return [{ event: "ColumnMoved", board: b, from: e.to, to: e.from }];
    case "EdgeAdded": {
      const was = board.edges.find((edge) => edge.src === e.src && edge.dst === e.dst);
      return was
        ? [{ event: "EdgeAdded", board: b, src: was.src, dst: was.dst, label: was.label, by: was.by }]
        : [{ event: "EdgeRemoved", board: b, src: e.src, dst: e.dst }];
    }
    case "EdgeRemoved": {
      const was = board.edges.find((edge) => edge.src === e.src && edge.dst === e.dst);
      return (
        was && [{ event: "EdgeAdded", board: b, src: was.src, dst: was.dst, label: was.label, by: was.by }]
      );
    }
    default:
      return undefined;
  }
}

/** Files what would take `e` back on its author's trail. Call it once `e` is applied. */
export function remember(board: Board, e: Happened, inverse: BoardEvent[]): void {
  const trail = board.trails[e.actor] ?? { undo: [], redo: [] };
  board.trails[e.actor] = trail;
  // An undo moves a gesture from `undo` to `redo`; a redo moves it back; a new gesture closes the way forward.
  const [from, to] = e.undoes !== undefined ? [trail.undo, trail.redo] : [trail.redo, trail.undo];
  const answered = e.undoes ?? e.redoes;

  const open = to.at(-1);
  if (e.joined && open?.seq === e.seq - 1) {
    open.seq = e.seq;
    open.inverse.unshift(...inverse);
    return;
  }
  if (answered === undefined) trail.redo.length = 0;
  else {
    const at = from.findLastIndex((gesture) => gesture.seq === answered);
    if (at !== -1) from.splice(at, 1);
  }
  to.push({ seq: e.seq, inverse });
  if (to.length > UNDO_DEPTH) to.shift();
}

/**
 * What the other authors can no longer take back once `e` is applied.
 *
 * The rule: an undo never overwrites someone else's later change. A gesture whose
 * inverse would write where `e` just wrote leaves its author's trail.
 */
export function supersede(board: Board, e: Happened): void {
  const written = writes(e);
  if (written.length === 0) return;
  const overwrites = (gesture: Gesture): boolean =>
    gesture.inverse.some((back) =>
      writes(back).some((mine) => written.some((theirs) => clash(mine, theirs))),
    );
  for (const [actor, trail] of Object.entries(board.trails)) {
    if (actor === e.actor) continue;
    trail.undo = trail.undo.filter((gesture) => !overwrites(gesture));
    trail.redo = trail.redo.filter((gesture) => !overwrites(gesture));
  }
}

/** Columns renumbered, by an insertion or a move: the places the trails remember follow them. */
export function remapColumns(board: Board, renumber: (col: number) => number): void {
  for (const trail of Object.values(board.trails)) {
    for (const gesture of [...trail.undo, ...trail.redo]) {
      for (const back of gesture.inverse) if ("col" in back) back.col = renumber(back.col);
    }
  }
}

/** What an event writes: a property of an element (`E1.label`), all of it (`E1.*`), a link, the title, the order of the columns. */
function writes(e: BoardEvent): string[] {
  switch (e.event) {
    case "BoardRetitled":
      return ["title"];
    case "LaneNamed":
      return [`lane:${e.lane}`];
    case "ColumnInserted":
    case "ColumnRemoved":
    case "ColumnMoved":
      return ["columns"];
    case "ElementRenamed":
      return [`${e.id}.label`];
    case "ElementAnnotated":
      return [`${e.id}.detail`];
    case "ElementMarked":
      return [`${e.id}.done`];
    case "ElementMoved":
      return [`${e.id}.place`];
    case "ElementRemoved":
      return [`${e.id}.*`];
    case "EdgeAdded":
    case "EdgeRemoved":
      return [`${e.src}>${e.dst}`];
    default:
      return [];
  }
}

function clash(mine: string, theirs: string): boolean {
  if (mine === theirs) return true;
  const [a, b] = [mine, theirs].map((key) => key.split("."));
  if (a?.length === 2 && b?.length === 2) return a[0] === b[0] && (a[1] === "*" || b[1] === "*");
  // A removed element takes its links along: a link is written by whatever removes one of its ends.
  const [whole, link] = theirs.endsWith(".*") ? [theirs, mine] : [mine, theirs];
  return whole.endsWith(".*") && link.split(">").includes(whole.slice(0, -2));
}

/** The element that follows `el` in stacking order: putting `el` back before it restores its place. */
function after(board: Board, el: Element): string | undefined {
  return board.elements[board.elements.indexOf(el) + 1]?.id;
}
