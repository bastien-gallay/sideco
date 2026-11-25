/**
 * A column taller than the window scrolls alone (S306): the page gives the
 * layout the height a column has and how many cards each has scrolled past;
 * the layout lays the cards that fit, and says how many are above and below.
 */
import { describe, expect, test } from "bun:test";
import { layoutBoard, locate } from "../../src/domain/layout/index.ts";
import { reveal, windowOf } from "../../src/domain/layout/lane-window.ts";
import { table } from "../support.ts";

const TALL = `
board new "Long" --format kanban --id long
${Array.from({ length: 9 }, (_, i) => `add task "Carte ${i + 1}" --lane todo`).join("\n")}
add task "Seule" --lane doing
`;
const board = () => table(TALL).board();
const lane = (scene: ReturnType<typeof layoutBoard>, id: string) => {
  const found = scene.bands.find((b) => b.kind === "lane" && b.id === id);
  if (!found) throw new Error(`no lane ${id}`);
  return found;
};
const inLane = (scene: ReturnType<typeof layoutBoard>, ids: string[]) =>
  scene.cards.filter((c) => ids.includes(c.id)).map((c) => c.id);
const TODO = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"];
const view = (skip = 0) => ({
  span: 900,
  folded: new Set<string>(),
  tall: 560,
  skip: new Map([["todo", skip]]),
});

describe("which lines of a column fit its window", () => {
  const heights = [88, 88, 88, 88, 88, 88];
  test("a column that fits is laid whole", () => {
    expect(windowOf(heights, 0, 6 * 98, 10)).toBeUndefined();
  });
  test("a taller one shows the lines that fit from those scrolled past, never fewer than one", () => {
    const cut = windowOf(heights, 0, 400, 10);
    expect(cut).toMatchObject({ from: 0 });
    expect(cut?.to).toBeGreaterThan(1);
    expect(cut?.to).toBeLessThan(6);
    expect(windowOf(heights, 2, 400, 10)?.from).toBe(2);
    expect(windowOf(heights, 0, 10, 10)).toEqual({ from: 0, to: 1 });
  });
  test("scrolled too far, it stops where its last line is at the foot", () => {
    const far = windowOf(heights, 99, 400, 10);
    expect(far?.to).toBe(6);
    expect(windowOf(heights, (far?.from ?? 0) + 1, 400, 10)).toEqual(far);
    expect(windowOf(heights, -3, 400, 10)?.from).toBe(0);
  });
  test("a line is brought back in view by the least scroll", () => {
    expect(reveal(heights, 0, 400, 10, 1)).toBe(0);
    const down = reveal(heights, 0, 400, 10, 5);
    expect(windowOf(heights, down, 400, 10)?.to).toBe(6);
    expect(reveal(heights, 3, 400, 10, 1)).toBe(1);
  });
});

describe("a column taller than the window scrolls alone (S306)", () => {
  test("it lays the cards that fit, says how many are above and below, and is no taller than its window", () => {
    const scene = layoutBoard(board(), "en", view());
    const todo = lane(scene, "todo");
    const shown = inLane(scene, TODO);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown).toEqual(TODO.slice(0, shown.length));
    expect(todo).toMatchObject({ count: 9, above: 0, below: 9 - shown.length });
    expect(todo.h).toBeLessThanOrEqual(560);
    expect(scene.height).toBeLessThanOrEqual(560 + 2 * 24);
    for (const card of scene.cards) expect(card.y + card.h).toBeLessThanOrEqual(todo.y + todo.h);
    // The short column beside it is as tall, and says nothing.
    expect(lane(scene, "doing")).toMatchObject({ h: todo.h, above: 0, below: 0 });
  });

  test("scrolled, it starts further down; too far, it ends on its last card", () => {
    const scene = layoutBoard(board(), "en", view(2));
    expect(lane(scene, "todo")).toMatchObject({ above: 2, skip: 2 });
    expect(inLane(scene, TODO)[0]).toBe("T3");
    const end = layoutBoard(board(), "en", view(99));
    expect(lane(end, "todo").below).toBe(0);
    expect(inLane(end, TODO).at(-1)).toBe("T9");
  });

  test("a card dropped at the foot of the window lands before the first card under it, not at the end", () => {
    const scene = layoutBoard(board(), "en", view());
    const todo = lane(scene, "todo");
    const shown = inLane(scene, TODO);
    const at = locate(board(), todo.x + todo.w / 2, todo.y + todo.h - 4, "T10", view());
    expect(at).toEqual({ kind: "slot", lane: "todo", before: TODO[shown.length] });
    // Scrolled to its end, the foot of the column is its end.
    const foot = locate(board(), todo.x + todo.w / 2, todo.y + todo.h - 4, "T10", view(99));
    expect(foot).toEqual({ kind: "slot", lane: "todo", before: undefined });
  });

  test("without a window, as on paper, every card is laid", () => {
    const scene = layoutBoard(board(), "en", 900);
    expect(inLane(scene, TODO)).toEqual(TODO);
    expect(lane(scene, "todo").above).toBeUndefined();
  });
});
