/**
 * The journal vocabulary. Every fact the companion knows is one of these events,
 * appended once and never rewritten; boards and sessions are projections of them.
 *
 * Schema evolution is additive: a reader ignores event names and fields it does not
 * know, and a renamed event is migrated at the single `upcast` point in `journal.ts`.
 */

export type Actor = "human" | "agent" | "system";

export const ACTORS: readonly Actor[] = ["human", "agent", "system"];

export interface Todo {
  /** Present when the harness tracks the task by id; absent for a plain checklist. */
  id?: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
}

/**
 * How a board event relates to the gesture it belongs to. A gesture is what one
 * command did; undo and redo answer it with ordinary events that carry its seq.
 */
export interface Lineage {
  /** This event takes back the gesture that ended at this seq. */
  undoes?: number;
  /** This event puts back what the undo that ended at this seq took. */
  redoes?: number;
  /** Same gesture as the event before it: one undo takes them back together. */
  joined?: true;
}

/** A link as it stood when its element was removed. */
export interface KeptEdge {
  src: string;
  dst: string;
  label?: string;
  by: Actor;
}

/** A point of the scene, from its top left corner, in the units the layout draws in. */
export interface Point {
  x: number;
  y: number;
}

/**
 * What happened on a board. Positions are semantic (`col`, `lane`), except on a
 * diagram placed by hand, where a card keeps the point it was put at (S344).
 */
export type BoardEvent = Lineage & BoardFact;

type BoardFact =
  | { event: "BoardCreated"; board: string; title: string; format: string }
  | { event: "BoardRetitled"; board: string; title: string }
  /** The board asks its own question; an empty one gives the workshop's back. */
  | { event: "BoardPurposed"; board: string; purpose: string }
  /** The board calls a lane of its workshop its own way; an empty label gives the workshop's name back. */
  | { event: "LaneNamed"; board: string; lane: string; label: string }
  /** A lane of the board's own, before `before`, else last. An empty label leaves its workshop's name, if it has one. */
  | { event: "LaneAdded"; board: string; lane: string; label: string; before?: string }
  /** The board says what a lane stands for its own way; an empty hint gives the workshop's back. */
  | { event: "LaneHinted"; board: string; lane: string; hint: string }
  /**
   * The board names an axis of its plan, and its two ends: `low` where it starts
   * (left, bottom), `high` where it ends. An end left out is the workshop's; an
   * empty label gives the workshop's whole axis back.
   */
  | { event: "AxisNamed"; board: string; axis: "x" | "y"; label: string; low?: string; high?: string }
  | { event: "SliceAdded"; board: string; slice: string; label: string; before?: string }
  | { event: "SliceRemoved"; board: string; slice: string }
  /** An empty lane leaves the board, its name with it. */
  | { event: "LaneRemoved"; board: string; lane: string }
  /** A lane goes before `before`, else last; its cards go with it. */
  | { event: "LaneMoved"; board: string; lane: string; before?: string }
  /** The board leaves the workspace; the journal keeps its history. `title` is what it was called. */
  | { event: "BoardRemoved"; board: string; title: string }
  /** A removed board comes back as it was: only undoing its removal says this. */
  | { event: "BoardRestored"; board: string; title: string }
  | {
      event: "ElementAdded";
      board: string;
      id: string;
      type: string;
      label: string;
      col: number;
      lane: string;
      detail?: string;
    }
  | { event: "ElementRenamed"; board: string; id: string; label: string }
  | { event: "ElementAnnotated"; board: string; id: string; detail: string }
  | { event: "ElementMarked"; board: string; id: string; done: boolean }
  /** A label goes on the card; labels are shared by every board of the project. */
  | { event: "ElementLabeled"; board: string; id: string; label: string }
  | { event: "ElementUnlabeled"; board: string; id: string; label: string }
  | { event: "ElementMoved"; board: string; id: string; col: number; lane: string; before?: string }
  | { event: "ElementRemoved"; board: string; id: string }
  /** On a diagram, the card is put at this point of the scene; without one, it has no place of its own. */
  | { event: "ElementPlaced"; board: string; id: string; at?: Point }
  /** A diagram is placed by hand, or by its links again; the places made by hand are kept. */
  | { event: "BoardPlacing"; board: string; byHand: boolean }
  /** The element takes the id `to`; what points at it follows, and `id` is never given again. */
  /** With `type`, the element changed kind with its id. */
  | { event: "ElementRenumbered"; board: string; id: string; to: string; type?: string }
  /**
   * A removed element comes back under its id, the one case where an id returns.
   * The event carries the element whole: who added it, when, where it sat
   * (`before` is the element that followed it) and the links it had.
   */
  | {
      event: "ElementRestored";
      board: string;
      id: string;
      type: string;
      label: string;
      col: number;
      lane: string;
      detail?: string;
      done?: boolean;
      labels?: string[];
      formerIds?: string[];
      at?: Point;
      by: Actor;
      addedSeq: number;
      before?: string;
      edges: KeptEdge[];
    }
  | { event: "ColumnInserted"; board: string; at: number }
  /** An empty column taken out: the columns after it close the gap. */
  | { event: "ColumnRemoved"; board: string; at: number }
  /** The column numbered `from` takes the number `to`, its cards with it; the columns it passes close the gap. */
  | { event: "ColumnMoved"; board: string; from: number; to: number }
  /** `by` is set when a link returns: it keeps the author it had. */
  | { event: "EdgeAdded"; board: string; src: string; dst: string; label?: string; by?: Actor }
  | { event: "EdgeRemoved"; board: string; src: string; dst: string }
  | { event: "FocusSet"; board: string; ids: string[]; reason?: string }
  | { event: "FocusCleared"; board: string }
  /** `thread` is the note that opened the discussion this one answers; absent, the note opens one. */
  | { event: "NoteAdded"; board: string; id: string; text: string; target?: string; thread?: string }
  | { event: "NoteResolved"; board: string; id: string }
  | { event: "TurnPassed"; board: string; to: "agent" | "human"; message?: string; target?: string }
  /**
   * The author's undo (or redo) was refused: the gestures on top of their trail
   * were changed since by `by`, at `at`. They leave the trail, and the next undo
   * takes the one under them. Said, not drawn: the board does not change.
   */
  | { event: "UndoRefused"; board: string; way: "undo" | "redo"; gestures: number[]; by: Actor; at: number };

/** What happened in the terminal session. The session id travels on the envelope. */
export type SessionEvent =
  | { event: "SessionStarted"; cwd?: string }
  /** The session goes by this name, so that two on one project can be told apart. */
  | { event: "SessionNamed"; name: string }
  /** The session takes these boards: what the human changes there is for it. */
  | { event: "BoardsFollowed"; boards: string[] }
  /** The session lets go of these boards, until it writes on one again. */
  | { event: "BoardsLeft"; boards: string[] }
  | { event: "PromptSubmitted"; text: string }
  | { event: "ToolStarted"; call: string; tool: string; summary: string }
  | { event: "ToolFinished"; call: string; ok: boolean }
  | { event: "TodosUpdated"; todos: Todo[] }
  | { event: "AgentNotified"; message: string }
  | { event: "TurnEnded" }
  | { event: "SessionEnded" }
  | { event: "ChangesDelivered"; upTo: number };

export type SidecoEvent = BoardEvent | SessionEvent;

export type EventName = SidecoEvent["event"];

/** Who, when, and in which terminal session. `seq` is the journal's total order. */
export interface Envelope {
  seq: number;
  ts: string;
  actor: Actor;
  session?: string;
}

export type Recorded = Envelope & SidecoEvent;

const BOARD_EVENTS: ReadonlySet<string> = new Set<BoardEvent["event"]>([
  "BoardCreated",
  "BoardRetitled",
  "BoardPurposed",
  "LaneNamed",
  "LaneAdded",
  "LaneHinted",
  "AxisNamed",
  "SliceAdded",
  "SliceRemoved",
  "LaneRemoved",
  "LaneMoved",
  "BoardRemoved",
  "BoardRestored",
  "ElementAdded",
  "ElementRenamed",
  "ElementAnnotated",
  "ElementMarked",
  "ElementLabeled",
  "ElementUnlabeled",
  "ElementMoved",
  "ElementRemoved",
  "ElementPlaced",
  "BoardPlacing",
  "ElementRenumbered",
  "ElementRestored",
  "ColumnInserted",
  "ColumnRemoved",
  "ColumnMoved",
  "EdgeAdded",
  "EdgeRemoved",
  "FocusSet",
  "FocusCleared",
  "NoteAdded",
  "NoteResolved",
  "TurnPassed",
  "UndoRefused",
]);

const SESSION_EVENTS: ReadonlySet<string> = new Set<SessionEvent["event"]>([
  "SessionStarted",
  "SessionNamed",
  "BoardsFollowed",
  "BoardsLeft",
  "PromptSubmitted",
  "ToolStarted",
  "ToolFinished",
  "TodosUpdated",
  "AgentNotified",
  "TurnEnded",
  "SessionEnded",
  "ChangesDelivered",
]);

export function isBoardEvent(e: SidecoEvent): e is BoardEvent {
  return BOARD_EVENTS.has(e.event);
}

export function isKnownEvent(name: unknown): name is EventName {
  return typeof name === "string" && (BOARD_EVENTS.has(name) || SESSION_EVENTS.has(name));
}
