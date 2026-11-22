/**
 * A column of a timeline moved as one: its cards go with it, the columns it
 * passes close the gap. One gesture, said by a command, told and taken back.
 */
import { describe, expect, test } from "bun:test";
import { describeChanges } from "../../src/domain/digest.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { KANBAN, ORDERING, type Table, table } from "../support.ts";

/** Three steps: 1 holds X1 C1 E1, 2 holds P1 C2 E2 H1, 3 holds E3. */
const THREE = `${ORDERING}add event "Commande payée" --col 3\n`;

const columns = (t: Table): Record<string, number> =>
  Object.fromEntries(t.board().elements.map((e) => [e.id, e.col]));

describe("moving a column of a timeline", () => {
  test("`move-col FROM TO` takes the cards along; the columns passed shift the other way", () => {
    const t = table(THREE).script("move-col 1 3");
    expect(t.events.at(-1)).toMatchObject({ event: "ColumnMoved", from: 1, to: 3 });
    expect(columns(t)).toEqual({ X1: 3, C1: 3, E1: 3, P1: 1, C2: 1, E2: 1, H1: 1, E3: 2 });
    t.script("move-col 3 1");
    expect(columns(t)).toEqual({ X1: 1, C1: 1, E1: 1, P1: 2, C2: 2, E2: 2, H1: 2, E3: 3 });
  });

  test("a move that changes nothing records nothing", () => {
    const t = table(THREE);
    const seq = t.seq;
    t.script("move-col 2 2");
    expect(t.seq).toBe(seq);
  });

  test("only a step that holds cards, or one before it, is moved or aimed at; only on a timeline", () => {
    const t = table(THREE);
    expect(() => t.script("move-col 5 1")).toThrow("no column 5: the last one is 3");
    expect(() => t.script("move-col 1 4")).toThrow("no column 4: the last one is 3");
    expect(() => table(KANBAN).script("move-col 1 2")).toThrow("Kanban boards have no columns to move");
  });

  test("one undo puts the column back, and one redo moves it again", () => {
    const t = table(THREE).script("move-col 1 3", "human");
    t.do({ kind: "undo", board: "commande" }, "human");
    expect(columns(t)).toMatchObject({ X1: 1, P1: 2, E3: 3 });
    t.do({ kind: "redo", board: "commande" }, "human");
    expect(columns(t)).toMatchObject({ X1: 3, P1: 1, E3: 2 });
  });

  test("a column Claude moves takes along the place your move comes back to", () => {
    const t = table(THREE).script("move E3 --col 2", "human");
    t.script("move-col 2 1", "agent");
    expect(columns(t)).toMatchObject({ E3: 1, P1: 1, X1: 2 });
    t.do({ kind: "undo", board: "commande" }, "human");
    expect(columns(t)).toMatchObject({ E3: 3, P1: 1, X1: 2 });
  });

  test("a column moved by one is no longer taken back by the other who moved one before", () => {
    const t = table(THREE).script("move-col 1 3", "human");
    t.script("move-col 1 2", "agent");
    expect(() => t.do({ kind: "undo", board: "commande" }, "human")).toThrow("refused: your gesture seq");
    expect(() => t.do({ kind: "undo", board: "commande" }, "human")).toThrow("nothing to undo");
  });

  test("the agent reads it among the changes, and the history words it", () => {
    const t = table(THREE);
    const mark = t.seq;
    t.script("move-col 1 3", "human");
    expect(describeChanges(t.events, mark).text).toContain(
      "~ column 1 moved to 3 with its cards (columns 2 to 3 shifted left)",
    );
    expect(describeEvent(t.events.at(-1) as never)).toBe("You move column 1 to 3");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Tu déplaces la colonne 1 en 3");
    t.script("move-col 3 2", "human");
    expect(describeChanges(t.events, mark).text).toContain(
      "~ column 3 moved to 2 with its cards (column 2 shifted right)",
    );
  });
});
