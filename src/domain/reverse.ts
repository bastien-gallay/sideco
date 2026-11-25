/**
 * Undo and redo, decided: the way back a board kept for an author, taken, refused
 * when the other author changed it since, or taken anyway when the human says so.
 */
import { CommandError } from "./commands.ts";
import type { Actor, BoardEvent } from "./events.ts";
import { type Gesture, goneFrom } from "./undo.ts";
import type { Board } from "./workspace.ts";

/** The events an undo or a redo appends; `refused` when it is a refusal, said. */
export interface Reversal {
  events: BoardEvent[];
  refused?: string;
}

/**
 * Undo and redo say again what the board kept as the way back, marked with the
 * gesture they answer. On a removed board, the only thing to take back is the removal.
 */
export function reverse(
  board: Board,
  live: boolean,
  cmd: { kind: "undo" | "redo"; ifChanged?: "overwrite" | "keep" },
  actor: Actor,
): Reversal {
  const trail = board.trails[actor]?.[cmd.kind] ?? [];
  const gesture = trail.at(-1);
  if (!gesture || (!live && gesture.inverse[0]?.event !== "BoardRestored")) {
    throw new CommandError(`nothing to ${cmd.kind} on "${board.id}"`);
  }
  const anyway = cmd.ifChanged === "overwrite";
  if (anyway && actor !== "human") throw new CommandError("only the human undoes anyway");
  if (live && gesture.blocked && !anyway) {
    const refusal = refuseUndo(board, cmd.kind, trail);
    // Kept as the human chose: the refusal is written, and is no error to answer.
    return cmd.ifChanged === "keep" ? { events: refusal.events } : refusal;
  }
  const gone = live && anyway ? goneFrom(board, gesture) : undefined;
  if (gone) throw new CommandError(`cannot undo anyway on "${board.id}": ${gone} is gone`);
  // A lane goes away only empty: one that got cards since cannot be taken back.
  for (const back of gesture.inverse) {
    if (back.event !== "LaneRemoved") continue;
    if (board.elements.some((el) => el.lane === back.lane))
      throw new CommandError(
        `nothing to ${cmd.kind} for now on "${board.id}": column ${back.lane} has cards now`,
      );
  }
  const answers = cmd.kind === "undo" ? { undoes: gesture.seq } : { redoes: gesture.seq };
  return { events: gesture.inverse.map((e): BoardEvent => ({ ...e, ...answers })) };
}

const WHO: Record<Actor, string> = { human: "the human", agent: "Claude", system: "the system" };

/**
 * The gestures on top of the trail that the other author changed since: the undo
 * refuses them all at once, names them and what changed them, and says what the
 * next undo takes back. Modelled on `git revert`: a conflict stops, and says so.
 */
function refuseUndo(board: Board, way: "undo" | "redo", trail: readonly Gesture[]): Reversal {
  let below = trail.length;
  while (below > 0 && trail[below - 1]?.blocked) below--;
  const refused = trail.slice(below).reverse();
  const blocker = refused[0]?.blocked;
  if (!blocker) throw new CommandError(`nothing to ${way} on "${board.id}"`);
  const next = trail[below - 1];
  const named = refused.map((g) => `seq ${g.seq} (${g.name})`).join(", ");
  const whose = refused.length === 1 ? `your gesture ${named} was` : `your gestures ${named} were`;
  const then = next
    ? `the next ${way} takes back seq ${next.seq} (${next.name})`
    : `nothing left to ${way} on "${board.id}"`;
  return {
    events: [
      {
        event: "UndoRefused",
        board: board.id,
        way,
        gestures: refused.map((g) => g.seq),
        by: blocker.actor,
        at: blocker.seq,
      },
    ],
    refused: `refused: ${whose} changed since by ${WHO[blocker.actor]} (seq ${blocker.seq}: ${blocker.name}); ${then}`,
  };
}
