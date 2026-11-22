/**
 * One letter per concept in the whole project, and one board per id. Cards an
 * older Sideco minted under a letter their kind no longer takes, and ids an
 * older journal gave on several boards, are renumbered by `sideco renumber --all`.
 *
 * A shared id stays on a kanban, whose ids the commits cite, and otherwise on
 * the board made first; the other holders take the next id of their letter.
 */
import { findFormat, findType } from "./formats.ts";
import { highestUsed } from "./minting.ts";
import type { Board, Workspace } from "./workspace.ts";

export interface Renumbering {
  board: string;
  id: string;
  to: string;
  /** `letter`: minted under a former letter; `shared`: the board `keptBy` keeps the id. */
  why: "letter" | "shared";
  keptBy?: string;
}

/** The kanbans first, each kind in the order its boards were made. */
function keepers(ws: Workspace): Board[] {
  const kanban = (b: Board): number => (b.format === "kanban" ? 0 : 1);
  return [...ws.boards].sort((a, b) => kanban(a) - kanban(b));
}

/** Every card to renumber, with the id it takes: none twice, none the project used. */
export function renumbering(ws: Workspace): Renumbering[] {
  const given = new Map<string, number>();
  const next = (prefix: string): string => {
    const n = (given.get(prefix) ?? highestUsed(ws, prefix)) + 1;
    given.set(prefix, n);
    return `${prefix}${n}`;
  };
  const kept = new Map<string, string>();
  const plan: Renumbering[] = [];
  for (const board of keepers(ws)) {
    const format = findFormat(board.format);
    for (const el of board.elements) {
      const prefix = format && findType(format, el.type)?.prefix;
      if (!prefix) continue;
      const keptBy = kept.get(el.id);
      if (el.id.charAt(0) !== prefix)
        plan.push({ board: board.id, id: el.id, to: next(prefix), why: "letter" });
      else if (keptBy) plan.push({ board: board.id, id: el.id, to: next(prefix), why: "shared", keptBy });
      else kept.set(el.id, board.id);
    }
  }
  return plan;
}
