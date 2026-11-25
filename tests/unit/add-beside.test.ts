/**
 * Alt and an arrow on a focused card add a card of its kind beside it, where
 * the arrow points: the next step or lane, or just above or below it in its
 * cell. `add … --before ID` is what places it there, in one gesture.
 */
import { describe, expect, test } from "bun:test";
import { describeChanges } from "../../src/domain/digest.ts";
import { keyAdd } from "../../src/web/view.ts";
import { FLOW, IMPACT_EFFORT, KANBAN, ORDERING, type Table, table } from "../support.ts";

const ids = (t: Table, keep: (el: { type: string; col: number; lane: string }) => boolean): string[] =>
  t
    .board()
    .elements.filter(keep)
    .map((el) => el.id);

describe("`add … --before ID` places the new card before another one of its cell", () => {
  test("in a lane", () => {
    const t = table(KANBAN).script('add task "Relire" --lane todo --before T3');
    expect(ids(t, (el) => el.lane === "todo")).toEqual(["T5", "T3", "T4"]);
  });

  test("in a cell of a timeline, which says the column when none is named", () => {
    const t = table(ORDERING).script('add event "Facture émise" --before E1');
    expect(ids(t, (el) => el.type === "event" && el.col === 1)).toEqual(["E3", "E1"]);
  });

  test("the card named must share the cell", () => {
    const t = table(ORDERING);
    expect(() => t.script('add event "Ailleurs" --col 2 --before E1')).toThrow("E1 is not in column 2");
    expect(() => t.script('add command "Pas là" --before E1')).toThrow("E1 is a event, not a command");
    expect(() => table(KANBAN).script('add task "Pas là" --lane doing --before T3')).toThrow(
      'T3 is not in column "doing"',
    );
    expect(() => table(FLOW).script('add step "Où ?" --before F1')).toThrow("link or unlink instead");
  });

  test("one undo takes the card back, and the agent reads one addition", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    t.script('add task "Relire" --lane todo --before T3', "human");
    expect(describeChanges(t.events, mark).text).toBe(
      'board sprint "Sprint 12"\n  + T5 task "Relire" (lane todo)',
    );
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(ids(t, (el) => el.lane === "todo")).toEqual(["T3", "T4"]);
  });
});

describe("Alt and an arrow say where the new card goes, by the board's own rules", () => {
  test("on a timeline, left and right: the step beside it, never before the first", () => {
    const board = table(ORDERING).board();
    expect(keyAdd(board, "C1", "right")).toEqual({ type: "command", col: 2 });
    expect(keyAdd(board, "C2", "right")).toEqual({ type: "command", col: 3 });
    expect(keyAdd(board, "C2", "left")).toEqual({ type: "command", col: 1 });
    expect(keyAdd(board, "C1", "left")).toBeUndefined();
  });

  test("on a timeline, up and down: just above or below it, in its cell", () => {
    const t = table(ORDERING).script('add event "Facture émise" --col 1');
    const board = t.board();
    // Column 1 holds E1 then E3 in the event row.
    expect(keyAdd(board, "E1", "up")).toEqual({ type: "event", col: 1, before: "E1" });
    expect(keyAdd(board, "E1", "down")).toEqual({ type: "event", col: 1, before: "E3" });
    expect(keyAdd(board, "E3", "down")).toEqual({ type: "event", col: 1 });
  });

  test("on a kanban, left and right: the lane beside it; up and down: its place in the lane", () => {
    const board = table(KANBAN).board();
    // To do holds T3 then T4; Doing holds T2 and B1; Done holds T1.
    expect(keyAdd(board, "T3", "right")).toEqual({ type: "task", lane: "doing" });
    expect(keyAdd(board, "T2", "left")).toEqual({ type: "task", lane: "todo" });
    expect(keyAdd(board, "T3", "left")).toBeUndefined();
    expect(keyAdd(board, "T1", "right")).toBeUndefined();
    expect(keyAdd(board, "T4", "up")).toEqual({ type: "task", lane: "todo", before: "T4" });
    expect(keyAdd(board, "T3", "down")).toEqual({ type: "task", lane: "todo", before: "T4" });
    expect(keyAdd(board, "T4", "down")).toEqual({ type: "task", lane: "todo" });
    expect(keyAdd(board, "B1", "right")).toEqual({ type: "blocker", lane: "done" });
  });

  test("on a plan, the cell the arrow points to, never off the plan", () => {
    const board = table(IMPACT_EFFORT).board();
    expect(keyAdd(board, "I1", "right")).toEqual({ type: "item", lane: "bet" });
    expect(keyAdd(board, "I1", "down")).toEqual({ type: "item", lane: "fill" });
    expect(keyAdd(board, "I1", "left")).toBeUndefined();
    expect(keyAdd(board, "I2", "right")).toBeUndefined();
  });

  test("on a graph, right and down: the next node, linked from it; left and up: nothing", () => {
    const board = table(FLOW).board();
    expect(keyAdd(board, "F2", "right")).toEqual({ type: "step", from: "F2" });
    expect(keyAdd(board, "D1", "down")).toEqual({ type: "decision", from: "D1" });
    expect(keyAdd(board, "F2", "left")).toBeUndefined();
    expect(keyAdd(board, "F2", "up")).toBeUndefined();
  });

  test("an unknown card adds nothing", () => {
    expect(keyAdd(table(KANBAN).board(), "Z9", "right")).toBeUndefined();
  });

  test("every place it says is one the board takes", () => {
    const t = table(KANBAN);
    for (const id of ["T3", "T4"])
      for (const direction of ["up", "down", "right"] as const) {
        const place = keyAdd(t.board(), id, direction);
        if (place) t.do({ kind: "add", board: "sprint", label: "Nouvelle", ...place });
      }
    expect(t.board().elements).toHaveLength(11);
  });
});
