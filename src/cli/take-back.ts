/**
 * `sideco undo` and `sideco redo`: the author's own last gesture on a board,
 * taken back or put back, and said by its name.
 */
import { decide } from "../domain/decide.ts";
import { ACTORS, type Actor } from "../domain/events.ts";
import { findBoard, type Workspace } from "../domain/workspace.ts";
import { UsageError } from "./argv.ts";
import type { Posted } from "./client.ts";

/**
 * Undo or redo, named: the gesture is said in the words of the CLI that did it.
 * With `--dry-run`, the same decision is made on the journal as read here, and
 * nothing is written. `as` names the author whose gesture it is.
 */
export async function takeBack(
  command: { kind: "undo" | "redo"; board: string },
  ws: Workspace,
  as: string,
  dryRun: boolean,
  send: (command: { kind: "undo" | "redo"; board: string }) => Promise<Posted>,
): Promise<number> {
  const actor = asAuthor(as);
  const kept = findBoard(ws, command.board) ?? ws.removed.find((b) => b.id === command.board);
  const gesture = kept?.trails[actor]?.[command.kind].at(-1);
  if (dryRun) {
    const decision = decide(ws, command, { actor });
    if (decision.refused) console.log(`would be refused: ${decision.refused.replace(/^refused: /, "")}`);
    else console.log(`would ${command.kind} seq ${gesture?.seq}: ${gesture?.name}`);
    return 0;
  }
  await send(command);
  console.log(`${command.kind === "undo" ? "undid" : "redid"} seq ${gesture?.seq}: ${gesture?.name}`);
  return 0;
}

/** `--as` names one of the authors; anything else is a mistake said in words. */
function asAuthor(name: string): Actor {
  const actor = ACTORS.find((a) => a === name);
  if (!actor) throw new UsageError(`--as is one of: ${ACTORS.join(", ")}`);
  return actor;
}
