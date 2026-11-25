/**
 * A on a card, or "Add a linked card" under its ⋯, adds a card linked from it
 * (T272): of the kind it leads to where it leads to one, else of its own kind,
 * just under it in its cell. On a diagram it is the next step.
 */
import { expect, test } from "bun:test";
import { linkedAdd } from "../../src/web/add-linked.ts";
import { FLOW, IMPACT_EFFORT, KANBAN, ORDERING, table } from "../support.ts";

test("on a kanban, a task gets a task under it in its lane, linked from it", () => {
  const t = table(KANBAN);
  // T3 and T4 are in To do: the card goes between them.
  expect(linkedAdd(t.board(), "T3")).toEqual({ type: "task", lane: "todo", before: "T4", from: "T3" });
  expect(linkedAdd(t.board(), "T4")).toEqual({ type: "task", lane: "todo", from: "T4" });
});

test("a story leads to a task: that is what is added, where a task split from it goes", () => {
  const t = table(KANBAN).script('add story "Payer en ligne"');
  expect(linkedAdd(t.board(), "S1")).toEqual({ type: "task", from: "S1" });
});

test("on a timeline, the card goes under it in its step", () => {
  const t = table(ORDERING);
  expect(linkedAdd(t.board(), "E1")).toEqual({ type: "event", col: 1, from: "E1" });
});

test("on a grid, it stays in the cell of the card: below is another cell", () => {
  const t = table(IMPACT_EFFORT);
  expect(linkedAdd(t.board(), "I1")).toEqual({ type: "item", lane: "quick", from: "I1" });
});

test("on a diagram, it is the next step", () => {
  expect(linkedAdd(table(FLOW).board(), "F1")).toEqual({ type: "step", from: "F1" });
});

test("a card that is not there adds nothing", () => {
  expect(linkedAdd(table(KANBAN).board(), "T99")).toBeUndefined();
});

test("what it asks is taken by the board: the card is added and the link made, in one gesture", () => {
  for (const [script, id] of [
    [KANBAN, "T3"],
    [ORDERING, "E1"],
    [IMPACT_EFFORT, "I1"],
  ] as const) {
    const t = table(script);
    const place = linkedAdd(t.board(), id);
    if (!place) throw new Error("no place");
    const before = t.board().elements.length;
    t.do({ kind: "add", board: t.board().id, label: "Liée", ...place }, "human");
    const added = t.board().elements.find((el) => el.label === "Liée");
    expect(t.board().elements.length).toBe(before + 1);
    expect(t.board().edges.some((e) => e.src === id && e.dst === added?.id)).toBe(true);
  }
});
