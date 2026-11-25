/**
 * What the sheet of a board's title and question sends (T289, T290): only
 * what changed. Apart from the sheet, which needs a page, to be tested alone.
 */
import type { Command } from "../domain/commands.ts";

/** The commands for the words in the sheet: the title first, an emptied title never. */
export function changes(
  board: { id: string; title: string; purpose?: string },
  title: string,
  purpose: string,
): Command[] {
  const commands: Command[] = [];
  if (title && title !== board.title) commands.push({ kind: "retitle", board: board.id, title });
  if (purpose !== (board.purpose ?? "")) commands.push({ kind: "purpose", board: board.id, purpose });
  return commands;
}
