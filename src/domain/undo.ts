/**
 * The way back. While the journal is folded, each board keeps, per author, the
 * gestures that author can still take back, each as the events that say the
 * opposite. Undo and redo append those events; nothing is ever rewritten.
 *
 * The trails are a projection like the rest of the board: replaying the journal
 * rebuilds them, so they survive a restart and a reload.
 */
import type { Actor, BoardEvent, Recorded } from "./events.ts";
import { findFormat, lanesOf } from "./formats.ts";
import type { Board, Element } from "./workspace.ts";

/** How many gestures an author can take back on one board. */
export const UNDO_DEPTH = 50;

/** One gesture, as what would take it back. `seq` is the last event of the gesture. */
export interface Gesture {
  seq: number;
  inverse: BoardEvent[];
  /** What the gesture did, in the words of the CLI: `rename E1 "Paid"`. */
  name: string;
  /** The other author changed what this gesture wrote: taking it back is refused. */
  blocked?: Blocker;
}

/** The change, by another author, that stands in the way of a gesture. */
export interface Blocker {
  seq: number;
  actor: Actor;
  name: string;
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
    case "BoardPurposed":
      return [{ event: "BoardPurposed", board: b, purpose: board.purpose ?? "" }];
    case "LaneNamed":
      return [{ event: "LaneNamed", board: b, lane: e.lane, label: board.lanes[e.lane] ?? "" }];
    case "LaneHinted":
      return [{ event: "LaneHinted", board: b, lane: e.lane, hint: board.hints?.[e.lane] ?? "" }];
    case "AxisNamed":
      return [{ event: "AxisNamed", board: b, axis: e.axis, label: "", ...board.axes?.[e.axis] }];
    case "LaneAdded":
      return [{ event: "LaneRemoved", board: b, lane: e.lane }];
    case "LaneRemoved":
      return [
        {
          event: "LaneAdded",
          board: b,
          lane: e.lane,
          label: board.lanes[e.lane] ?? "",
          before: laneAfter(board, e.lane),
        },
        ...(board.hints?.[e.lane]
          ? [{ event: "LaneHinted" as const, board: b, lane: e.lane, hint: board.hints[e.lane] ?? "" }]
          : []),
      ];
    case "LaneMoved":
      return [{ event: "LaneMoved", board: b, lane: e.lane, before: laneAfter(board, e.lane) }];
    case "SliceAdded":
      return [{ event: "SliceRemoved", board: b, slice: e.slice }];
    case "SliceRemoved": {
      const slices = board.slices ?? [];
      const at = slices.findIndex((s) => s.id === e.slice);
      const slice = slices[at];
      return (
        slice && [
          { event: "SliceAdded", board: b, slice: slice.id, label: slice.label, before: slices[at + 1]?.id },
        ]
      );
    }
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
    case "ElementLabeled":
      return el && [{ event: "ElementUnlabeled", board: b, id: el.id, label: e.label }];
    case "ElementUnlabeled":
      return el && [{ event: "ElementLabeled", board: b, id: el.id, label: e.label }];
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
            ...(el.labels?.length ? { labels: [...el.labels] } : {}),
            ...(el.formerIds?.length ? { formerIds: [...el.formerIds] } : {}),
            by: el.by,
            addedSeq: el.addedSeq,
            before: after(board, el),
            edges: board.edges
              .filter((edge) => edge.src === el.id || edge.dst === el.id)
              .map(({ src, dst, label, by }) => ({ src, dst, label, by })),
          },
        ]
      );
    case "ElementRenumbered":
      return [
        {
          event: "ElementRenumbered",
          board: b,
          id: e.to,
          to: e.id,
          ...(e.type && el ? { type: el.type } : {}),
        },
      ];
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
  // A gesture undone or redone keeps the name of what it first did.
  let name = nameOf(board, e);
  if (answered === undefined) trail.redo.length = 0;
  else {
    const at = from.findLastIndex((gesture) => gesture.seq === answered);
    if (at !== -1) name = from.splice(at, 1)[0]?.name ?? name;
  }
  to.push({ seq: e.seq, inverse, name });
  if (to.length > UNDO_DEPTH) to.shift();
}

/**
 * What the other authors can no longer take back once `e` is applied.
 *
 * The rule: an undo never overwrites someone else's later change. A gesture whose
 * inverse would write where `e` just wrote is marked blocked, by `e`: its
 * author's undo is refused, and says why, rather than skipping it unseen.
 */
export function supersede(board: Board, e: Happened): void {
  const written = writes(e);
  if (written.length === 0) return;
  const overwrites = (gesture: Gesture): boolean =>
    gesture.inverse.some((back) =>
      writes(back).some((mine) => written.some((theirs) => clash(mine, theirs))),
    );
  const blocker: Blocker = { seq: e.seq, actor: e.actor, name: nameOf(board, e) };
  for (const [actor, trail] of Object.entries(board.trails)) {
    if (actor === e.actor) continue;
    for (const gesture of [...trail.undo, ...trail.redo])
      if (!gesture.blocked && overwrites(gesture)) gesture.blocked = blocker;
  }
}

/**
 * The card a gesture's way back would write to, that is no longer on the board:
 * taken back anyway, it would write to nothing. Undefined when all are there.
 */
export function goneFrom(board: Board, gesture: Gesture): string | undefined {
  const there = (id: string): boolean => board.elements.some((el) => el.id === id);
  for (const back of gesture.inverse) {
    if (back.event === "ElementRestored" || back.event === "ElementAdded") continue;
    const ids = "id" in back ? [back.id] : "src" in back ? [back.src, back.dst] : [];
    const gone = ids.find((id) => !there(id));
    if (gone) return gone;
  }
  return undefined;
}

/** The refused gestures leave their author's trail: the next undo takes the one under them. */
export function leaveBehind(
  board: Board,
  actor: Actor,
  way: "undo" | "redo",
  gestures: readonly number[],
): void {
  const trail = board.trails[actor];
  if (trail) trail[way] = trail[way].filter((gesture) => !gestures.includes(gesture.seq));
}

/** What an event did, in the words of the CLI that would do it. */
export function nameOf(board: Board, e: BoardEvent): string {
  const q = (text: string): string => JSON.stringify(text);
  switch (e.event) {
    case "BoardCreated":
      return `board new ${q(e.title)}`;
    case "BoardRetitled":
      return `retitle ${q(e.title)}`;
    case "BoardPurposed":
      return `purpose ${q(e.purpose)}`;
    case "LaneNamed":
      return `lane ${e.lane} ${q(e.label)}`;
    case "LaneHinted":
      return `lane hint ${e.lane} ${q(e.hint)}`;
    case "AxisNamed":
      return `axis ${e.axis} ${q(e.label)}`;
    case "LaneAdded":
      return `lane add ${q(e.label || e.lane)}`;
    case "LaneRemoved":
      return `lane rm ${e.lane}`;
    case "LaneMoved":
      return `lane move ${e.lane}${e.before ? ` --before ${e.before}` : ""}`;
    case "SliceAdded":
      return `slice add ${q(e.label)}`;
    case "SliceRemoved":
      return `slice rm ${e.slice}`;
    case "BoardRemoved":
      return `board rm ${e.board}`;
    case "BoardRestored":
      return `restore board ${e.board}`;
    case "ElementAdded":
      return `add ${e.type} ${q(e.label)} (${e.id})`;
    case "ElementRestored":
      return `restore ${e.id}`;
    case "ElementRenamed":
      return `rename ${e.id} ${q(e.label)}`;
    case "ElementAnnotated":
      return `detail ${e.id}`;
    case "ElementMarked":
      return `${e.done ? "done" : "undone"} ${e.id}`;
    case "ElementLabeled":
      return `label ${e.id} ${q(e.label)}`;
    case "ElementUnlabeled":
      return `unlabel ${e.id} ${q(e.label)}`;
    case "ElementMoved":
      return findFormat(board.format)?.layout === "columns"
        ? `move ${e.id} --lane ${e.lane}`
        : `move ${e.id} --col ${e.col}`;
    case "ElementRemoved":
      return `rm ${e.id}`;
    case "ElementRenumbered":
      return e.type ? `retype ${e.id} ${e.type} ${e.to}` : `renumber ${e.id} ${e.to}`;
    case "ColumnInserted":
      return `insert-col ${e.at}`;
    case "ColumnRemoved":
      return `rm-col ${e.at}`;
    case "ColumnMoved":
      return `move-col ${e.from} ${e.to}`;
    case "EdgeAdded":
      return `link ${e.src} ${e.dst}${e.label ? ` ${q(e.label)}` : ""}`;
    case "EdgeRemoved":
      return `unlink ${e.src} ${e.dst}`;
    default:
      return e.event;
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
    case "BoardPurposed":
      return ["purpose"];
    case "LaneNamed":
      return [`lane:${e.lane}.label`];
    case "LaneHinted":
      return [`lane:${e.lane}.hint`];
    case "AxisNamed":
      return [`axis:${e.axis}`];
    case "LaneAdded":
    case "LaneRemoved":
      return [`lane:${e.lane}.*`];
    case "LaneMoved":
      return [`lane:${e.lane}.place`];
    case "SliceAdded":
    case "SliceRemoved":
      return [`slice:${e.slice}.*`];
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
    case "ElementLabeled":
    case "ElementUnlabeled":
      return [`${e.id}.label:${e.label.toLowerCase()}`];
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

/** The lane that follows `lane` on the board: putting `lane` back before it restores its place. */
function laneAfter(board: Board, lane: string): string | undefined {
  const order = lanesOf(board);
  return order[order.indexOf(lane) + 1];
}

/** The element that follows `el` in stacking order: putting `el` back before it restores its place. */
function after(board: Board, el: Element): string | undefined {
  return board.elements[board.elements.indexOf(el) + 1]?.id;
}
