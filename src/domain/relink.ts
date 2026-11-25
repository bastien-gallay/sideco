/**
 * One end of a link goes to another card (S350): its start or its arrow, the
 * other end and the name kept. Taken off then laid again, in one gesture: one
 * undo puts it back.
 */
import { type Command, CommandError } from "./commands.ts";
import type { BoardEvent } from "./events.ts";
import { requireElement } from "./guards.ts";
import type { Board } from "./workspace.ts";

type Relink = Extract<Command, { kind: "relink" }>;

/** The events that move the end, none when it is already there; refused where no link can be. */
export function relink(board: Board, cmd: Relink): { events: BoardEvent[] } {
  const b = board.id;
  const link = board.edges.find((e) => e.src === cmd.src && e.dst === cmd.dst);
  if (!link) throw new CommandError(`no link ${cmd.src} → ${cmd.dst} on "${b}"`);
  requireElement(board, cmd.to);
  const [src, dst] = cmd.end === "src" ? [cmd.to, cmd.dst] : [cmd.src, cmd.to];
  if (src === cmd.src && dst === cmd.dst) return { events: [] };
  if (src === dst) throw new CommandError(`${src} cannot link to itself`);
  if (board.edges.some((e) => e.src === src && e.dst === dst))
    throw new CommandError(`${src} already links to ${dst}`);
  return {
    events: [
      { event: "EdgeRemoved", board: b, src: cmd.src, dst: cmd.dst },
      { event: "EdgeAdded", board: b, src, dst, label: link.label },
    ],
  };
}

/**
 * The name of a gesture that took a link off (`unlink A B`) then laid `laid`
 * in the same breath: a link reversed when it is laid the other way round, an
 * end moved when one end is the same; undefined otherwise.
 */
export function relaid(name: string, laid: { src: string; dst: string }): string | undefined {
  const taken = /^unlink (\S+) (\S+)$/.exec(name);
  if (!taken) return undefined;
  const [, src, dst] = taken;
  if (laid.src === dst && laid.dst === src) return `reverse ${src} ${dst}`;
  if (laid.src === src && laid.dst !== dst) return `relink ${src} ${dst} --to ${laid.dst}`;
  if (laid.dst === dst && laid.src !== src) return `relink ${src} ${dst} --from ${laid.src}`;
  return undefined;
}
