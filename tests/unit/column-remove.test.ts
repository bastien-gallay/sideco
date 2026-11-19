/**
 * An empty column of a timeline removed: the columns after it close the gap.
 * The opposite of inserting one, so each takes the other back.
 */
import { describe, expect, test } from "bun:test";
import { describeChanges } from "../../src/domain/digest.ts";
import { describeEvent } from "../../src/web/view.ts";
import { KANBAN, ORDERING, type Table, table } from "../support.ts";

/** Steps 1 and 2 hold cards, 3 is empty, 4 holds E3. */
const GAP = `${ORDERING}add event "Commande payée" --col 4\n`;

const columns = (t: Table): Record<string, number> =>
  Object.fromEntries(t.board().elements.map((e) => [e.id, e.col]));

describe("removing a column of a timeline", () => {
  test("`rm-col N` removes an empty column; the columns after it shift left", () => {
    const t = table(GAP).script("rm-col 3");
    expect(t.events.at(-1)).toMatchObject({ event: "ColumnRemoved", at: 3 });
    expect(columns(t)).toMatchObject({ X1: 1, P1: 2, E3: 3 });
  });

  test("a column that holds cards is refused, and says which", () => {
    const t = table(GAP);
    expect(() => t.script("rm-col 1")).toThrow("column 1 holds X1, C1, E1: move or remove them first");
  });

  test("only a step of the board, only on a timeline", () => {
    expect(() => table(GAP).script("rm-col 5")).toThrow("no column 5: the last one is 4");
    expect(() => table(KANBAN).script("rm-col 1")).toThrow("Kanban boards have no columns to remove");
  });

  test("one undo puts the column back, one redo removes it again", () => {
    const t = table(GAP).script("rm-col 3", "human");
    t.do({ kind: "undo", board: "commande" }, "human");
    expect(columns(t)).toMatchObject({ P1: 2, E3: 4 });
    t.do({ kind: "redo", board: "commande" }, "human");
    expect(columns(t)).toMatchObject({ P1: 2, E3: 3 });
  });

  test("a column inserted is now taken back by undo", () => {
    const t = table(ORDERING).script("insert-col 2", "human");
    expect(columns(t)).toMatchObject({ X1: 1, P1: 3 });
    t.do({ kind: "undo", board: "commande" }, "human");
    expect(columns(t)).toMatchObject({ X1: 1, P1: 2 });
    t.do({ kind: "redo", board: "commande" }, "human");
    expect(columns(t)).toMatchObject({ P1: 3 });
  });

  test("a column Claude removes takes along the place your move comes back to", () => {
    // E3 leaves column 4 for column 1; E4 holds column 5, so 3 and 4 stand empty.
    const t = table(`${GAP}add event "Livrée" --col 5\n`).script("move E3 --col 1", "human");
    t.script("rm-col 3", "agent");
    expect(columns(t)).toMatchObject({ E3: 1, E4: 4 });
    t.do({ kind: "undo", board: "commande" }, "human");
    // Column 4 is now column 3: E3 goes back there, beside nothing it did not leave.
    expect(columns(t)).toMatchObject({ E3: 3, E4: 4 });
  });

  test("the agent reads it among the changes, and the history words it", () => {
    const t = table(GAP);
    const mark = t.seq;
    t.script("rm-col 3", "human");
    expect(describeChanges(t.events, mark).text).toContain(
      "− empty column 3 removed (columns from 4 shifted left)",
    );
    expect(describeEvent(t.events.at(-1) as never)).toBe("You remove column 3");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Tu supprimes la colonne 3");
  });
});
