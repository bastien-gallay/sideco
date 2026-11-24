/**
 * Graph layout: a top-down layered drawing where positions follow the edges.
 *
 * A node's rank is its longest path from the sources, and a rank is drawn as one
 * layer. An edge that climbs back (a loop), or that would cross a box on its way
 * down, runs in a lane of its own to the right of every box. Deterministic: the
 * same board gives the same drawing. Ported from truepath's `layout.py`.
 */
import type { Board, Element } from "../workspace.ts";
import { nameWidth } from "./connector-labels.ts";
import {
  CARD_W,
  type Card,
  type Connector,
  cardHeight,
  labelsHeight,
  MARGIN,
  r,
  type Scene,
} from "./scene.ts";

export const NODE_H = 72;
/** Lines of label a node of `NODE_H` holds. */
export const NODE_LINES = 3;
const GAP_X = 32;
const GAP_Y = 64;
/** Between the layers of relations: room for their names, two lines each, beside one another. */
const RELATION_GAP_Y = 112;
const gapOf = (relations: boolean): number => (relations ? RELATION_GAP_Y : GAP_Y);
const LANE = 16;
const STUB = 4;
const LABEL_GAP = 4;
const CLEARANCE = 6;
/** Between a link and the one that answers it, drawn side by side. */
const PAIR = 12;
/** The fewest layers a column of a folded flow holds. */
const BAND_LAYERS = 4;
/** Between two columns of a folded flow: room for the arrow that climbs from one to the next. */
const GUTTER = 2 * GAP_X;
/** From a rail down to a name's baseline: the text clears the rail and the arrow's head. */
const LABEL_BELOW_RAIL = 16;

type Pair = readonly [string, string];

interface Ranking {
  rank: Map<string, number>;
  back: Set<string>;
}

const key = (a: string, b: string): string => `${a}>${b}`;

/** Each node's longest path from the sources, over the graph without its back edges. */
export function rankNodes(ids: readonly string[], edges: readonly Pair[]): Ranking {
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of edges) succ.get(a)?.push(b);
  const state = new Map<string, "open" | "done">();
  const back = new Set<string>();

  const visit = (n: string): void => {
    state.set(n, "open");
    for (const m of succ.get(n) ?? []) {
      if (state.get(m) === "open") back.add(key(n, m));
      else if (!state.has(m)) visit(m);
    }
    state.set(n, "done");
  };

  const entered = new Set(edges.map(([, b]) => b));
  for (const id of [...ids.filter((i) => !entered.has(i)), ...ids]) {
    if (!state.has(id)) visit(id);
  }

  const forward = edges.filter(([a, b]) => !back.has(key(a, b)));
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let round = 0; round < ids.length; round++) {
    for (const [a, b] of forward) rank.set(b, Math.max(rank.get(b) ?? 0, (rank.get(a) ?? 0) + 1));
  }
  return { rank, back };
}

/**
 * The board as a top-down graph. Given the `span` the board has on screen, a
 * flow too deep for one column folds into columns side by side, read like a
 * newspaper: down one, then on at the top of the next. Without a span, as on
 * paper, it stays one column.
 */
export function layoutGraph(
  board: Board,
  card: (e: Element, x: number, y: number) => Card,
  span?: number,
  relations = false,
): Scene {
  if (board.elements.length === 0)
    return { width: 2 * MARGIN, height: 2 * MARGIN, bands: [], cards: [], connectors: [] };

  const ids = board.elements.map((e) => e.id);
  const pairs: Pair[] = board.edges.map((e) => [e.src, e.dst] as const);
  const { rank, back } = rankNodes(ids, pairs);
  const parents = new Map<string, string[]>(
    ids.map((id) => [id, pairs.filter(([a, b]) => b === id && !back.has(key(a, b))).map(([a]) => a)]),
  );

  const depth = Math.max(...rank.values());
  const layers: string[][] = [];
  for (let level = 0; level <= depth; level++) layers.push(ids.filter((id) => rank.get(id) === level));

  const x = new Map<string, number>();
  // As wide as the format draws its cards: a C4 card is wider than a sticky.
  const width = board.elements[0] ? card(board.elements[0], 0, 0).w : CARD_W;
  placeLayer(layers[0] ?? [], x, () => 0, width);
  const centre = (id: string): number => (x.get(id) ?? 0) + width / 2;
  // Each node under the mean of all its parents, those a few layers up included: a link from
  // far above then comes down on the side its parent stands, not across the other links.
  const wanted = (id: string): number => mean((parents.get(id) ?? []).map(centre));
  for (const layer of layers.slice(1)) {
    layer.sort((a, b) => wanted(a) - wanted(b));
    placeLayer(layer, x, wanted, width);
  }

  const graph: Graph = { board, card, rank, back, layers, x, relations };
  const whole = draw(graph, [[0, depth]]);
  if (span === undefined) return whole;
  // As many columns as the flow allows, each at least BAND_LAYERS deep; fewer while they overflow the window.
  for (let columns = Math.floor(layers.length / BAND_LAYERS); columns > 1; columns--) {
    const bands = fold(graph, columns, pairs);
    if (bands.length < 2) continue;
    const folded = draw(graph, bands);
    if (folded.width <= span) return folded;
  }
  return whole;
}

interface Graph {
  board: Board;
  card: (e: Element, x: number, y: number) => Card;
  rank: Map<string, number>;
  back: Set<string>;
  layers: string[][];
  /** Where each node sits in its layer, before the layers are put down. */
  x: Map<string, number>;
  /** Links are relations: one back along another is its answer. */
  relations: boolean;
}

/** A run of layers drawn as one column: the first and last ranks it holds. */
type Range = readonly [number, number];

/**
 * Cuts the layers into about `columns` runs of equal depth. A cut falls only
 * where one link alone crosses it, into the first layer under the cut, and no
 * loop climbs back over it: that link is the one arrow drawn from a column to
 * the next.
 */
function fold(graph: Graph, columns: number, pairs: readonly Pair[]): Range[] {
  const { rank, back, layers } = graph;
  const level = (id: string): number => rank.get(id) ?? 0;
  const cuttable = (after: number): boolean => {
    const over = pairs.filter(([a, b]) => {
      const [from, to] = back.has(key(a, b)) ? [level(b), level(a)] : [level(a), level(b)];
      return from <= after && to > after;
    });
    const [only] = over;
    return over.length === 1 && only !== undefined && !back.has(key(...only)) && level(only[1]) === after + 1;
  };
  const deep = Math.ceil(layers.length / columns);
  const bands: Range[] = [];
  let first = 0;
  for (let last = 0; last < layers.length - 1; last++) {
    if (last - first + 1 >= deep && cuttable(last)) {
      bands.push([first, last]);
      first = last + 1;
    }
  }
  bands.push([first, layers.length - 1]);
  return bands;
}

/** Puts the columns down left to right, each routed on its own, then the arrows from one to the next. */
function draw(graph: Graph, bands: readonly Range[]): Scene {
  const { board, card, rank, back, layers, x, relations } = graph;
  const folded = bands.length > 1;
  // A folded flow leaves room above for the arrow coming in at the top of a column.
  const gap = gapOf(relations);
  const top = MARGIN + (folded ? gap / 2 : 0);
  const nodeH = nodeHeight(board, card);
  const cards = new Map<string, Card>();
  const band = new Map<string, number>();
  const drawn = new Map<string, Connector>();
  const gutters: number[] = [];
  let origin = MARGIN;
  let reach = MARGIN;
  for (const [k, [from, to]] of bands.entries()) {
    const ids = layers.slice(from, to + 1).flat();
    const left = Math.min(...ids.map((id) => x.get(id) ?? 0));
    const own = new Map<string, Card>();
    for (const e of board.elements.filter((e) => ids.includes(e.id))) {
      const y = top + ((rank.get(e.id) ?? 0) - from) * (nodeH + gap);
      own.set(e.id, { ...card(e, r((x.get(e.id) ?? 0) - left + origin), y), h: nodeH });
      band.set(e.id, k);
    }
    const edges = board.edges.filter((e) => own.has(e.src) && own.has(e.dst));
    const routed = route(edges, own, rank, back, relations);
    for (const c of routed.connectors) drawn.set(key(c.src, c.dst), c);
    for (const [id, c] of own) cards.set(id, c);
    reach = routed.reach;
    gutters.push(reach + GUTTER / 2);
    origin = reach + GUTTER;
  }

  for (const edge of board.edges) {
    const [s, t] = [cards.get(edge.src), cards.get(edge.dst)];
    const k = band.get(edge.src);
    if (!s || !t || k === undefined || band.get(edge.dst) === k) continue;
    drawn.set(key(edge.src, edge.dst), across(edge, s, t, gutters[k] ?? 0, gap));
  }

  const bottom = Math.max(...[...cards.values()].map((c) => c.y + c.h));
  return {
    width: Math.round(reach + MARGIN),
    height: Math.round(bottom + MARGIN + LANE),
    bands: [],
    cards: board.elements.flatMap((e) => cards.get(e.id) ?? []),
    connectors: board.edges.flatMap((e) => drawn.get(key(e.src, e.dst)) ?? []),
  };
}

/**
 * Every node is as tall as the one that says the most under its name (its kind,
 * its description) or above it (a person's head), so the rows stay even.
 */
export function nodeHeight(board: Board, card: Graph["card"]): number {
  const extra = (e: Element): number => {
    const c = card(e, 0, 0);
    return c.h - cardHeight(c.lines.length) - labelsHeight(e.labels);
  };
  return (
    NODE_H +
    Math.max(0, ...board.elements.map(extra)) +
    Math.max(0, ...board.elements.map((e) => labelsHeight(e.labels)))
  );
}

/**
 * The arrow from a column to the next: down under its card, right into the
 * gutter, up it to the top, and down onto the first card of the next column.
 */
function across(edge: Board["edges"][number], s: Card, t: Card, gutter: number, gap: number): Connector {
  const sx = Math.round(s.x + s.w / 2);
  const tx = Math.round(t.x + t.w / 2);
  const rail = Math.round(s.y + s.h + gap / 2);
  const high = Math.round(t.y - gap / 2);
  return {
    src: edge.src,
    dst: edge.dst,
    d: `M${sx} ${Math.round(s.y + s.h)} V${rail} H${r(gutter)} V${high} H${tx} V${Math.round(t.y - STUB)}`,
    label: edge.label,
    labelX: r(tx + CLEARANCE),
    labelY: r(high + LABEL_BELOW_RAIL),
  };
}

/** Left to right at the wanted centres, pushed apart, then shifted back to the wanted mean. */
function placeLayer(
  layer: readonly string[],
  x: Map<string, number>,
  want: (id: string) => number,
  width: number,
): void {
  if (layer.length === 0) return;
  const lefts: number[] = [];
  let right = Number.NEGATIVE_INFINITY;
  for (const id of layer) {
    const at = Math.max(want(id) - width / 2, right + GAP_X);
    lefts.push(at);
    right = at + width;
  }
  const shift = mean(layer.map((id, k) => want(id) - ((lefts[k] ?? 0) + width / 2)));
  layer.forEach((id, k) => {
    x.set(id, (lefts[k] ?? 0) + shift);
  });
}

/** The links of one column; a loop, or a link that would cross a box, in a lane to its right. */
function route(
  edges: Board["edges"],
  cards: Map<string, Card>,
  rank: Map<string, number>,
  back: Set<string>,
  relations: boolean,
): { connectors: Connector[]; reach: number } {
  const all = [...cards.values()];
  const right = Math.max(...all.map((c) => c.x + c.w));
  const gap = gapOf(relations);
  const connectors: Connector[] = [];
  let lanes = 0;
  let reach = right;

  for (const edge of edges) {
    const s = cards.get(edge.src);
    const t = cards.get(edge.dst);
    if (!s || !t) continue;
    const label = edge.label ?? "";
    const from = rank.get(edge.src) ?? 0;
    const to = rank.get(edge.dst) ?? 0;
    const loop = back.has(key(edge.src, edge.dst));
    let d: string;
    let labelAt: Spot;
    if (loop && relations && from - to === 1 && answers(edge, edges)) {
      [d, labelAt] = answer(s, t, gap, label);
    } else if (loop || blocks(all, rank, [from, to], t)) {
      lanes += 1;
      [d, labelAt] = aside(loop, s, t, right + LANE * lanes, gap);
    } else {
      [d, labelAt] = straight(edge, edges, back, s, t, gap);
    }
    // A long name runs past the boxes: the scene widens to keep it whole.
    if (label) reach = Math.max(reach, labelAt[0] + nameWidth(label));
    connectors.push({
      src: edge.src,
      dst: edge.dst,
      d,
      label: edge.label,
      labelX: r(labelAt[0]),
      labelY: r(labelAt[1]),
    });
  }
  return { connectors, reach };
}

type Spot = [number, number];

/**
 * A link in a lane right of every box: a loop, from the side of its card to the side of the
 * one it climbs back to; or a link down that would cross a box, from the foot of its card to
 * the top of the other.
 */
function aside(loop: boolean, s: Card, t: Card, lane: number, gap: number): [string, Spot] {
  if (loop) {
    const sy = Math.round(s.y + s.h / 2);
    const ty = Math.round(t.y + t.h / 2);
    return [
      `M${r(s.x + s.w)} ${sy} H${lane} V${ty} H${r(t.x + t.w + STUB)}`,
      [lane + LABEL_GAP, (sy + ty) / 2],
    ];
  }
  const sx = Math.round(s.x + s.w / 2);
  const tx = Math.round(t.x + t.w / 2);
  const y1 = Math.round(s.y + s.h);
  const rail = Math.round(y1 + gap / 2);
  const low = Math.round(t.y - gap / 2);
  return [
    `M${sx} ${y1} V${rail} H${lane} V${low} H${tx} V${Math.round(t.y - STUB)}`,
    [lane + LABEL_GAP, (rail + low) / 2],
  ];
}

/**
 * The answer to a link one layer down, beside it: shifted away from where that link turns,
 * its rail just under the other one's, the pair never crosses.
 */
function answer(s: Card, t: Card, gap: number, label: string): [string, Spot] {
  const sx = Math.round(s.x + s.w / 2);
  const tx = Math.round(t.x + t.w / 2);
  const turn = Math.sign(sx - tx) || 1;
  const up = sx - turn * PAIR;
  const into = tx - turn * PAIR;
  const mid = Math.round(t.y + t.h + gap / 2 + PAIR);
  const d = `M${up} ${Math.round(s.y)} V${mid} H${into} V${Math.round(t.y + t.h + STUB)}`;
  return [d, [turn > 0 ? up - CLEARANCE - nameWidth(label) : up + CLEARANCE, Math.round(s.y - LABEL_GAP)]];
}

/**
 * A link straight down, named beside the leg only it draws. The last one, as the
 * first is shared by the branches of a decision; the first one when other links come into
 * the same card, since they all draw its last leg; under the rail when both legs are shared.
 */
function straight(
  edge: Board["edges"][number],
  edges: Board["edges"],
  back: Set<string>,
  s: Card,
  t: Card,
  gap: number,
): [string, Spot] {
  const sx = Math.round(s.x + s.w / 2);
  const tx = Math.round(t.x + t.w / 2);
  const y1 = Math.round(s.y + s.h);
  const y2 = Math.round(t.y - STUB);
  const rail = Math.round(y1 + gap / 2);
  const d = sx === tx ? `M${sx} ${y1} V${y2}` : `M${sx} ${y1} V${rail} H${tx} V${y2}`;
  const sharing = (o: Board["edges"][number]): boolean => o !== edge && !back.has(key(o.src, o.dst));
  const merges = sx !== tx && edges.some((o) => sharing(o) && o.dst === edge.dst && o.src !== edge.src);
  const branches = edges.some((o) => sharing(o) && o.src === edge.src && o.dst !== edge.dst);
  if (merges && branches) return [d, [Math.min(sx, tx) + CLEARANCE, rail + LABEL_BELOW_RAIL]];
  if (merges) return [d, [sx + CLEARANCE, y1 + LABEL_BELOW_RAIL]];
  return [d, [tx + CLEARANCE, rail + LABEL_BELOW_RAIL]];
}

/** Whether a link down from layer `from` to `to` would cross a box of the layers between, at the top of `t`. */
function blocks(
  all: readonly Card[],
  rank: Map<string, number>,
  [from, to]: readonly [number, number],
  t: Card,
): boolean {
  const tx = Math.round(t.x + t.w / 2);
  return all.some((c) => {
    const level = rank.get(c.id) ?? 0;
    return level > from && level < to && tx >= c.x - CLEARANCE && tx <= c.x + c.w + CLEARANCE;
  });
}

/** A link that goes back along one coming down: the other half of a call. */
function answers(edge: Board["edges"][number], edges: Board["edges"]): boolean {
  return edges.some((e) => e.src === edge.dst && e.dst === edge.src);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}
