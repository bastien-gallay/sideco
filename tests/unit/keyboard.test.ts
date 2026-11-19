import { describe, expect, test } from "bun:test";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardLinks, cardPlace, keyMove, neighbour, readingGroups, readingOrder } from "../../src/web/view.ts";
import { FLOW, IMPACT_EFFORT, KANBAN, ORDERING, table } from "../support.ts";

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

describe("a screen reader reads the board as it is drawn, not as it was made", () => {
  const groups = (script: string, locale?: "en" | "fr") => {
    const board = table(script).board();
    return readingGroups(board, layoutBoard(board, locale), locale);
  };

  test("in lanes: lane by lane, each a group under its name, top to bottom", () => {
    expect(groups(KANBAN)).toEqual([
      { label: "To do", ids: ["T3", "T4"] },
      { label: "Doing", ids: ["T2", "B1"] },
      { label: "Done", ids: ["T1"] },
    ]);
    expect(groups(KANBAN, "fr")[0]?.label).toBe("À faire");
  });

  test("on a timeline: step by step, top to bottom, whatever the order of creation", () => {
    const t = table(ORDERING);
    t.do({ kind: "add", board: "commande", type: "actor", label: "Caisse", col: 2 });
    const board = t.board();
    const read = readingGroups(board, layoutBoard(board));
    expect(read.map((g) => g.label)).toEqual(["step 1", "step 2"]);
    expect(read[0]?.ids).toEqual(["X1", "C1", "E1"]);
    expect(read[1]?.ids[0]).toBe("X2");
  });

  test("on a plan: cell by cell in the order of the plan, row after row inside a cell", () => {
    const read = groups(
      `${IMPACT_EFFORT}\nadd item "Raccourcis" --lane quick\nadd item "Thème" --lane quick`,
    );
    expect(read).toEqual([
      { label: "Quick wins", ids: ["I1", "I4", "I5"] },
      { label: "Big bets", ids: ["I2"] },
      { label: "Fill-ins", ids: ["I3"] },
    ]);
  });

  test("on a flow: one run of cards, from the first step down", () => {
    const read = groups(FLOW);
    expect(read).toHaveLength(1);
    expect(read[0]?.label).toBeUndefined();
    expect(read[0]?.ids[0]).toBe("S1");
    expect([...(read[0]?.ids ?? [])].sort()).toEqual(["D1", "O1", "S1", "S2", "S3"]);
  });
});

describe("a card says what it is linked to, for who cannot see the arrows", () => {
  const board = table(FLOW).board();

  test("where it leads, with the name of each branch, and where it comes from", () => {
    expect(cardLinks(board, "D1")).toBe(
      "leads to S2 Expédier (oui), S3 Commander au fournisseur (non) · comes from S1 Recevoir la commande, S3 Commander au fournisseur (à réception)",
    );
    expect(cardLinks(board, "S1", "fr")).toBe("mène à D1 En stock ?");
  });

  test("a card without links says nothing more", () => {
    expect(cardLinks(table(KANBAN).board(), "T1")).toBeUndefined();
  });
});

describe("a card says where it is, for who cannot see the board", () => {
  test("on a timeline, its step and its row", () => {
    const board = table(ORDERING).board();
    expect(cardPlace(board, layoutBoard(board).bands, "P1")).toBe("step 2, row Policy");
    expect(cardPlace(board, layoutBoard(board, "fr").bands, "P1", "fr")).toBe("étape 2, rangée Règle");
  });

  test("in a cell of several cards, its rank there, top to bottom", () => {
    const board = table(`board new "Pile" --id pile
add event "Un" --col 1
add event "Deux" --col 1
add event "Trois" --col 1`).board();
    expect(cardPlace(board, layoutBoard(board).bands, "E2")).toBe("step 1, row Event, 2 of 3");
    expect(cardPlace(board, layoutBoard(board, "fr").bands, "E3", "fr")).toBe(
      "étape 1, rangée Événement, 3 sur 3",
    );
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

describe("Shift and an arrow move the focused card, by the board's own rules", () => {
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

  test("on a grid, left and right change the effort, up and down the impact", () => {
    const board = table(IMPACT_EFFORT).board();
    // Quick wins | Big bets on top, Fill-ins | Avoid below. I1 is a quick win, I2 a big bet, I3 a fill-in.
    const to = (id: string, lane: string) => ({ kind: "move" as const, board: "priorites", id, lane });
    expect(keyMove(board, "I1", "right")).toEqual(to("I1", "bet"));
    expect(keyMove(board, "I2", "left")).toEqual(to("I2", "quick"));
    expect(keyMove(board, "I1", "down")).toEqual(to("I1", "fill"));
    expect(keyMove(board, "I3", "up")).toEqual(to("I3", "quick"));
    expect(keyMove(board, "I2", "down")).toEqual(to("I2", "avoid"));
  });

  test("on a grid, a card never leaves it, nor wraps to the next row", () => {
    const board = table(IMPACT_EFFORT).board();
    expect(keyMove(board, "I1", "left")).toBeUndefined();
    expect(keyMove(board, "I1", "up")).toBeUndefined();
    // Big bets is the end of the top row: right does not wrap round to Fill-ins.
    expect(keyMove(board, "I2", "right")).toBeUndefined();
    expect(keyMove(board, "I3", "left")).toBeUndefined();
    expect(keyMove(board, "I3", "down")).toBeUndefined();
  });
});
