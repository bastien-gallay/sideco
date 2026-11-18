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

/** What happened on a board. Positions are semantic (`col`, `lane`), never pixels. */
export type BoardEvent =
  | { event: "BoardCreated"; board: string; title: string; format: string }
  | { event: "BoardRetitled"; board: string; title: string }
  /** The board leaves the workspace; the journal keeps its history. `title` is what it was called. */
  | { event: "BoardRemoved"; board: string; title: string }
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
  | { event: "ElementMoved"; board: string; id: string; col: number; lane: string; before?: string }
  | { event: "ElementRemoved"; board: string; id: string }
  | { event: "ColumnInserted"; board: string; at: number }
  | { event: "EdgeAdded"; board: string; src: string; dst: string; label?: string }
  | { event: "EdgeRemoved"; board: string; src: string; dst: string }
  | { event: "FocusSet"; board: string; ids: string[]; reason?: string }
  | { event: "FocusCleared"; board: string }
  | { event: "NoteAdded"; board: string; id: string; text: string; target?: string }
  | { event: "NoteResolved"; board: string; id: string }
  | { event: "TurnPassed"; board: string; to: "agent" | "human"; message?: string };

/** What happened in the terminal session. The session id travels on the envelope. */
export type SessionEvent =
  | { event: "SessionStarted"; cwd?: string }
  | { event: "PromptSubmitted"; text: string }
  | { event: "ToolStarted"; call: string; tool: string; summary: string }
  | { event: "ToolFinished"; call: string; ok: boolean }
  | { event: "TodosUpdated"; todos: Todo[] }
  | { event: "AgentNotified"; message: string }
  | { event: "TurnEnded" }
  | { event: "ChangesDelivered"; upTo: number };

export type VicoEvent = BoardEvent | SessionEvent;

export type EventName = VicoEvent["event"];

/** Who, when, and in which terminal session. `seq` is the journal's total order. */
export interface Envelope {
  seq: number;
  ts: string;
  actor: Actor;
  session?: string;
}

export type Recorded = Envelope & VicoEvent;

const BOARD_EVENTS: ReadonlySet<string> = new Set<BoardEvent["event"]>([
  "BoardCreated",
  "BoardRetitled",
  "BoardRemoved",
  "ElementAdded",
  "ElementRenamed",
  "ElementAnnotated",
  "ElementMoved",
  "ElementRemoved",
  "ColumnInserted",
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
  "PromptSubmitted",
  "ToolStarted",
  "ToolFinished",
  "TodosUpdated",
  "AgentNotified",
  "TurnEnded",
  "ChangesDelivered",
]);

export function isBoardEvent(e: VicoEvent): e is BoardEvent {
  return BOARD_EVENTS.has(e.event);
}

export function isKnownEvent(name: unknown): name is EventName {
  return typeof name === "string" && (BOARD_EVENTS.has(name) || SESSION_EVENTS.has(name));
}
