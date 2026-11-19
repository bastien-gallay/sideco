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

/** What happened on a board. Positions are semantic (`col`, `lane`), never pixels. */
export type BoardEvent = Lineage & BoardFact;

type BoardFact =
  | { event: "BoardCreated"; board: string; title: string; format: string }
  | { event: "BoardRetitled"; board: string; title: string }
  /** The board calls a lane of its workshop its own way; an empty label gives the workshop's name back. */
  | { event: "LaneNamed"; board: string; lane: string; label: string }
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
  | { event: "ElementMoved"; board: string; id: string; col: number; lane: string; before?: string }
  | { event: "ElementRemoved"; board: string; id: string }
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
      by: Actor;
      addedSeq: number;
      before?: string;
      edges: KeptEdge[];
    }
  | { event: "ColumnInserted"; board: string; at: number }
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
  | { event: "TurnPassed"; board: string; to: "agent" | "human"; message?: string };

/** What happened in the terminal session. The session id travels on the envelope. */
export type SessionEvent =
  | { event: "SessionStarted"; cwd?: string }
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
  "LaneNamed",
  "BoardRemoved",
  "BoardRestored",
  "ElementAdded",
  "ElementRenamed",
  "ElementAnnotated",
  "ElementMarked",
  "ElementMoved",
  "ElementRemoved",
  "ElementRestored",
  "ColumnInserted",
  "ColumnMoved",
  "EdgeAdded",
  "EdgeRemoved",
  "FocusSet",
  "FocusCleared",
  "NoteAdded",
  "NoteResolved",
  "TurnPassed",
]);

const SESSION_EVENTS: ReadonlySet<string> = new Set<SessionEvent["event"]>([
  "SessionStarted",
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
