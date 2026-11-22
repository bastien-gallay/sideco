/**
 * An element takes a new id. What points at it on its board follows: its links,
 * the notes on it, the focus, and the ways back each author keeps, so that a
 * gesture made before still takes back what it did. The old id is never given
 * again, and the element keeps it among its former ids, until an undo gives it back.
 */
import { type Command, CommandError } from "./commands.ts";
import type { BoardEvent, Recorded } from "./events.ts";
import { type Format, findType } from "./formats.ts";
import { requireElement } from "./guards.ts";
import { claim, mint, remember } from "./minting.ts";
import type { Board, Workspace } from "./workspace.ts";

type Renumbered = Extract<Recorded, { event: "ElementRenumbered" }>;

/** The fields of an event that name an element. */
const NAMING = ["id", "src", "dst", "before", "target"] as const;

/**
 * The card takes `to`, or the next id of its letter; with `type`, it takes that
 * kind too, and the letter that goes with it.
 */
export function renumbering(
  ws: Workspace,
  board: Board,
  format: Format,
  cmd: Extract<Command, { kind: "renumber" }>,
): { events: BoardEvent[]; minted: string } {
  const el = requireElement(board, cmd.id);
  const kind = cmd.type ?? el.type;
  const type = findType(format, kind);
  if (!type) throw new CommandError(`${format.name.en} has no "${kind}"`);
  const to = cmd.to === undefined ? mint(ws, type.prefix) : claim(ws, type, cmd.to, format);
  const retyped = kind === el.type ? {} : { type: kind };
  return {
    events: [{ event: "ElementRenumbered", board: board.id, id: cmd.id, to, ...retyped }],
    minted: to,
  };
}

export function renumber(board: Board, e: Renumbered): void {
  const el = board.elements.find((x) => x.id === e.id);
  if (!el || board.elements.some((x) => x.id === e.to)) return;
  const follow = (id: string): string => (id === e.id ? e.to : id);
  // Taken back, the element is given its id again: it leaves the retired ids and the former ones.
  const former = el.formerIds?.includes(e.to)
    ? el.formerIds.filter((id) => id !== e.to)
    : [...(el.formerIds ?? []), e.id];
  el.id = e.to;
  if (e.type) el.type = e.type;
  el.changedSeq = e.seq;
  if (former.length > 0) el.formerIds = former;
  else delete el.formerIds;
  board.retired = [...board.retired.filter((id) => id !== e.to), e.id];
  remember(board, e.to);
  for (const edge of board.edges) {
    edge.src = follow(edge.src);
    edge.dst = follow(edge.dst);
  }
  for (const note of board.notes) if (note.target !== undefined) note.target = follow(note.target);
  if (board.focus) board.focus = { ...board.focus, ids: board.focus.ids.map(follow) };
  for (const trail of Object.values(board.trails))
    for (const gesture of [...trail.undo, ...trail.redo])
      gesture.inverse = gesture.inverse.map((back) => followed(back, follow));
}

/** An event of a way back, with the element it names under its new id. */
function followed(back: BoardEvent, follow: (id: string) => string): BoardEvent {
  const copy = { ...back };
  const named = copy as Partial<Record<(typeof NAMING)[number], string>>;
  for (const key of NAMING) {
    const id = named[key];
    if (id !== undefined) named[key] = follow(id);
  }
  if (copy.event === "FocusSet") copy.ids = copy.ids.map(follow);
  if (copy.event === "ElementRestored")
    copy.edges = copy.edges.map((edge) => ({ ...edge, src: follow(edge.src), dst: follow(edge.dst) }));
  return copy;
}
