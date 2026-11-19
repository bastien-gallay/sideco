/**
 * In a cell of a timeline, cards stack in the board's order; dropped by the
 * mouse, a card lands before the first card whose upper half is under the pointer.
 */
import { describe, expect, test } from "bun:test";
import { layoutBoard, locate } from "../../src/domain/layout/index.ts";
import { table } from "../support.ts";

const STACKED = `
board new "Pile" --id pile
add event "Un" --col 1
add event "Deux" --col 1
add event "Trois" --col 1
`;

describe("a drop inside a cell of a timeline", () => {
  const t = table(STACKED);
  const box = (id: string) => {
    const card = layoutBoard(t.board()).cards.find((c) => c.id === id);
    if (!card) throw new Error(`no ${id}`);
    return card;
  };

  test("says the card it would land before, or none at the foot of the stack", () => {
    const [one, two, three] = [box("E1"), box("E2"), box("E3")];
    const x = one.x + one.w / 2;
    expect(locate(t.board(), x, one.y + 2)).toEqual({ kind: "cell", col: 1, type: "event", before: "E1" });
    expect(locate(t.board(), x, two.y + two.h - 2)).toEqual({
      kind: "cell",
      col: 1,
      type: "event",
      before: "E3",
    });
    expect(locate(t.board(), x, three.y + three.h - 2)).toEqual({ kind: "cell", col: 1, type: "event" });
  });

  test("leaves the card in the hand out of the stack", () => {
    const [one, two] = [box("E1"), box("E2")];
    // E1 taken: the stack is E2, E3, drawn as if E1 were not there.
    expect(locate(t.board(), one.x + 4, one.y + 2, "E1")).toMatchObject({ before: "E2" });
    expect(locate(t.board(), two.x + 4, two.y + 2, "E2")).toMatchObject({ before: "E3" });
  });
});

describe("the heading of a step", () => {
  const t = table(`
board new "Étapes" --id etapes
add event "Un" --col 1
add event "Trois" --col 3
`);
  const step = (col: number) => {
    const band = layoutBoard(t.board()).bands.find((b) => b.kind === "step" && b.id === String(col));
    if (!band) throw new Error(`no step ${col}`);
    return band;
  };

  test("near an edge offers a column there; in its middle, is the step itself", () => {
    const two = step(2);
    expect(locate(t.board(), two.x + 3, 10)).toEqual({ kind: "boundary", col: 2 });
    expect(locate(t.board(), two.x + two.w / 2, 10)).toEqual({ kind: "step-head", col: 2 });
  });
});
