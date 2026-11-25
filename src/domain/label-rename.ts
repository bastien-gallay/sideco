/**
 * A label renamed on every card that wears it, on every board (S328): the
 * commands that take the old name off each card and give it the new one. Sent
 * as one gesture, they are taken back board by board. A card that already
 * wears the new name keeps it once: renaming onto a name in use merges the two.
 */
import type { Command } from "./commands.ts";
import { normalLabel, sameLabel } from "./labels.ts";
import type { Workspace } from "./workspace.ts";

export function renameLabel(ws: Workspace, from: string, to: string): Command[] {
  const old = normalLabel(from);
  const next = normalLabel(to);
  if (!old || !next || old === next) return [];
  return ws.boards.flatMap((board) =>
    board.elements.flatMap((el): Command[] => {
      const own = el.labels?.find((label) => sameLabel(label, old));
      // The same name in another case is rewritten too: it is the name asked for that is kept.
      if (own === undefined || own === next) return [];
      return [
        { kind: "unlabel", board: board.id, id: el.id, labels: [own] },
        { kind: "label", board: board.id, id: el.id, labels: [next] },
      ];
    }),
  );
}
