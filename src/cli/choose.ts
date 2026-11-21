/**
 * Which board, and which card of it, a command means: the one it names, else
 * `--board`, else `SIDECO_BOARD`, else the only board there is. A board or a
 * card that is not there is refused in words that list what is.
 */
import { asElementId, type ElementId } from "../domain/ids.ts";
import { type Board, findBoard, type Workspace } from "../domain/workspace.ts";
import { type Args, UsageError } from "./argv.ts";
import { readSetting } from "./setting.ts";

const setting = (name: string): string | undefined => readSetting(name, process.env);

export function defaultBoard(ws: Workspace, args: Args, required: boolean): string | undefined {
  const chosen = args.flags.get("board") ?? setting("SIDECO_BOARD");
  if (chosen) return chosen;
  if (ws.boards.length === 1) return ws.boards[0]?.id;
  if (!required) return undefined;
  throw new UsageError(
    ws.boards.length === 0
      ? 'no board yet; create one with `sideco board new "Title"`'
      : `which board? pass --board ID (boards: ${ws.boards.map((b) => b.id).join(", ")})`,
  );
}

/** `show E1` and `url E1` name a card of the board; `show backlog` and `url backlog` a board. */
export function named(ws: Workspace, args: Args): { board: Board; card?: ElementId } {
  const card = asElementId(args.positional[0] ?? "");
  return {
    board: chooseBoard(ws, card ? args.flags.get("board") : (args.positional[0] ?? args.flags.get("board"))),
    card,
  };
}

export function chooseBoard(ws: Workspace, id: string | undefined): Board {
  const chosen = id ?? setting("SIDECO_BOARD") ?? (ws.boards.length === 1 ? ws.boards[0]?.id : undefined);
  const known = `(boards: ${ws.boards.map((b) => b.id).join(", ") || "none yet"})`;
  if (!chosen) throw new UsageError(`which board? ${known}`);
  const board = findBoard(ws, chosen);
  if (!board) throw new UsageError(`no board "${chosen}" ${known}`);
  return board;
}
