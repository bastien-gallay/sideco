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

export function layoutGraph(board: Board, card: (e: Element, x: number, y: number) => Card): Scene {
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
  const left = Math.min(...x.values());

  const cards = new Map<string, Card>();
  for (const e of board.elements) {
    const y = MARGIN + (rank.get(e.id) ?? 0) * (NODE_H + GAP_Y);
    cards.set(e.id, { ...card(e, r((x.get(e.id) ?? 0) - left + MARGIN), y), h: NODE_H });
  }

  const { connectors, reach } = route(board, cards, rank, back);
  const bottom = Math.max(...[...cards.values()].map((c) => c.y + c.h));
  return {
    width: Math.round(reach + MARGIN),
    height: Math.round(bottom + MARGIN + LANE),
    bands: [],
    cards: [...cards.values()],
    connectors,
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

function route(
  board: Board,
  cards: Map<string, Card>,
  rank: Map<string, number>,
  back: Set<string>,
): { connectors: Connector[]; reach: number } {
  const all = [...cards.values()];
  const right = Math.max(...all.map((c) => c.x + c.w));
  const connectors: Connector[] = [];
  let lanes = 0;
  let reach = right;

  for (const edge of board.edges) {
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
    let lane: number | undefined;
    if (back.has(key(edge.src, edge.dst))) {
      lanes += 1;
      lane = right + LANE * lanes;
      const sy = Math.round(s.y + s.h / 2);
      const ty = Math.round(t.y + t.h / 2);
      d = `M${r(s.x + s.w)} ${sy} H${lane} V${ty} H${r(t.x + t.w + STUB)}`;
      labelAt = [lane + LABEL_GAP, (sy + ty) / 2];
    } else if (passed.some((c) => tx >= c.x - CLEARANCE && tx <= c.x + c.w + CLEARANCE)) {
      lanes += 1;
      lane = right + LANE * lanes;
      const low = Math.round(t.y - GAP_Y / 2);
      d = `M${sx} ${y1} V${rail} H${lane} V${low} H${tx} V${y2}`;
      labelAt = [lane + LABEL_GAP, (rail + low) / 2];
    } else if (sx === tx) {
      d = `M${sx} ${y1} V${y2}`;
      labelAt = [sx + CLEARANCE, rail];
    } else {
      d = `M${sx} ${y1} V${rail} H${tx} V${y2}`;
      labelAt = [(sx + tx) / 2 - (label.length * LABEL_CHAR_W) / 2, rail - LABEL_GAP];
    }
    if (lane !== undefined)
      reach = Math.max(reach, lane + (label ? LABEL_GAP + label.length * LABEL_CHAR_W : 0));
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
