import { describe, expect, test } from "bun:test";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardPlace, keyMove, neighbour, readingOrder } from "../../src/web/view.ts";
import { KANBAN, ORDERING, table } from "../support.ts";

describe("the arrow keys go from a card to the next one on screen", () => {
  // ORDERING: column 1 holds X1, C1, E1 from top to bottom; column 2 holds P1, C2, E2, H1.
  const cards = layoutBoard(table(ORDERING).board()).cards;

  test("down and up stay in the column", () => {
    expect(neighbour(cards, "C1", "down")).toBe("E1");
    expect(neighbour(cards, "C1", "up")).toBe("X1");
  });

  test("right and left go to the nearest card of the next column, at about the same height", () => {
    expect(neighbour(cards, "C1", "right")).toBe("C2");
    expect(neighbour(cards, "C2", "left")).toBe("C1");
  });

  test("down and up never leave the column, even when the next card below is in another one", () => {
    // Nothing is under E1 in column 1; P1, in column 2, is lower down.
    expect(neighbour(cards, "E1", "down")).toBeUndefined();
    expect(neighbour(cards, "P1", "up")).toBe("E2");
  });

  test("at an edge there is nowhere to go", () => {
    expect(neighbour(cards, "X1", "up")).toBeUndefined();
    expect(neighbour(cards, "X1", "left")).toBeUndefined();
    expect(neighbour(cards, "Z9", "down")).toBeUndefined();
  });

  test("Tab follows the reading order: column by column, top to bottom, whatever the order of creation", () => {
    const t = table(ORDERING);
    t.do({ kind: "add", board: "commande", type: "actor", label: "Caisse", col: 2 });
    const order = readingOrder(layoutBoard(t.board()).cards);
    expect(order.slice(0, 3)).toEqual(["X1", "C1", "E1"]);
    expect(order.indexOf("X2")).toBeLessThan(order.indexOf("P1"));
  });
});

describe("a card says where it is, for who cannot see the board", () => {
  test("on a timeline, its step", () => {
    const board = table(ORDERING).board();
    expect(cardPlace(board, layoutBoard(board).bands, "P1")).toBe("step 2");
    expect(cardPlace(board, layoutBoard(board, "fr").bands, "P1", "fr")).toBe("étape 2");
  });

  test("in lanes, the name of its lane as the board shows it", () => {
    const board = table(KANBAN).board();
    expect(cardPlace(board, layoutBoard(board).bands, "T2")).toBe("Doing");
    expect(cardPlace(board, layoutBoard(board, "fr").bands, "T2", "fr")).toBe("En cours");
  });

  test("a card gone has no place", () => {
    const board = table(KANBAN).board();
    expect(cardPlace(board, layoutBoard(board).bands, "T99")).toBeUndefined();
  });
});

describe("Alt and an arrow move the focused card, by the board's own rules", () => {
  test("on a timeline, left and right change its column, never below the first", () => {
    const board = table(ORDERING).board();
    expect(keyMove(board, "C1", "right")).toEqual({ kind: "move", board: "commande", id: "C1", col: 2 });
    expect(keyMove(board, "C2", "left")).toEqual({ kind: "move", board: "commande", id: "C2", col: 1 });
    expect(keyMove(board, "C1", "left")).toBeUndefined();
  });

  test("on a timeline, it goes one column past the last at most", () => {
    const board = table(ORDERING).board();
    expect(keyMove(board, "C2", "right")).toEqual({ kind: "move", board: "commande", id: "C2", col: 3 });
    const further = table(`${ORDERING}\nmove C2 --col 3`).board();
    expect(keyMove(further, "C2", "right")).toBeUndefined();
  });

  test("up and down change its place among the cards of its kind in its cell", () => {
    const t = table(ORDERING);
    t.do({ kind: "add", board: "commande", type: "event", label: "Facture émise", col: 1 });
    const board = t.board();
    // Column 1 holds E1 then E3 in the event row.
    expect(keyMove(board, "E3", "up")).toEqual({
      kind: "move",
      board: "commande",
      id: "E3",
      col: 1,
      before: "E1",
    });
    expect(keyMove(board, "E1", "down")).toEqual({ kind: "move", board: "commande", id: "E1", col: 1 });
    expect(keyMove(board, "E1", "up")).toBeUndefined();
    expect(keyMove(board, "E3", "down")).toBeUndefined();
  });

  test("on a kanban, left and right change its lane, and it lands at the end", () => {
    const board = table(KANBAN).board();
    // T3 is in To do, T2 in Doing, T1 in Done.
    expect(keyMove(board, "T3", "right")).toEqual({ kind: "move", board: "sprint", id: "T3", lane: "doing" });
    expect(keyMove(board, "T2", "left")).toEqual({ kind: "move", board: "sprint", id: "T2", lane: "todo" });
    expect(keyMove(board, "T3", "left")).toBeUndefined();
    expect(keyMove(board, "T1", "right")).toBeUndefined();
  });

  test("on a kanban, up and down change its place in the lane", () => {
    const board = table(KANBAN).board();
    // To do holds T3 then T4.
    expect(keyMove(board, "T4", "up")).toEqual({
      kind: "move",
      board: "sprint",
      id: "T4",
      lane: "todo",
      before: "T3",
    });
    expect(keyMove(board, "T3", "down")).toEqual({ kind: "move", board: "sprint", id: "T3", lane: "todo" });
    expect(keyMove(board, "T3", "up")).toBeUndefined();
  });
});
