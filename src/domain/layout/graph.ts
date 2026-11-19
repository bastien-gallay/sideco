/**
 * Graph layout: a top-down layered drawing where positions follow the edges.
 *
 * A node's rank is its longest path from the sources, and a rank is drawn as one
 * layer. An edge that climbs back (a loop), or that would cross a box on its way
 * down, runs in a lane of its own to the right of every box. Deterministic: the
 * same board gives the same drawing. Ported from truepath's `layout.py`.
 */
import type { Board, Element } from "../workspace.ts";
import { CARD_W, type Card, type Connector, MARGIN, r, type Scene } from "./scene.ts";

export const NODE_H = 72;
/** Lines of label a node of `NODE_H` holds. */
export const NODE_LINES = 3;
const GAP_X = 32;
const GAP_Y = 64;
const LANE = 16;
const STUB = 4;
const LABEL_GAP = 4;
const CLEARANCE = 6;
const LABEL_CHAR_W = 6.2;
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
  orderLayers(layers, parents);

  const x = new Map<string, number>();
  placeLayer(layers[0] ?? [], x, () => 0);
  const centre = (id: string): number => (x.get(id) ?? 0) + CARD_W / 2;
  for (const layer of layers.slice(1)) {
    placeLayer(layer, x, (id) => mean((parents.get(id) ?? []).map(centre)));
  }

  const graph: Graph = { board, card, rank, back, layers, x };
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
  const { board, card, rank, back, layers, x } = graph;
  const folded = bands.length > 1;
  // A folded flow leaves room above for the arrow coming in at the top of a column.
  const top = MARGIN + (folded ? GAP_Y / 2 : 0);
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
      const y = top + ((rank.get(e.id) ?? 0) - from) * (NODE_H + GAP_Y);
      own.set(e.id, { ...card(e, r((x.get(e.id) ?? 0) - left + origin), y), h: NODE_H });
      band.set(e.id, k);
    }
    const edges = board.edges.filter((e) => own.has(e.src) && own.has(e.dst));
    const routed = route(edges, own, rank, back);
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
    drawn.set(key(edge.src, edge.dst), across(edge, s, t, gutters[k] ?? 0));
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
 * The arrow from a column to the next: down under its card, right into the
 * gutter, up it to the top, and down onto the first card of the next column.
 */
function across(edge: Board["edges"][number], s: Card, t: Card, gutter: number): Connector {
  const sx = Math.round(s.x + s.w / 2);
  const tx = Math.round(t.x + t.w / 2);
  const rail = Math.round(s.y + s.h + GAP_Y / 2);
  const high = Math.round(t.y - GAP_Y / 2);
  return {
    src: edge.src,
    dst: edge.dst,
    d: `M${sx} ${Math.round(s.y + s.h)} V${rail} H${r(gutter)} V${high} H${tx} V${Math.round(t.y - STUB)}`,
    label: edge.label,
    labelX: r(tx + CLEARANCE),
    labelY: r(high + LABEL_BELOW_RAIL),
  };
}

/** One top-down pass: each node sits under the mean position of its parents in the layer above. */
function orderLayers(layers: string[][], parents: Map<string, string[]>): void {
  for (let level = 1; level < layers.length; level++) {
    const above = new Map((layers[level - 1] ?? []).map((id, k) => [id, k]));
    const wanted = (id: string): number => mean((parents.get(id) ?? []).flatMap((p) => above.get(p) ?? []));
    layers[level]?.sort((a, b) => wanted(a) - wanted(b));
  }
}

/** Left to right at the wanted centres, pushed apart, then shifted back to the wanted mean. */
function placeLayer(layer: readonly string[], x: Map<string, number>, want: (id: string) => number): void {
  if (layer.length === 0) return;
  const lefts: number[] = [];
  let right = Number.NEGATIVE_INFINITY;
  for (const id of layer) {
    const at = Math.max(want(id) - CARD_W / 2, right + GAP_X);
    lefts.push(at);
    right = at + CARD_W;
  }
  const shift = mean(layer.map((id, k) => want(id) - ((lefts[k] ?? 0) + CARD_W / 2)));
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
): { connectors: Connector[]; reach: number } {
  const all = [...cards.values()];
  const right = Math.max(...all.map((c) => c.x + c.w));
  const connectors: Connector[] = [];
  let lanes = 0;
  let reach = right;

  for (const edge of edges) {
    const s = cards.get(edge.src);
    const t = cards.get(edge.dst);
    if (!s || !t) continue;
    const sx = Math.round(s.x + s.w / 2);
    const tx = Math.round(t.x + t.w / 2);
    const y1 = Math.round(s.y + s.h);
    const y2 = Math.round(t.y - STUB);
    const rail = Math.round(y1 + GAP_Y / 2);
    const label = edge.label ?? "";
    const from = rank.get(edge.src) ?? 0;
    const to = rank.get(edge.dst) ?? 0;
    const passed = all.filter((c) => {
      const level = rank.get(c.id) ?? 0;
      return level > from && level < to;
    });

    let d: string;
    let labelAt: [number, number];
    if (back.has(key(edge.src, edge.dst))) {
      lanes += 1;
      const lane = right + LANE * lanes;
      const sy = Math.round(s.y + s.h / 2);
      const ty = Math.round(t.y + t.h / 2);
      d = `M${r(s.x + s.w)} ${sy} H${lane} V${ty} H${r(t.x + t.w + STUB)}`;
      labelAt = [lane + LABEL_GAP, (sy + ty) / 2];
    } else if (passed.some((c) => tx >= c.x - CLEARANCE && tx <= c.x + c.w + CLEARANCE)) {
      lanes += 1;
      const lane = right + LANE * lanes;
      const low = Math.round(t.y - GAP_Y / 2);
      d = `M${sx} ${y1} V${rail} H${lane} V${low} H${tx} V${y2}`;
      labelAt = [lane + LABEL_GAP, (rail + low) / 2];
    } else {
      d = sx === tx ? `M${sx} ${y1} V${y2}` : `M${sx} ${y1} V${rail} H${tx} V${y2}`;
      // Beside the last leg, the one only this link draws: the rail at the top is shared by the
      // branches of a decision, and a name written there reads as another branch's.
      labelAt = [tx + CLEARANCE, rail + LABEL_BELOW_RAIL];
    }
    // A long name runs past the boxes: the scene widens to keep it whole.
    if (label) reach = Math.max(reach, labelAt[0] + label.length * LABEL_CHAR_W);
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

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}
