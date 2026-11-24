/**
 * A diagram placed by hand (S344): each card stands where it was put, and a
 * link is a curve from card to card, since there are no layers left to route
 * along. A card with no place of its own goes under the card it comes from, at
 * the first free place, or under the lowest card when it comes from none.
 */
import type { Board, Element } from "../workspace.ts";
import { nodeHeight } from "./graph.ts";
import { type Card, curve, MARGIN, type Scene } from "./scene.ts";

const GAP_X = 32;
const GAP_Y = 64;
/** Rows and places in a row tried for a card with no place, before it is put under its origin anyway. */
const ROWS = 100;
const PER_ROW = 20;

type CardMaker = (e: Element, x: number, y: number) => Card;

export function layoutByHand(board: Board, drawn: CardMaker): Scene {
  // As tall as the links draw every node of the diagram, so that no card changes size going by hand.
  const h = nodeHeight(board, drawn);
  const card: CardMaker = (e, x, y) => ({ ...drawn(e, x, y), h });
  const placed: Card[] = [];
  for (const e of board.elements) if (e.at) placed.push(card(e, e.at.x, e.at.y));
  for (const e of board.elements) if (!e.at) placed.push(freePlace(board, e, placed, card));
  const byId = new Map(placed.map((c) => [c.id, c]));
  const cards = board.elements.flatMap((e) => byId.get(e.id) ?? []);
  const connectors = board.edges.flatMap((edge) => {
    const a = byId.get(edge.src);
    const b = byId.get(edge.dst);
    return a && b ? [curve(a, b, edge.label)] : [];
  });
  const width = Math.max(MARGIN, ...cards.map((c) => c.x + c.w)) + MARGIN;
  const height = Math.max(MARGIN, ...cards.map((c) => c.y + c.h)) + MARGIN;
  return { width, height, bands: [], cards, connectors };
}

/** Under the card `e` comes from, then on to the right in that row, then the row below: never on a card. */
function freePlace(board: Board, e: Element, placed: readonly Card[], card: CardMaker): Card {
  const origin = board.edges
    .filter((edge) => edge.dst === e.id)
    .map((edge) => placed.find((c) => c.id === edge.src))
    .find((c) => c !== undefined);
  const probe = card(e, 0, 0);
  const x0 = origin ? origin.x : MARGIN;
  const y0 = origin ? origin.y + origin.h + GAP_Y : Math.max(MARGIN, ...placed.map((c) => c.y + c.h + GAP_Y));
  for (let row = 0; row < ROWS; row++) {
    for (let k = 0; k < PER_ROW; k++) {
      const tried = card(e, x0 + k * (probe.w + GAP_X), y0 + row * (probe.h + GAP_Y));
      if (!placed.some((other) => near(tried, other))) return tried;
    }
  }
  return card(e, x0, y0);
}

/** Closer than half a gap: two cards that would touch, or nearly. */
const near = (a: Card, b: Card): boolean =>
  a.x < b.x + b.w + GAP_X / 2 &&
  b.x < a.x + a.w + GAP_X / 2 &&
  a.y < b.y + b.h + GAP_Y / 2 &&
  b.y < a.y + a.h + GAP_Y / 2;
