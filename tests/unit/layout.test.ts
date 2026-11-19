import { describe, expect, test } from "bun:test";
import { rankNodes } from "../../src/domain/layout/graph.ts";
import {
  type Band,
  type Card,
  layoutBoard,
  locate,
  type Scene,
  vacancy,
} from "../../src/domain/layout/index.ts";
import { CARD_H, CARD_MIN_H, CARD_W, cardHeight, wrap } from "../../src/domain/layout/scene.ts";
import { FLOW, IMPACT_EFFORT, KANBAN, ORDERING, table } from "../support.ts";

const card = (scene: Scene, id: string): Card => {
  const found = scene.cards.find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};

const overlaps = (a: Card, b: Card): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

type Box = { x1: number; y1: number; x2: number; y2: number };
type Segment = Box;

/** The room a link's name takes: 11px text, about 6.2px a letter, above its baseline. */
const labelBox = (c: { label?: string; labelX: number; labelY: number }): Box => ({
  x1: c.labelX,
  y1: c.labelY - 9,
  x2: c.labelX + (c.label ?? "").length * 6.2,
  y2: c.labelY + 2,
});

/** The straight segments of a path of M, H and V steps. */
function segments(d: string): Segment[] {
  const out: Segment[] = [];
  const [, mx, my] = /^M([\d.]+) ([\d.]+)/.exec(d) ?? [];
  let x = Number(mx);
  let y = Number(my);
  for (const [, axis, value] of d.matchAll(/([HV])([\d.]+)/g)) {
    const [nx, ny] = axis === "H" ? [Number(value), y] : [x, Number(value)];
    out.push({ x1: Math.min(x, nx), y1: Math.min(y, ny), x2: Math.max(x, nx), y2: Math.max(y, ny) });
    [x, y] = [nx, ny];
  }
  return out;
}

const crosses = (s: Segment, b: Box): boolean => s.x1 <= b.x2 && b.x1 <= s.x2 && s.y1 <= b.y2 && b.y1 <= s.y2;
const near = (s: Segment, b: Box): boolean =>
  crosses(s, { x1: b.x1 - 12, y1: b.y1 - 12, x2: b.x2 + 12, y2: b.y2 + 12 });

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

  test("cuts a word longer than a line, and says so with a hyphen", () => {
    expect(wrap("a".repeat(45), 20, 4)).toEqual([`${"a".repeat(19)}-`, `${"a".repeat(19)}-`, "a".repeat(7)]);
  });

  test("cuts a long word after a slash or a hyphen of its own, when it has one", () => {
    expect(wrap("ajout/modification/suppression des acteurs", 20, 4)).toEqual([
      "ajout/modification/",
      "suppression des",
      "acteurs",
    ]);
    expect(wrap("event-sourced-modelling-board", 20, 4)).toEqual(["event-sourced-", "modelling-board"]);
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

  test("above the rows, a point means the edge between two steps nearest to it: where a column can be inserted", () => {
    const board = table(ORDERING).board();
    const steps = layoutBoard(board).bands.filter((b) => b.kind === "step");
    const [first, second, spare] = steps;
    if (!first || !second || !spare) throw new Error("two steps and a spare one");
    expect(locate(board, second.x + 3, 10)).toEqual({ kind: "boundary", col: 2 });
    expect(locate(board, second.x - 30, 10)).toEqual({ kind: "boundary", col: 2 });
    expect(locate(board, first.x + 20, 10)).toEqual({ kind: "boundary", col: 1 });
    // Past the last step that holds a card, a column would change nothing; nor in the corner over the row names.
    expect(locate(board, spare.x + 2, 10)).toEqual({ kind: "none" });
    expect(locate(board, 10, 10)).toEqual({ kind: "none" });
    expect(locate(table('board new "Vide" --id vide').board(), first.x, 10)).toEqual({ kind: "none" });
    // The edge has no room for a card, but a place to stand: on the rule, as high as the heading.
    expect(vacancy(board, { kind: "boundary", col: 2 })).toEqual({ x: second.x, y: 0, w: 0, h: 32 });
    // Lanes are not steps in time.
    expect(locate(table(KANBAN).board(), 200, 10).kind).not.toBe("boundary");
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

  test("a lane that says what it stands for carries it to the scene, in the reader's language", () => {
    const priorities = table(IMPACT_EFFORT).board();
    const hints = (locale?: "en" | "fr"): (string | undefined)[] =>
      layoutBoard(priorities, locale).bands.map((b) => b.hint);
    expect(hints()).toEqual([
      "High impact · low effort",
      "High impact · high effort",
      "Low impact · low effort",
      "Low impact · high effort",
    ]);
    expect(hints("fr")).toEqual([
      "Impact fort · effort faible",
      "Impact fort · effort fort",
      "Impact faible · effort faible",
      "Impact faible · effort fort",
    ]);
    // A lane whose name says it all, as in a kanban, carries none.
    expect(scene.bands.map((b) => b.hint)).toEqual([undefined, undefined, undefined]);
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

describe("kanban lanes share the width of the window", () => {
  const board = table(KANBAN).board();
  const lanes = (scene: Scene): Band[] => scene.bands.filter((b) => b.kind === "lane");

  test("a wide window: the lanes grow to fill it, and their cards with them", () => {
    const span = 1000;
    const scene = layoutBoard(board, "en", span);
    expectTidy(scene);
    expect(scene.width).toBeLessThanOrEqual(span);
    expect(scene.width).toBeGreaterThan(span - 40);
    const [todo, doing, done] = lanes(scene);
    expect(todo?.w).toBe(doing?.w);
    expect(done?.w).toBe(todo?.w);
    expect(card(scene, "T3").w).toBeGreaterThan(CARD_W);
    // A card spans its lane, with the same margin on either side.
    const t3 = card(scene, "T3");
    expect(t3.x - (todo?.x ?? 0)).toBe((todo?.x ?? 0) + (todo?.w ?? 0) - (t3.x + t3.w));
  });

  test("a wider card says more of its label on a line", () => {
    const long = table(`${KANBAN}\nadd task "Brancher les hooks de session sur le compagnon local"`).board();
    const narrow = card(layoutBoard(long), "T5");
    const wide = card(layoutBoard(long, "en", 1200), "T5");
    expect(wide.lines.length).toBeLessThan(narrow.lines.length);
    expect(wide.h).toBeLessThan(narrow.h);
  });

  test("a very wide window: the lanes stop growing, a line of text stays readable", () => {
    const scene = layoutBoard(board, "en", 4000);
    expect(lanes(scene)[0]?.w).toBeLessThanOrEqual(360);
  });

  test("a narrow window: the lanes give some width back before the last one is cut", () => {
    const span = 600;
    const scene = layoutBoard(board, "en", span);
    expectTidy(scene);
    expect(scene.width).toBeLessThanOrEqual(span);
    expect(card(scene, "T1").w).toBeLessThan(CARD_W);
  });

  test("too narrow for that: the lanes keep a card readable, and the board scrolls", () => {
    const scene = layoutBoard(board, "en", 300);
    expect(card(scene, "T1").w).toBeGreaterThanOrEqual(120);
    expect(scene.width).toBeGreaterThan(300);
  });

  test("a drop and the room to add go by the lanes as drawn", () => {
    const span = 1000;
    const scene = layoutBoard(board, "en", span);
    const t2 = card(scene, "T2");
    // Near the right edge of a widened card: still that card, in its lane.
    expect(locate(board, t2.x + t2.w - 4, t2.y + 4, undefined, span)).toEqual({
      kind: "slot",
      lane: "doing",
      before: "T2",
    });
    const room = vacancy(board, { kind: "slot", lane: "doing" }, span);
    expect(room?.x).toBe(t2.x);
    expect(room?.w).toBe(t2.w);
  });

  test("the plan of impact and effort keeps its cells as they are", () => {
    const priorities = table(IMPACT_EFFORT).board();
    expect(layoutBoard(priorities, "en", 2000)).toEqual(layoutBoard(priorities));
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

  test("a branch's name sits beside its own arrow, never on another one", () => {
    const fan = layoutBoard(
      table(
        'board new "Q" --format flow --id q\nadd decision "Q ?"\n' +
          'add step "A" --from D1 --edge oui\nadd step "B" --from D1 --edge non\n' +
          'add step "C" --from D1 --edge "peut-être"',
      ).board(),
    );
    for (const scene of [fan, layoutBoard(table(FLOW).board())]) {
      for (const c of scene.connectors.filter((c) => c.label)) {
        const box = labelBox(c);
        for (const other of scene.connectors.filter((o) => o !== c)) {
          expect(segments(other.d).some((s) => crosses(s, box))).toBe(false);
        }
        expect(segments(c.d).some((s) => near(s, box))).toBe(true);
      }
    }
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

describe("a long flow folds into columns side by side, when the window is wide", () => {
  const CHAIN = [
    'board new "Chaîne" --format flow --id chaine',
    'add step "Étape 1"',
    ...Array.from({ length: 14 }, (_, i) => `add step "Étape ${i + 2}" --from S${i + 1}`),
  ].join("\n");
  const chain = table(CHAIN).board();
  const inside = (s: Segment, c: Card): boolean =>
    s.x1 < c.x + c.w && c.x < s.x2 && s.y1 < c.y + c.h && c.y < s.y2;

  test("on paper, without a window, the chain stays one column", () => {
    expect(new Set(layoutBoard(chain).cards.map((c) => c.x)).size).toBe(1);
  });

  test("in a wide window, it reads down a column then on at the top of the next", () => {
    const scene = layoutBoard(chain, "en", 900);
    expectTidy(scene);
    expect(scene.width).toBeLessThanOrEqual(900);
    expect(scene.height).toBeLessThan(layoutBoard(chain).height / 2);
    const xs = [...new Set(scene.cards.map((c) => c.x))];
    expect(xs.length).toBeGreaterThan(1);
    // Down a column, then on to the right, at the top again.
    for (let i = 1; i < 15; i++) {
      const [a, b] = [card(scene, `S${i}`), card(scene, `S${i + 1}`)];
      if (a.x === b.x) expect(b.y).toBeGreaterThan(a.y);
      else {
        expect(b.x).toBeGreaterThan(a.x);
        expect(b.y).toBe(card(scene, "S1").y);
      }
    }
  });

  test("every link still runs from its card to the next without crossing a card", () => {
    const scene = layoutBoard(chain, "en", 900);
    expect(scene.connectors).toHaveLength(14);
    for (const c of scene.connectors) {
      expect(c.d).toMatch(/^M[\d.]+ [\d.]+( [HV][\d.]+)+$/);
      const others = scene.cards.filter((card) => card.id !== c.src && card.id !== c.dst);
      for (const s of segments(c.d)) for (const other of others) expect(inside(s, other)).toBe(false);
      const [first, last] = [segments(c.d)[0], segments(c.d).at(-1)];
      const [from, to] = [card(scene, c.src), card(scene, c.dst)];
      expect(first?.y1).toBe(from.y + from.h);
      expect(last?.y2).toBeGreaterThanOrEqual(to.y - 4);
    }
  });

  test("a narrow window, or a short flow, is left as it is", () => {
    expect(new Set(layoutBoard(chain, "en", 300).cards.map((c) => c.x)).size).toBe(1);
    expect(layoutBoard(table(FLOW).board(), "en", 1400)).toEqual(layoutBoard(table(FLOW).board()));
  });

  test("a loop back over a fold would cross the columns: the flow is not folded there", () => {
    const looped = table(`${CHAIN}\nlink S15 S1 "encore"`).board();
    expect(new Set(layoutBoard(looped, "en", 900).cards.map((c) => c.x)).size).toBe(1);
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
    label: "Quand commande passée, réserver le stock",
    tip: "P1 · Policy · added by Claude",
    detail: "Règle n°4",
  });
  expect(card(scene, "H2")).toMatchObject({ by: "human", shape: "sharp", hasDetail: false, notes: 0 });
});

describe("impact / effort is a plan of two by two cells", () => {
  const GRID = `${IMPACT_EFFORT}
add item "Marquer fait" --lane quick
add item "Trois de front ?" --lane quick
add item "Jamais" --lane avoid`;
  const board = table(GRID).board();
  const scene = layoutBoard(board, "fr");
  const lane = (id: string): Band => {
    const band = scene.bands.find((b) => b.kind === "lane" && b.id === id);
    if (!band) throw new Error(`no lane ${id}`);
    return band;
  };
  const cardOf = (id: string): Card => {
    const card = scene.cards.find((c) => c.id === id);
    if (!card) throw new Error(`no card ${id}`);
    return card;
  };

  test("high impact on top, low effort on the left: the four lanes keep their names and take a cell each", () => {
    const [quick, bet, fill, avoid] = ["quick", "bet", "fill", "avoid"].map(lane);
    if (!quick || !bet || !fill || !avoid) throw new Error("four lanes");
    expect(bet.y).toBe(quick.y);
    expect(bet.x).toBeGreaterThanOrEqual(quick.x + quick.w);
    expect(fill.x).toBe(quick.x);
    expect(fill.y).toBeGreaterThanOrEqual(quick.y + quick.h);
    expect([avoid.x, avoid.y]).toEqual([bet.x, fill.y]);
    // Cells of a row are as tall as each other, cells of a column as wide.
    expect([bet.h, avoid.h, fill.w, bet.w]).toEqual([quick.h, fill.h, quick.w, quick.w]);
    expect(quick.count).toBe(3);
  });

  test("the two axes are named beside the plan, outside the cells", () => {
    const axes = scene.bands.filter((b) => b.kind === "axis");
    expect(axes.map((b) => `${b.id} ${b.label}`)).toEqual(["y Impact", "x Effort"]);
    const [y, x] = axes;
    if (!y || !x) throw new Error("two axes");
    expect(y.x + y.w).toBeLessThanOrEqual(lane("quick").x);
    expect(x.y).toBeGreaterThanOrEqual(lane("fill").y + lane("fill").h);
    expect(scene.height).toBeGreaterThanOrEqual(x.y + x.h);
    expect(layoutBoard(table(KANBAN).board()).bands.filter((b) => b.kind === "axis")).toEqual([]);
  });

  test("cards sit two abreast in a cell, the third below, none outside its cell or over another", () => {
    const [first, second, third] = ["I1", "I4", "I5"].map(cardOf);
    if (!first || !second || !third) throw new Error("three cards");
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.w);
    expect(third.x).toBe(first.x);
    expect(third.y).toBeGreaterThanOrEqual(first.y + first.h);
    for (const e of board.elements) {
      const c = cardOf(e.id);
      const cell = lane(e.lane);
      expect(c.x).toBeGreaterThanOrEqual(cell.x);
      expect(c.x + c.w).toBeLessThanOrEqual(cell.x + cell.w);
      expect(c.y + c.h).toBeLessThanOrEqual(cell.y + cell.h);
    }
  });

  test("a point in a cell is a place in its order: before the card whose left half it is on", () => {
    const [first, second, third] = ["I1", "I4", "I5"].map(cardOf);
    if (!first || !second || !third) throw new Error("three cards");
    expect(locate(board, second.x + 10, second.y + 10)).toEqual({
      kind: "slot",
      lane: "quick",
      before: "I4",
    });
    expect(locate(board, second.x + second.w - 10, second.y + 10)).toEqual({
      kind: "slot",
      lane: "quick",
      before: "I5",
    });
    expect(locate(board, first.x + 10, first.y + 10)).toEqual({ kind: "slot", lane: "quick", before: "I1" });
    expect(locate(board, third.x + third.w + 40, third.y + 10)).toEqual({ kind: "slot", lane: "quick" });
    const avoid = lane("avoid");
    expect(locate(board, avoid.x + 20, avoid.y + avoid.h - 10)).toEqual({ kind: "slot", lane: "avoid" });
    // The card in the hand does not count.
    expect(locate(board, second.x + 10, second.y + 10, "I4")).toEqual({
      kind: "slot",
      lane: "quick",
      before: "I5",
    });
  });

  test("the free room of a cell is the next place in it: beside the last card, or under a full row", () => {
    const [, second, third] = ["I1", "I4", "I5"].map(cardOf);
    const only = cardOf("I2");
    if (!second || !third) throw new Error("three cards");
    const beside = vacancy(board, { kind: "slot", lane: "bet" });
    expect(beside).toMatchObject({ x: only.x + CARD_W + 12, y: only.y, w: CARD_W });
    const under = vacancy(board, { kind: "slot", lane: "quick" });
    expect(under).toMatchObject({ x: second.x, y: third.y, w: CARD_W });
    const cell = lane("quick");
    expect((under?.y ?? 0) + (under?.h ?? 0)).toBeLessThanOrEqual(cell.y + cell.h);
  });
});
