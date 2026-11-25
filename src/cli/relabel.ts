/**
 * `sideco relabel OLD NEW`: a label renamed on every card that wears it, on
 * every board of the project (S328). One gesture a board: `sideco undo` takes
 * it back there.
 */
import type { Command } from "../domain/commands.ts";
import { renameLabel } from "../domain/label-rename.ts";
import { normalLabel } from "../domain/labels.ts";
import type { Workspace } from "../domain/workspace.ts";
import { UsageError } from "./args.ts";

const count = (n: number, word: string): string => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Renames, and says on how many cards of how many boards. `send` posts the commands as one gesture. */
export async function relabel(
  ws: Workspace,
  [from, to, ...more]: readonly string[],
  send: (commands: Command[]) => Promise<unknown>,
): Promise<string> {
  if (from === undefined || to === undefined || more.length > 0 || !normalLabel(to))
    throw new UsageError("relabel needs the label and its new name: sideco relabel OLD NEW");
  const commands = renameLabel(ws, from, to);
  if (commands.length === 0) return `no card wears ${normalLabel(from)}`;
  await send(commands);
  const boards = new Set(commands.map((command) => ("board" in command ? command.board : "")));
  return `${normalLabel(from)} is now ${normalLabel(to)} on ${count(commands.length / 2, "card")} of ${count(boards.size, "board")}`;
}
