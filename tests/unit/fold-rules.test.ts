/** The rules of a reader's folds (S307), without a page: which lanes stay folded, and what press is a carry. */
import { describe, expect, test } from "bun:test";
import { isCarry, stillFolded, toggled } from "../../src/web/fold-rules.ts";
import { table } from "../support.ts";

const board = () =>
  table(
    'board new "Sprint" --format kanban --id sprint\nadd task "Brancher" --lane todo\nadd task "Écran" --lane doing',
  ).board();

describe("the lanes a reader folded", () => {
  test("a lane is folded by its button, and opened by it again", () => {
    expect(toggled([], "doing")).toEqual(["doing"]);
    expect(toggled(["todo", "doing"], "doing")).toEqual(["todo"]);
  });

  test("a card chosen, or one that holds the keyboard, opens the folded lane it is in", () => {
    const [first, second] = board().elements.map((e) => e.id);
    expect(stillFolded(board(), ["todo", "doing"], [second])).toEqual(["todo"]);
    expect(stillFolded(board(), ["todo", "doing"], [null, first])).toEqual(["doing"]);
    expect(stillFolded(board(), ["todo", "doing"], [first, second])).toEqual([]);
  });

  test("no card at work, or one that is gone, opens nothing", () => {
    const folded = ["doing"];
    expect(stillFolded(board(), folded, [null, undefined])).toBe(folded);
    expect(stillFolded(board(), folded, ["T99"])).toBe(folded);
  });
});

describe("a press that travels is a carry, not a click on a fold", () => {
  test("as the board counts it: more than 4 units of the board, whatever its zoom", () => {
    expect(isCarry(4, 1)).toBe(false);
    expect(isCarry(5, 1)).toBe(true);
    // Drawn larger, the same wobble of the hand is fewer units of the board.
    expect(isCarry(5, 1.5)).toBe(false);
    expect(isCarry(7, 1.5)).toBe(true);
    // Drawn smaller, a little way on screen is already a carry on the board.
    expect(isCarry(3, 0.5)).toBe(true);
    expect(isCarry(2, 0.5)).toBe(false);
  });

  test("a zoom the page cannot say counts as none", () => {
    expect(isCarry(5, 0)).toBe(true);
    expect(isCarry(4, Number.NaN)).toBe(false);
  });
});
