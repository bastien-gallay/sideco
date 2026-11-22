/**
 * A board's notes as discussions: a note opens a thread, its replies follow it.
 */
import type { Board, Note, Thread } from "./workspace.ts";

/** The id of the discussion a note belongs to. */
export function threadOf(note: Note): string {
  return note.thread ?? note.id;
}

/** The board's notes as discussions, in the order they were opened. */
export function threads(board: Board): Thread[] {
  const byId = new Map<string, Thread>();
  for (const note of board.notes) {
    const thread = byId.get(threadOf(note));
    if (thread) thread.notes.push(note);
    else byId.set(note.id, { id: note.id, target: note.target, resolved: note.resolved, notes: [note] });
  }
  return [...byId.values()];
}
