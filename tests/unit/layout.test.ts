import { describe, expect, test } from "bun:test";
import { rankNodes } from "../../src/domain/layout/graph.ts";
import { type Card, layoutBoard, locate, type Scene, vacancy } from "../../src/domain/layout/index.ts";
import { CARD_H, CARD_MIN_H, CARD_W, cardHeight, wrap } from "../../src/domain/layout/scene.ts";
import { FLOW, KANBAN, ORDERING, table } from "../support.ts";

const card = (scene: Scene, id: string): Card => {
  const found = scene.cards.find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};

const overlaps = (a: Card, b: Card): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectTidy(scene: Scene): void {
  for (const [i, a] of scene.cards.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(scene.width);
    expect(a.y + a.h).toBeLessThanOrEqual(scene.height);
    for (const b of scene.cards.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
  }
}

describe("wrap", () => {
  test("breaks on spaces within the width", () => {
    expect(wrap("Quand commande passée, réserver le stock", 20, 4)).toEqual([
      "Quand commande",
      "passée, réserver le",
      "stock",
    ]);
  });

  test("cuts a word longer than a line", () => {
    expect(wrap("a".repeat(45), 20, 4)).toEqual(["a".repeat(20), "a".repeat(20), "a".repeat(5)]);
  });

  test("ends with an ellipsis when the label does not fit", () => {
    const lines = wrap("un deux trois quatre cinq six sept huit neuf dix", 10, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(10);
  });

  test("an empty label is one empty line", () => {
    expect(wrap("")).toEqual([""]);
  });
});

describe("timeline layout", () => {
  const board = table(ORDERING).board();
  const scene = layoutBoard(board);

  test("cards fit in the scene and never overlap", () => expectTidy(scene));

  test("one row per type, in the format's order, and one more column than is used", () => {
    expect(scene.bands.filter((b) => b.kind === "row").map((b) => b.id)).toEqual([
      "actor",
      "command",
      "aggregate",
      "event",
      "policy",
      "readmodel",
      "system",
      "hotspot",
    ]);
    expect(scene.bands.filter((b) => b.kind === "step").map((b) => b.label)).toEqual(["1", "2", "3"]);
  });

  test("the same column means the same x; a later column is to the right", () => {
    expect(card(scene, "C1").x).toBe(card(scene, "E1").x);
    expect(card(scene, "E2").x).toBeGreaterThan(card(scene, "E1").x);
  });

  test("the same type means the same row", () => {
    expect(card(scene, "E1").y).toBe(card(scene, "E2").y);
    expect(card(scene, "C1").y).toBeLessThan(card(scene, "E1").y);
  });

  test("two elements in one cell stack, and the row grows to hold them", () => {
    const stacked = layoutBoard(table(ORDERING).script('add event "Stock insuffisant" --col 2').board());
    expect(card(stacked, "E3").x).toBe(card(stacked, "E2").x);
    expect(card(stacked, "E3").y).toBeGreaterThanOrEqual(card(stacked, "E2").y + card(stacked, "E2").h);
    expect(card(stacked, "P1").y).toBeGreaterThan(card(scene, "P1").y);
    expectTidy(stacked);
  });

  test("links become connectors between the cards they name", () => {
    expect(scene.connectors.map((c) => `${c.src}>${c.dst}`)).toEqual(["C1>E1", "E1>P1"]);
    expect(scene.connectors.every((c) => c.d.startsWith("M"))).toBe(true);
  });

  test("a point on a card locates that card's cell; the spare column is a valid target", () => {
    const e2 = card(scene, "E2");
    expect(locate(board, e2.x + CARD_W / 2, e2.y + CARD_H / 2)).toEqual({
      kind: "cell",
      col: 2,
      type: "event",
    });
    expect(locate(board, e2.x + CARD_W / 2 + 176, e2.y + 10)).toEqual({
      kind: "cell",
      col: 3,
      type: "event",
    });
    expect(locate(board, 10, e2.y + 10)).toEqual({ kind: "none" });
    expect(locate(board, e2.x, scene.height + 500)).toEqual({ kind: "none" });
  });

  test("an empty board still shows its rows and a first column to drop into", () => {
    const empty = table('board new "Vide" --id vide').board();
    const blank = layoutBoard(empty);
    expect(blank.bands.filter((b) => b.kind === "step")).toHaveLength(1);
    expect(blank.bands.filter((b) => b.kind === "row")).toHaveLength(8);
    const row = blank.bands.find((b) => b.kind === "row" && b.id === "event");
    expect(locate(empty, 200, (row?.y ?? 0) + 5)).toEqual({ kind: "cell", col: 1, type: "event" });
  });
});

describe("a card is as tall as its label", () => {
  const LONG = "Un libellé long qui prend bien quatre lignes entières sur la carte";

  test("from one line to four: nothing is cut, nothing is padded", () => {
    expect([1, 2, 3, 4].map(cardHeight)).toEqual([48, 56, 72, 88]);
    expect([cardHeight(1), cardHeight(4)]).toEqual([CARD_MIN_H, CARD_H]);
    const scene = layoutBoard(table(KANBAN).script(`add task "${LONG}"`).board());
    expect(card(scene, "T1")).toMatchObject({ lines: ["Écrire le PRD"], h: 48 });
    expect(card(scene, "T3")).toMatchObject({ lines: ["Tester de bout en", "bout"], h: 56 });
    expect(card(scene, "T5").lines).toHaveLength(4);
    expect(card(scene, "T5").h).toBe(88);
  });

  test("in a lane, each card sits right under the one before, tall or short", () => {
    const board = table(KANBAN).script(`add task "${LONG}"\nadd task "Court"`).board();
    const scene = layoutBoard(board);
    const [t3, t4, t5, t6] = ["T3", "T4", "T5", "T6"].map((id) => card(scene, id));
    if (!t3 || !t4 || !t5 || !t6) throw new Error("missing card");
    const gap = t4.y - (t3.y + t3.h);
    expect(gap).toBeGreaterThan(0);
    expect(t5.y - (t4.y + t4.h)).toBe(gap);
    expect(t6.y - (t5.y + t5.h)).toBe(gap);
    const lane = scene.bands.find((b) => b.id === "todo");
    expect((lane?.y ?? 0) + (lane?.h ?? 0)).toBeGreaterThan(t6.y + t6.h);
    expectTidy(scene);
    // A drop lands before the card under the pointer, whatever the heights above it.
    for (const c of [t3, t4, t5, t6]) {
      expect(locate(board, c.x + 10, c.y + 4)).toEqual({ kind: "slot", lane: "todo", before: c.id });
    }
    expect(locate(board, t6.x + 10, t6.y + t6.h + 40)).toMatchObject({ lane: "todo", before: undefined });
  });

  test("in a timeline, a row is as tall as its tallest cell", () => {
    const board = table(ORDERING).script(`add event "${LONG}" --col 2`).board();
    const scene = layoutBoard(board);
    const row = (id: string): number => scene.bands.find((b) => b.kind === "row" && b.id === id)?.h ?? 0;
    // Commands are one-liners; the events of step 2 are a short card above a tall one.
    expect(row("command")).toBe(card(scene, "C1").h + 24);
    const [e2, e3] = [card(scene, "E2"), card(scene, "E3")];
    expect([e2.h, e3.h]).toEqual([48, 88]);
    expect(e3.y).toBeGreaterThan(e2.y + e2.h);
    expect(row("event")).toBe(e3.y + e3.h - e2.y + 24);
    expectTidy(scene);
    expect(locate(board, e3.x + 10, e3.y + e3.h - 2)).toEqual({ kind: "cell", col: 2, type: "event" });
  });

  test("a flow keeps nodes of one height, so that its links stay level", () => {
    const scene = layoutBoard(table(FLOW).board());
    expect(new Set(scene.cards.map((c) => c.h)).size).toBe(1);
  });
});

describe("the room to add a card, where the pointer is", () => {
  test("in a lane: under its last card, down to the foot of the lane", () => {
    const board = table(KANBAN).board();
    const scene = layoutBoard(board);
    const lane = scene.bands.find((b) => b.id === "todo");
    const last = card(scene, "T4");
    const room = vacancy(board, { kind: "slot", lane: "todo", before: "T3" });
    expect(room).toEqual({
      x: last.x,
      y: last.y + last.h,
      w: CARD_W,
      h: (lane?.y ?? 0) + (lane?.h ?? 0) - (last.y + last.h),
    });
    // There is always room for a card there: the lane grows with its stack.
    expect(room?.h).toBeGreaterThanOrEqual(CARD_H);
  });

  test("in an empty lane: under its header", () => {
    const board = table('board new "Vide" --format kanban --id vide').board();
    const lane = layoutBoard(board).bands.find((b) => b.id === "doing");
    const room = vacancy(board, { kind: "slot", lane: "doing" });
    expect(room?.x).toBe((lane?.x ?? 0) + ((lane?.w ?? 0) - CARD_W) / 2);
    expect(room?.y).toBeGreaterThan(lane?.y ?? 0);
    expect((room?.y ?? 0) + (room?.h ?? 0)).toBe((lane?.y ?? 0) + (lane?.h ?? 0));
  });

  test("in a timeline cell: under its stack, down to the foot of the row", () => {
    const board = table(ORDERING).script('add event "Stock insuffisant" --col 1').board();
    const scene = layoutBoard(board);
    const row = scene.bands.find((b) => b.kind === "row" && b.id === "event");
    const foot = (row?.y ?? 0) + (row?.h ?? 0);
    // Step 2 holds one event where step 1 holds two: the room is what the row leaves under it.
    const e2 = card(scene, "E2");
    expect(vacancy(board, { kind: "cell", col: 2, type: "event" })).toEqual({
      x: e2.x,
      y: e2.y + e2.h,
      w: CARD_W,
      h: foot - (e2.y + e2.h),
    });
    // The fullest cell of the row keeps the padding of the row, no more.
    const e3 = card(scene, "E3");
    expect(vacancy(board, { kind: "cell", col: 1, type: "event" })).toEqual({
      x: e3.x,
      y: e3.y + e3.h,
      w: CARD_W,
      h: foot - (e3.y + e3.h),
    });
    expect(foot - (e3.y + e3.h)).toBeGreaterThan(0);
  });

  test("in an empty cell: the whole height of the row, the spare column included", () => {
    const board = table(ORDERING).board();
    const scene = layoutBoard(board);
    const row = scene.bands.find((b) => b.kind === "row" && b.id === "readmodel");
    const spare = scene.bands.filter((b) => b.kind === "step").at(-1);
    expect(vacancy(board, { kind: "cell", col: Number(spare?.id), type: "readmodel" })).toEqual({
      x: (spare?.x ?? 0) + ((spare?.w ?? 0) - CARD_W) / 2,
      y: row?.y ?? -1,
      w: CARD_W,
      h: row?.h ?? -1,
    });
  });

  test("nowhere else: off the board, in a row that does not exist, on a flow", () => {
    const board = table(ORDERING).board();
    expect(vacancy(board, { kind: "none" })).toBeUndefined();
    expect(vacancy(board, { kind: "cell", col: 1, type: "nope" })).toBeUndefined();
    expect(vacancy(board, { kind: "slot", lane: "todo" })).toBeUndefined();
    expect(vacancy(table(FLOW).board(), { kind: "cell", col: 1, type: "step" })).toBeUndefined();
  });
});

describe("columns layout", () => {
  const board = table(KANBAN).board();
  const scene = layoutBoard(board);

  test("cards fit in the scene and never overlap", () => expectTidy(scene));

  test("one lane per column, with its count", () => {
    expect(scene.bands.map((b) => `${b.id}:${b.count}`)).toEqual(["todo:2", "doing:2", "done:1"]);
  });

  test("cards stack in board order inside their lane", () => {
    expect(card(scene, "T3").x).toBe(card(scene, "T4").x);
    expect(card(scene, "T4").y).toBeGreaterThan(card(scene, "T3").y);
    expect(card(scene, "T2").x).toBeGreaterThan(card(scene, "T3").x);
  });

  test("a drop lands before the card under it, or at the end below the stack", () => {
    const t3 = card(scene, "T3");
    const t4 = card(scene, "T4");
    expect(locate(board, t3.x + 10, t3.y + 4)).toEqual({ kind: "slot", lane: "todo", before: "T3" });
    expect(locate(board, t4.x + 10, t4.y + 4)).toEqual({ kind: "slot", lane: "todo", before: "T4" });
    expect(locate(board, t4.x + 10, t4.y + 3 * CARD_H)).toEqual({
      kind: "slot",
      lane: "todo",
      before: undefined,
    });
  });

  test("the card being dragged does not count as a neighbour", () => {
    const t3 = card(scene, "T3");
    expect(locate(board, t3.x + 10, t3.y + 4, "T3")).toEqual({ kind: "slot", lane: "todo", before: "T4" });
  });

  test("outside every lane is nowhere", () => {
    expect(locate(board, scene.width + 50, 100)).toEqual({ kind: "none" });
  });
});

describe("graph layout", () => {
  const board = table(FLOW).board();
  const scene = layoutBoard(board);

  test("cards fit in the scene and never overlap", () => expectTidy(scene));

  test("a node sits below everything that leads to it", () => {
    const y = (id: string): number => card(scene, id).y;
    expect(y("S1")).toBeLessThan(y("D1"));
    expect(y("D1")).toBeLessThan(y("S2"));
    expect(y("S2")).toBe(y("S3"));
    expect(y("S2")).toBeLessThan(y("O1"));
  });

  test("a loop is a back edge: it does not push its target down", () => {
    const { rank, back } = rankNodes(
      ["S1", "D1", "S3"],
      [
        ["S1", "D1"],
        ["D1", "S3"],
        ["S3", "D1"],
      ],
    );
    expect([...back]).toEqual(["S3>D1"]);
    expect(Object.fromEntries(rank)).toEqual({ S1: 0, D1: 1, S3: 2 });
  });

  test("every link is drawn, with straight segments only", () => {
    expect(scene.connectors).toHaveLength(board.edges.length);
    for (const c of scene.connectors) expect(c.d).toMatch(/^M[\d.]+ [\d.]+( [HV][\d.]+)+$/);
  });

  test("the back edge runs to the right of every box", () => {
    const loop = scene.connectors.find((c) => c.src === "S3" && c.dst === "D1");
    const right = Math.max(...scene.cards.map((c) => c.x + c.w));
    const lane = Number(/H([\d.]+)/.exec(loop?.d ?? "")?.[1]);
    expect(lane).toBeGreaterThan(right);
    expect(scene.width).toBeGreaterThan(lane);
  });

  test("an empty graph is a small empty scene", () => {
    expect(layoutBoard(table('board new "Vide" --format flow --id vide').board()).cards).toEqual([]);
  });

  test("unlinked nodes share the first layer without overlapping", () => {
    const loose = layoutBoard(
      table('board new "X" --format flow --id x\nadd step "A"\nadd step "B"\nadd step "C"').board(),
    );
    expect(new Set(loose.cards.map((c) => c.y)).size).toBe(1);
    expectTidy(loose);
  });
});

test("the same board always gives the same scene", () => {
  for (const script of [ORDERING, KANBAN, FLOW]) {
    expect(layoutBoard(table(script).board())).toEqual(layoutBoard(table(script).board()));
  }
});

test("a card carries what the painter needs: colours, author, detail and open notes", () => {
  const t = table(ORDERING).script('detail P1 "Règle n°4"');
  t.do({ kind: "note", board: "commande", text: "Qui ?", target: "P1" }, "human");
  t.do({ kind: "note", board: "commande", text: "Résolue", target: "P1" }, "human");
  t.script("resolve N2");
  // A card counts its open discussions, not every message in them.
  t.script('reply N1 "Toi"');
  t.do({ kind: "add", board: "commande", type: "hotspot", label: "Doute", col: 1 }, "human");
  const scene = layoutBoard(t.board());
  expect(card(scene, "P1")).toMatchObject({
    fill: "#C39BD3",
    by: "agent",
    hasDetail: true,
    notes: 1,
    tip: "P1 · Policy · added by Claude",
  });
  expect(card(scene, "H2")).toMatchObject({ by: "human", shape: "sharp", hasDetail: false, notes: 0 });
});
