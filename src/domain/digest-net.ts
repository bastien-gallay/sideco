/**
 * What one actor changed in a span of the journal, net of back-and-forth, not
 * worded yet (out of digest.ts, T173): an element renamed twice is one change;
 * one added then removed is none; a gesture and the undo that takes it back are
 * none either. The journal is read once, each event told by the few lines that
 * know it; digest.ts words what is left.
 */
import { cancelledOut } from "./cancelled.ts";
import type { Actor, Point, Recorded } from "./events.ts";
import {
  apply,
  type Board,
  type Element,
  emptyWorkspace,
  findBoard,
  findElement,
  type Workspace,
} from "./workspace.ts";

/** One thing to tell, as data: netted while the journal is read, worded once it is read. */
export type Change =
  | { kind: "board-created"; title: string; format: string }
  | { kind: "board-retitled"; title: string }
  | { kind: "board-purposed"; purpose: string }
  | { kind: "lane-named"; lane: string; label: string }
  | { kind: "lane-hinted"; lane: string; hint: string }
  | { kind: "axis-named"; axis: "x" | "y"; label: string; low?: string; high?: string }
  | { kind: "lane-added"; lane: string; label: string; before?: string }
  | { kind: "slice-added"; slice: string; label: string; before?: string }
  | { kind: "slice-removed"; slice: string }
  | { kind: "lane-removed"; lane: string }
  | { kind: "lane-moved"; lane: string; before?: string }
  | { kind: "board-removed" }
  | { kind: "board-restored" }
  | { kind: "added"; id: string; type: string; label: string; col: number; lane: string; restored?: true }
  | { kind: "renamed"; id: string; from: string; to: string }
  /** Judged at the end, against the final board: a later change can put the card back. */
  | { kind: "moved"; id: string; from: Origin }
  | { kind: "placed"; id: string; at: Point }
  | { kind: "placing"; byHand: boolean }
  | { kind: "annotated"; id: string; detail: string }
  | { kind: "labeled"; id: string; label: string; on: boolean }
  | { kind: "marked"; id: string; done: boolean }
  | { kind: "removed"; id: string; type: string; label: string }
  | { kind: "renumbered"; id: string; to: string; type?: string }
  | { kind: "column-inserted"; at: number }
  | { kind: "column-removed"; at: number }
  | { kind: "column-moved"; from: number; to: number }
  | { kind: "linked"; src: string; dst: string; label?: string }
  | { kind: "unlinked"; src: string; dst: string }
  | { kind: "focused"; ids: string[]; reason?: string }
  | { kind: "noted"; id: string; text: string; target?: string; thread?: string }
  | { kind: "resolved"; id: string }
  | { kind: "passed"; message?: string }; // a hand-over, shelved with its board like any change

export type Added = Extract<Change, { kind: "added" }>;

export interface Entry {
  board: string;
  change: Change;
}

/** Where an element was, and what it said, when the reader last saw it. */
export interface Origin {
  label: string;
  col: number;
  lane: string;
  /** The element that followed it in its lane; position in a lane is meaning (priority). */
  next: string | undefined;
}

/** What one actor changed in a span of the journal, net of back-and-forth, not worded yet. */
export interface Net {
  /** The workspace at the end of the journal: the changes are worded against it. */
  ws: Workspace;
  entries: Entry[];
  /** Boards the reader knew that the actor removed, with the title they had. */
  gone: ReadonlyMap<string, string>;
  passed: boolean;
  /** Every word said while handing over, once each: a later hand-over does not erase an earlier word. */
  words: string[];
}

interface Shelf {
  entries: [string, Entry][];
  origin: [string, Origin][];
  added: string[];
  made: boolean;
}

/** What is pending for the reader while the journal is read. */
interface Pending {
  entries: Map<string, Entry>;
  /** Per thread, the replies told in this span. */
  replies: Map<string, string[]>;
  added: Set<string>;
  origin: Map<string, Origin>;
  /** Boards the actor made in this window: removing one of those is no news. */
  made: Set<string>;
  gone: Map<string, string>;
  /** Boards that were already removed when the reader last looked. */
  absent: Set<string>;
  /** What was pending about a removed board, kept for the case it comes back. */
  shelved: Map<string, Shelf>;
}

/** Removes and returns what `map` holds about a board: every key starts with the board's id. */
function take<V>(map: Map<string, V>, board: string): [string, V][] {
  const taken = [...map].filter(([key]) => key.startsWith(`${board}/`));
  for (const [key] of taken) map.delete(key);
  return taken;
}

/** A removed board takes every pending change about it along, whoever removed it. */
function shelve(p: Pending, board: string): void {
  const mine = [...p.added].filter((key) => key.startsWith(`${board}/`));
  for (const key of mine) p.added.delete(key);
  p.shelved.set(board, {
    entries: take(p.entries, board),
    origin: take(p.origin, board),
    added: mine,
    made: p.made.delete(board),
  });
}

/** A restored board is back with what was pending about it. */
function unshelve(p: Pending, board: string): void {
  const shelf = p.shelved.get(board);
  if (!shelf) return;
  p.shelved.delete(board);
  for (const [key, entry] of shelf.entries) p.entries.set(key, entry);
  for (const [key, first] of shelf.origin) p.origin.set(key, first);
  for (const key of shelf.added) p.added.add(key);
  if (shelf.made) p.made.add(board);
}

/** How an event stands for the reader: cancelled by its undo, the actor's own news, or known already. */
interface Standing {
  quiet: boolean;
  mine: boolean;
  known: boolean;
}

function boardRemoved(p: Pending, e: Extract<Recorded, { event: "BoardRemoved" }>, at: Standing): void {
  // A removal and its undo that cancel out: what was pending is put away, then back, as it was.
  if (at.quiet) {
    shelve(p, e.board);
    return;
  }
  if (at.known) p.absent.add(e.board);
  // Restored and removed again since the reader looked: for them, it never came back.
  const news = !p.entries.delete(`${e.board}/restored/`) && !p.made.has(e.board);
  shelve(p, e.board);
  if (at.mine && news) p.gone.set(e.board, e.title);
  if (p.gone.has(e.board))
    p.entries.set(`${e.board}/removed/`, { board: e.board, change: { kind: "board-removed" } });
}

function boardRestored(p: Pending, e: Extract<Recorded, { event: "BoardRestored" }>, at: Standing): void {
  if (at.quiet) {
    unshelve(p, e.board);
    return;
  }
  if (at.known) p.absent.delete(e.board);
  unshelve(p, e.board);
  p.entries.delete(`${e.board}/removed/`);
  p.gone.delete(e.board);
  if (at.mine && p.absent.has(e.board))
    p.entries.set(`${e.board}/restored/`, { board: e.board, change: { kind: "board-restored" } });
}

/** An event being told: what is pending, the board and the element as they were before it. */
interface Telling extends Pending {
  board: Board | undefined;
  el: Element | undefined;
  /** The key of what is pending of one kind about one thing of this board. */
  k(kind: string, id: string): string;
  put(kind: string, id: string, change: Change): void;
}

type On<K extends Recorded["event"]> = (c: Telling, e: Extract<Recorded, { event: K }>) => void;

/** What each event of a board gives the reader to be told, or takes back from what was pending. */
const TELL: { [K in Recorded["event"]]?: On<K> } = {
  BoardCreated: (c, e) => {
    c.made.add(e.board);
    c.put("board", "", { kind: "board-created", title: e.title, format: e.format });
  },
  BoardRetitled: (c, e) => c.put("title", "", { kind: "board-retitled", title: e.title }),
  BoardPurposed: (c, e) => c.put("purpose", "", { kind: "board-purposed", purpose: e.purpose }),
  LaneNamed: (c, e) => c.put("lane", e.lane, { kind: "lane-named", lane: e.lane, label: e.label }),
  LaneHinted: (c, e) => c.put("lane-hint", e.lane, { kind: "lane-hinted", lane: e.lane, hint: e.hint }),
  AxisNamed: (c, e) =>
    c.put("axis", e.axis, { kind: "axis-named", axis: e.axis, label: e.label, low: e.low, high: e.high }),
  LaneAdded: (c, e) =>
    c.put("lane-edit", e.lane, { kind: "lane-added", lane: e.lane, label: e.label, before: e.before }),
  LaneRemoved: (c, e) => {
    // Added and removed since the reader looked: no news.
    if (c.entries.get(c.k("lane-edit", e.lane))?.change.kind !== "lane-added") {
      c.put("lane-edit", e.lane, { kind: "lane-removed", lane: e.lane });
      return;
    }
    for (const kind of ["lane-edit", "lane", "lane-hint", "lane-place"]) c.entries.delete(c.k(kind, e.lane));
  },
  SliceAdded: (c, e) =>
    c.put("slice", e.slice, { kind: "slice-added", slice: e.slice, label: e.label, before: e.before }),
  SliceRemoved: (c, e) => {
    // Added and removed since the reader looked: no news.
    if (c.entries.get(c.k("slice", e.slice))?.change.kind === "slice-added")
      c.entries.delete(c.k("slice", e.slice));
    else c.put("slice", e.slice, { kind: "slice-removed", slice: e.slice });
  },
  LaneMoved: (c, e) => c.put("lane-place", e.lane, { kind: "lane-moved", lane: e.lane, before: e.before }),
  ElementAdded: (c, e) => {
    c.added.add(c.k("el", e.id));
    c.put("add", e.id, asAdded(e));
  },
  ElementRenamed: (c, e) => {
    if (!c.el) return;
    if (c.added.has(c.k("el", e.id))) {
      c.put("add", e.id, { ...asAdded(c.el), label: e.label });
      return;
    }
    const from = remember(c.origin, c.k("el", e.id), c.board, c.el);
    if (from.label === e.label) c.entries.delete(c.k("rename", e.id));
    else c.put("rename", e.id, { kind: "renamed", id: e.id, from: from.label, to: e.label });
  },
  ElementMoved: (c, e) => {
    if (!c.el) return;
    if (c.added.has(c.k("el", e.id))) {
      c.put("add", e.id, { ...asAdded(c.el), col: e.col, lane: e.lane });
      return;
    }
    // The first move keeps its place among the changes, and where the card was then.
    const from = remember(c.origin, c.k("el", e.id), c.board, c.el);
    if (!c.entries.has(c.k("move", e.id))) c.put("move", e.id, { kind: "moved", id: e.id, from });
  },
  ElementPlaced: (c, e) => {
    // Where the links drew a card, kept as the diagram went by hand: nobody moved it.
    if (e.at && !e.drawn) c.put("place", e.id, { kind: "placed", id: e.id, at: e.at });
  },
  BoardPlacing: (c, e) => c.put("placing", "", { kind: "placing", byHand: e.byHand }),
  ElementAnnotated: (c, e) => c.put("detail", e.id, { kind: "annotated", id: e.id, detail: e.detail }),
  ElementLabeled: (c, e) => labeled(c, e.id, e.label, true),
  ElementUnlabeled: (c, e) => labeled(c, e.id, e.label, false),
  ElementMarked: (c, e) => {
    // Marked and cleared since the reader looked, or the reverse: no news.
    if (!c.entries.delete(c.k("done", e.id))) c.put("done", e.id, { kind: "marked", id: e.id, done: e.done });
  },
  ElementRemoved: (c, e) => {
    for (const kind of ["add", "rename", "move", "place", "detail", "done"])
      c.entries.delete(c.k(kind, e.id));
    for (const key of [...c.entries.keys()])
      if (key.startsWith(c.k("label", `${e.id}/`))) c.entries.delete(key);
    if (c.added.delete(c.k("el", e.id)) || c.entries.delete(c.k("restore", e.id))) return;
    if (c.el) c.put("remove", e.id, { kind: "removed", id: e.id, type: c.el.type, label: c.el.label });
  },
  ElementRenumbered: (c, e) =>
    c.put("renumber", e.id, { kind: "renumbered", id: e.id, to: e.to, type: e.type }),
  ElementRestored: (c, e) => {
    // Removed and restored since the reader looked: no news. Otherwise it is back, and they are told where.
    if (!c.entries.delete(c.k("remove", e.id))) c.put("restore", e.id, { ...asAdded(e), restored: true });
  },
  ColumnInserted: (c, e) => c.put("column", String(e.seq), { kind: "column-inserted", at: e.at }),
  ColumnRemoved: (c, e) => c.put("column", String(e.seq), { kind: "column-removed", at: e.at }),
  ColumnMoved: (c, e) => c.put("column", String(e.seq), { kind: "column-moved", from: e.from, to: e.to }),
  EdgeAdded: (c, e) => {
    c.entries.delete(c.k("unlink", `${e.src}>${e.dst}`));
    c.put("link", `${e.src}>${e.dst}`, { kind: "linked", src: e.src, dst: e.dst, label: e.label });
  },
  EdgeRemoved: (c, e) => {
    if (!c.entries.delete(c.k("link", `${e.src}>${e.dst}`)))
      c.put("unlink", `${e.src}>${e.dst}`, { kind: "unlinked", src: e.src, dst: e.dst });
  },
  FocusSet: (c, e) => c.put("focus", "", { kind: "focused", ids: e.ids, reason: e.reason }),
  FocusCleared: (c) => {
    c.entries.delete(c.k("focus", ""));
  },
  NoteAdded: (c, e) => {
    c.put("note", e.id, { kind: "noted", id: e.id, text: e.text, target: e.target, thread: e.thread });
    if (!e.thread) return;
    const thread = c.k("thread", e.thread);
    c.replies.set(thread, [...(c.replies.get(thread) ?? []), e.id]);
  },
  NoteResolved: (c, e) => {
    // A thread opened and closed before the reader looked never existed for them, replies included.
    if (!c.entries.delete(c.k("note", e.id))) {
      c.put("resolve", e.id, { kind: "resolved", id: e.id });
      return;
    }
    for (const reply of c.replies.get(c.k("thread", e.id)) ?? []) c.entries.delete(c.k("note", reply));
  },
  TurnPassed: (c, e) => {
    if (e.to === "agent") c.put("turn", String(e.seq), { kind: "passed", message: e.message });
  },
};

/** A label put or taken. Put and taken since the reader looked, or the reverse: no news. */
function labeled(c: Telling, id: string, label: string, on: boolean): void {
  const at = `${id}/${label.toLowerCase()}`;
  if (!c.entries.delete(c.k("label", at))) c.put("label", at, { kind: "labeled", id, label, on });
}

/** Tells an event of a board, against the board as it was before it. */
function tell(p: Pending, ws: Workspace, e: Recorded & { board: string }): void {
  const board = findBoard(ws, e.board);
  const telling: Telling = {
    ...p,
    board,
    el: "id" in e && board ? findElement(board, e.id) : undefined,
    k: (kind, id) => `${e.board}/${kind}/${id}`,
    put: (kind, id, change) => {
      p.entries.set(`${e.board}/${kind}/${id}`, { board: e.board, change });
    },
  };
  (TELL[e.event] as ((c: Telling, e: Recorded) => void) | undefined)?.(telling, e);
}

export function netChanges(events: readonly Recorded[], after: number, by: Actor): Net {
  const ws = emptyWorkspace();
  const silent = cancelledOut(events, after, by);
  const p: Pending = {
    entries: new Map(),
    replies: new Map(),
    added: new Set(),
    origin: new Map(),
    made: new Set(),
    gone: new Map(),
    absent: new Set(),
    shelved: new Map(),
  };
  for (const e of events) {
    const quiet = silent.has(e.seq);
    const at = { quiet, mine: e.seq > after && e.actor === by && !quiet, known: e.seq <= after };
    if (e.event === "BoardCreated") {
      p.shelved.delete(e.board);
      p.absent.delete(e.board);
    }
    if (e.event === "BoardRemoved") boardRemoved(p, e, at);
    else if (e.event === "BoardRestored") boardRestored(p, e, at);
    else if (at.mine && "board" in e) tell(p, ws, e);
    apply(ws, e);
  }
  const turns = [...p.entries.values()].flatMap(({ change }) => (change.kind === "passed" ? [change] : []));
  const words = [...new Set(turns.flatMap((turn) => (turn.message ? [turn.message] : [])))];
  return { ws, entries: [...p.entries.values()], gone: p.gone, passed: turns.length > 0, words };
}

/** An element as an addition to tell: what it is and where it sits. */
function asAdded(el: Pick<Element, "id" | "type" | "label" | "col" | "lane">): Added {
  return { kind: "added", id: el.id, type: el.type, label: el.label, col: el.col, lane: el.lane };
}

function remember(origin: Map<string, Origin>, key: string, board: Board | undefined, el: Element): Origin {
  const known = origin.get(key);
  if (known) return known;
  const first = {
    label: el.label,
    col: el.col,
    lane: el.lane,
    next: board ? nextInLane(board, el) : undefined,
  };
  origin.set(key, first);
  return first;
}

export function nextInLane(board: Board, el: Element): string | undefined {
  const lane = board.elements.filter((other) => other.lane === el.lane);
  return lane[lane.indexOf(el) + 1]?.id;
}
