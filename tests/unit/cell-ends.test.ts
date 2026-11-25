/**
 * A card is sent to the top or the foot of its cell in one gesture (S355). On
 * a grid the arrows held with Shift go to another cell, so nothing else by the
 * keyboard orders the cards of a cell; in a long column it spares a drag.
 */
import { expect, test } from "bun:test";
import { toEnd } from "../../src/web/cell-ends.ts";
import { FLOW, ORDERING, table } from "../support.ts";

const GRID = `
board new "Priorités" --format impact-effort --id priorites
add item "Un" --lane quick
add item "Deux" --lane quick
add item "Trois" --lane quick
add item "Ailleurs" --lane bet
`;

const order = (t: ReturnType<typeof table>, lane: string): string[] =>
  t
    .board()
    .elements.filter((el) => el.lane === lane)
    .map((el) => el.id);

test("to the top: before the first card of its cell", () => {
  const t = table(GRID);
  const command = toEnd(t.board(), "I3", true);
  expect(command).toEqual({ kind: "move", board: "priorites", id: "I3", lane: "quick", before: "I1" });
  if (command) t.do(command, "human");
  expect(order(t, "quick")).toEqual(["I3", "I1", "I2"]);
});

test("to the foot: after the last card of its cell", () => {
  const t = table(GRID);
  const command = toEnd(t.board(), "I1", false);
  expect(command).toEqual({ kind: "move", board: "priorites", id: "I1", lane: "quick" });
  if (command) t.do(command, "human");
  expect(order(t, "quick")).toEqual(["I2", "I3", "I1"]);
  expect(order(t, "bet")).toEqual(["I4"]);
});

test("a card already there is not moved, and one alone in its cell goes nowhere", () => {
  const t = table(GRID);
  expect(toEnd(t.board(), "I1", true)).toBeUndefined();
  expect(toEnd(t.board(), "I3", false)).toBeUndefined();
  expect(toEnd(t.board(), "I4", true)).toBeUndefined();
  expect(toEnd(t.board(), "I4", false)).toBeUndefined();
});

test("on a timeline, a cell is a step and a kind", () => {
  const t = table(`${ORDERING}add event "Commande confirmée" --col 1\n`);
  const last = t.board().elements.at(-1)?.id ?? "";
  expect(toEnd(t.board(), last, true)).toEqual({
    kind: "move",
    board: "commande",
    id: last,
    col: 1,
    before: "E1",
  });
  expect(toEnd(t.board(), "E1", false)).toEqual({ kind: "move", board: "commande", id: "E1", col: 1 });
});

test("a diagram has no cell, and a card that is not there no place", () => {
  expect(toEnd(table(FLOW).board(), "F1", true)).toBeUndefined();
  expect(toEnd(table(GRID).board(), "I99", true)).toBeUndefined();
});
