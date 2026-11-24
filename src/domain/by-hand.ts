/**
 * A diagram placed by hand (S344): what `place` and `placing` decide, and the
 * place a card added by hand takes. Read by `decide`; nothing here changes the board.
 *
 * Once by hand, every card has a place of its own, so that a link drawn later
 * moves none. Going back to the links keeps those places for the way back; a
 * card added meanwhile takes, by hand, the place the links gave it.
 */
import { type Command, CommandError } from "./commands.ts";
import type { BoardEvent, Point } from "./events.ts";
import type { Format } from "./formats.ts";
import { requireElement } from "./guards.ts";
import { DEFAULT_LOCALE } from "./i18n.ts";
import { layoutBoard } from "./layout/index.ts";
import type { Board, Element } from "./workspace.ts";

type Placed = Extract<BoardEvent, { event: "ElementPlaced" }>;

export function place(board: Board, format: Format, cmd: Extract<Command, { kind: "place" }>): BoardEvent[] {
  requireDiagram(format);
  const given = new Set(cmd.cards.map((spot) => requireElement(board, spot.id).id));
  const events: BoardEvent[] = board.byHand ? [] : goingByHand(board, given, cmd.span);
  for (const spot of cmd.cards) {
    const el = requireElement(board, spot.id);
    if (el.at?.x !== spot.x || el.at?.y !== spot.y || !board.byHand)
      events.push({ event: "ElementPlaced", board: board.id, id: el.id, at: { x: spot.x, y: spot.y } });
  }
  return events;
}

export function placing(
  board: Board,
  format: Format,
  cmd: Extract<Command, { kind: "placing" }>,
): BoardEvent[] {
  requireDiagram(format);
  if ((board.byHand === true) === cmd.byHand) return [];
  return cmd.byHand
    ? goingByHand(board, new Set(), cmd.span)
    : [{ event: "BoardPlacing", board: board.id, byHand: false }];
}

/** Where a card added by hand goes: under the card it comes from, at the first free place. */
export function placeAdded(board: Board, added: Element, from?: string): Placed | undefined {
  if (!board.byHand) return undefined;
  const edges = from ? [...board.edges, { src: from, dst: added.id, by: added.by }] : board.edges;
  const scene = layoutBoard({ ...board, elements: [...board.elements, added], edges });
  const card = scene.cards.find((c) => c.id === added.id);
  return card && { event: "ElementPlaced", board: board.id, id: added.id, at: whole(card) };
}

/**
 * The board goes by hand: each card with no place of its own, but those `given`, takes the one the
 * links give it, on a board `span` wide when the page says how wide it shows it.
 */
function goingByHand(board: Board, given: ReadonlySet<string>, span?: number): BoardEvent[] {
  const drawn = layoutBoard(board, DEFAULT_LOCALE, span);
  const placed: Placed[] = drawn.cards
    .filter((c) => !given.has(c.id) && !board.elements.find((e) => e.id === c.id)?.at)
    .map((c) => ({ event: "ElementPlaced", board: board.id, id: c.id, at: whole(c), drawn: true }));
  // Every card in place before the switch: a moment of the history between the two would show a Snap half placed.
  return [...placed, { event: "BoardPlacing", board: board.id, byHand: true }];
}

const whole = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

function requireDiagram(format: Format): void {
  if (format.layout !== "graph")
    throw new CommandError(`${format.name.en} boards place their cards themselves: place works on a diagram`);
}
