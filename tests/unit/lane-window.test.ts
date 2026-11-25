/**
 * A column taller than the window scrolls alone (S306): the page gives the
 * layout the height a column has and how many cards each has scrolled past;
 * the layout lays the cards that fit, and says how many are above and below.
 */
import { describe, expect, test } from "bun:test";
import { findFormat } from "../../src/domain/formats.ts";
import { laneWindows } from "../../src/domain/layout/columns.ts";
import { layoutBoard, locate, vacancy } from "../../src/domain/layout/index.ts";
import { cutOf, reveal, windowOf } from "../../src/domain/layout/lane-window.ts";
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

describe("which lines of a column show in its window", () => {
  // Six lines of 88, 10 apart: 578 in all. In 400, the count above keeps 28: 372 show.
  const heights = [88, 88, 88, 88, 88, 88];
  test("a column that fits is laid whole", () => {
    expect(windowOf(heights, 0, 6 * 98, 10)).toBeUndefined();
  });
  test("a taller one shows the lines that reach into its room, the last one cut", () => {
    expect(windowOf(heights, 0, 400, 10)).toEqual({ from: 0, to: 4, at: 0, most: 578 - 372, room: 372 });
    // The fourth line starts at 294: 78 of its 88 show, 10 are cut at the foot.
    expect(cutOf(294, 88, { at: 0, room: 372 })).toEqual({ top: 0, bottom: 10 });
    expect(cutOf(98, 88, { at: 0, room: 372 })).toBeUndefined();
  });
  test("it scrolls by any distance (S354): a line goes out at the head as far as it is scrolled", () => {
    const cut = windowOf(heights, 30, 400, 10);
    expect(cut).toMatchObject({ from: 0, to: 5, at: 30 });
    expect(cutOf(0, 88, { at: 30, room: 372 })).toEqual({ top: 30, bottom: 0 });
    // Scrolled past a whole line, and the gap under it, the line is no longer laid.
    expect(windowOf(heights, 88, 400, 10)?.from).toBe(1);
    expect(windowOf(heights, 97, 400, 10)?.from).toBe(1);
  });
  test("scrolled too far, it stops where its last line is at the foot; never before its head", () => {
    const far = windowOf(heights, 9999, 400, 10);
    expect(far).toMatchObject({ to: 6, at: 578 - 372 });
    expect(windowOf(heights, -3, 400, 10)).toMatchObject({ from: 0, at: 0 });
    expect(windowOf(heights, Number.NaN, 400, 10)).toMatchObject({ from: 0, at: 0 });
  });
  test("a line is brought whole in view by the least scroll", () => {
    expect(reveal(heights, 0, 400, 10, 1)).toBe(0);
    // The last line: its foot at the foot of the room.
    expect(reveal(heights, 0, 400, 10, 5)).toBe(578 - 372);
    // The fourth, cut at the foot: scrolled by what was cut of it.
    expect(reveal(heights, 0, 400, 10, 3)).toBe(10);
    // A line above the window: its head at the head of the room.
    expect(reveal(heights, 200, 400, 10, 1)).toBe(98);
  });
  test("a line far out of view is brought to the middle of the window", () => {
    const long = Array.from({ length: 30 }, () => 88);
    // The twentieth starts at 1862: its middle, 1906, at the middle of the 372 that show.
    expect(reveal(long, 0, 400, 10, 19)).toBe(1906 - 186);
    expect(reveal(long, 2500, 400, 10, 19)).toBe(1906 - 186);
    // Near an end, as far as the column scrolls.
    expect(reveal(long, 2500, 400, 10, 0)).toBe(0);
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
    // What shows of every card is inside the column: the last one is cut at the foot of the window.
    for (const card of scene.cards)
      expect(card.y + card.h - (card.cut?.bottom ?? 0)).toBeLessThanOrEqual(todo.y + todo.h);
    expect(scene.cards.filter((c) => c.cut).map((c) => c.id)).toEqual([shown.at(-1) ?? ""]);
    // The short column beside it is as tall, and says nothing.
    expect(lane(scene, "doing")).toMatchObject({ h: todo.h, above: 0, below: 0 });
  });

  test("scrolled, its cards go up by as much, the first one cut at the head; too far, it ends on its last card", () => {
    const still = layoutBoard(board(), "en", view());
    const scene = layoutBoard(board(), "en", view(30));
    const y = (in_: typeof scene, id: string) => in_.cards.find((c) => c.id === id)?.y ?? 0;
    expect(lane(scene, "todo")).toMatchObject({ above: 0, skip: 30 });
    expect(y(scene, "T2")).toBe(y(still, "T2") - 30);
    expect(scene.cards.find((c) => c.id === "T1")?.cut).toEqual({ top: 30, bottom: 0 });
    const end = layoutBoard(board(), "en", view(99999));
    const todo = lane(end, "todo");
    expect(todo).toMatchObject({ below: 0, skip: todo.most });
    expect(inLane(end, TODO).at(-1)).toBe("T9");
    expect(end.cards.find((c) => c.id === "T9")?.cut).toBeUndefined();
  });

  test("the page is told what each column that scrolls alone shows, and nothing of the others", () => {
    const format = findFormat("kanban");
    if (!format) throw new Error("no kanban");
    const windows = laneWindows(board(), format, view(30));
    expect([...windows.keys()]).toEqual(["todo"]);
    expect(windows.get("todo")).toMatchObject({ above: 0, skip: 30 });
    expect(windows.get("todo")?.most).toBeGreaterThan(30);
  });

  test("a card dropped at the foot of the window lands before the first card under it, not at the end", () => {
    const scene = layoutBoard(board(), "en", view());
    const todo = lane(scene, "todo");
    const shown = inLane(scene, TODO);
    const at = locate(board(), todo.x + todo.w / 2, todo.y + todo.h - 4, "T10", view());
    expect(at).toEqual({ kind: "slot", lane: "todo", before: TODO[shown.length] });
    // Scrolled to its end, the foot of the column is its end.
    const foot = locate(board(), todo.x + todo.w / 2, todo.y + todo.h - 4, "T10", view(99999));
    expect(foot).toEqual({ kind: "slot", lane: "todo", before: undefined });
  });

  test("the free slot of a column that scrolls stays under its window, however far it is scrolled", () => {
    const at = (skip: number) => vacancy(board(), { kind: "slot", lane: "todo" }, view(skip));
    expect(at(0)).toBeDefined();
    expect(at(30)).toEqual(at(0));
    expect(at(100)).toEqual(at(0));
    const todo = lane(layoutBoard(board(), "en", view()), "todo");
    expect((at(0)?.y ?? 0) + (at(0)?.h ?? 0)).toBe(todo.y + todo.h);
  });

  test("without a window, as on paper, every card is laid", () => {
    const scene = layoutBoard(board(), "en", 900);
    expect(inLane(scene, TODO)).toEqual(TODO);
    expect(lane(scene, "todo").above).toBeUndefined();
  });
});
