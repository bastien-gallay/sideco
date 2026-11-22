/**
 * `sideco renumber --all`: every card minted under a former letter, or whose id
 * another board keeps, takes the next id of its letter, in one batch: all or
 * nothing. With `--dry-run`, the same plan is said and nothing is written.
 */
import type { Command } from "../domain/commands.ts";
import { type Renumbering, renumbering } from "../domain/letters.ts";
import type { Workspace } from "../domain/workspace.ts";

function line(r: Renumbering): string {
  const why = r.why === "letter" ? "former letter" : `${r.id} stays on ${r.keptBy}`;
  return `  ${r.board.padEnd(18)} ${r.id.padEnd(6)} → ${r.to.padEnd(6)} ${why}`;
}

export async function renumberAll(
  ws: Workspace,
  dryRun: boolean,
  send: (commands: Command[]) => Promise<{ seq: number }>,
): Promise<string> {
  const plan = renumbering(ws);
  if (plan.length === 0) return "every id is under its kind's letter and on one board: nothing to renumber";
  const cards = `${plan.length} card${plan.length > 1 ? "s" : ""}`;
  const lines = plan.map(line);
  if (dryRun) return [`would renumber ${cards}:`, ...lines].join("\n");
  const done = await send(plan.map((r) => ({ kind: "renumber", board: r.board, id: r.id, to: r.to })));
  return [`renumbered ${cards} (seq ${done.seq}):`, ...lines].join("\n");
}
