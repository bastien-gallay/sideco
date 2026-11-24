/**
 * The shape of a workspace: its boards, what they hold, and the sessions that
 * work on them. `workspace.ts` folds the journal into it.
 */
import type { Actor } from "./events.ts";
import type { Session } from "./sessions.ts";
import type { Trails } from "./undo.ts";

export interface Element {
  id: string;
  type: string;
  label: string;
  detail?: string;
  /** What the card stands for is done; absent while it is not. */
  done?: boolean;
  /** Free words shared by every board: `type:bug`, `assignee:bastien`, `release 0.4`. Absent while none. */
  labels?: string[];
  /** The ids it had before it was renumbered, oldest first. Absent while none. */
  formerIds?: string[];
  col: number;
  lane: string;
  by: Actor;
  addedSeq: number;
  changedSeq: number;
}

export interface Edge {
  src: string;
  dst: string;
  label?: string;
  by: Actor;
}

export interface Note {
  id: string;
  text: string;
  /** The element the discussion is about; a reply carries the one of its thread. */
  target?: string;
  /** The note that opened the discussion this one answers. */
  thread?: string;
  by: Actor;
  seq: number;
  resolved: boolean;
}

/** A discussion: the note that opened it, then its replies, in order. Its id is the opening note's. */
export interface Thread {
  id: string;
  target?: string;
  resolved: boolean;
  notes: Note[];
}

export interface Turn {
  to: "agent" | "human";
  /** The session a hand-over to the agent is for; none, and it is for every session the board concerns. */
  target?: string;
  message?: string;
  seq: number;
}

/** A named line across a story map: the stories above it ship before the ones below. */
export interface Slice {
  id: string;
  label: string;
}

/** An axis of a plan as a board names it: an end left out is the workshop's. */
export interface Axis {
  label: string;
  low?: string;
  high?: string;
}

export interface Board {
  id: string;
  title: string;
  format: string;
  /** The lanes this board calls its own way, by lane id; the others keep the name their workshop gives. */
  lanes: Record<string, string>;
  /** The question the board answers, where it asks its own. */
  purpose?: string;
  /** What a lane stands for, by lane id, where the board says it its own way. */
  hints?: Record<string, string>;
  /** The axes of a plan the board names its own way. */
  axes?: Partial<Record<"x" | "y", Axis>>;
  /** The board's own lanes, in order, once it added, moved or removed one; until then, its workshop's (see `lanesOf`). */
  laneOrder?: string[];
  /** The lines under the stories of a story map, top to bottom: what ships first is above. */
  slices?: Slice[];
  /** In stacking order: within a cell, earlier elements sit first. */
  elements: Element[];
  edges: Edge[];
  notes: Note[];
  focus: { ids: string[]; reason?: string } | null;
  turn: Turn | null;
  /** Highest number ever used per id prefix: the next minted id is one above. */
  minted: Record<string, number>;
  /** Ids of removed elements. With the ids in use, they are every id ever given: none is given twice. */
  retired: string[];
  /** Per author, the gestures they can still take back on this board, and put back. */
  trails: Trails;
  createdSeq: number;
  changedSeq: number;
  /** The last session whose agent wrote on the board: a hand-over goes to it by default. */
  writer?: string;
}

export interface Workspace {
  /** In the order they were created. */
  boards: Board[];
  /** Removed boards, kept aside as they were: undoing the removal brings one back. */
  removed: Board[];
  sessions: Session[];
  /** Per session, the boards it follows: those it wrote on, and those it said it takes. */
  follows: Record<string, string[]>;
  /** Per session, the boards it let go of: not for it, even when nobody else follows them. */
  left: Record<string, string[]>;
  seq: number;
}
