/**
 * In a cell of a timeline, cards stack in the board's order; dropped by the
 * mouse, a card lands before the first card whose upper half is under the pointer.
 */
import { describe, expect, test } from "bun:test";
import { layoutBoard, locate, stepDrop } from "../../src/domain/layout/index.ts";
import { addOffers } from "../../src/web/view.ts";
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

  test('the edge is no wider than its "+": the rest of the heading is a handle, with nothing to add on it', () => {
    const two = step(2);
    expect(locate(t.board(), two.x + 24, 10)).toEqual({ kind: "step-head", col: 2 });
    expect(locate(t.board(), two.x + two.w - 24, 10)).toEqual({ kind: "step-head", col: 2 });
    for (const script of ['board new "Carte" --format story-map --id carte\nadd story "S" --col 1', STACKED])
      expect(addOffers(table(script).board(), { kind: "step-head", col: 1 })).toEqual([]);
  });
});

describe("a step dragged by its heading", () => {
  const t = table(`
board new "Glisse" --id glisse
add event "Un" --col 1
add event "Deux" --col 2
add event "Trois" --col 3
`);
  const middle = (col: number) => {
    const band = layoutBoard(t.board()).bands.find((b) => b.kind === "step" && b.id === String(col));
    if (!band) throw new Error(`no step ${col}`);
    return band.x + band.w / 2;
  };

  test("takes the number of the step it is dropped on; on itself, or past the last, nothing", () => {
    expect(stepDrop(t.board(), middle(3), 1)).toBe(3);
    expect(stepDrop(t.board(), middle(1), 3)).toBe(1);
    expect(stepDrop(t.board(), middle(2), 2)).toBeUndefined();
    expect(stepDrop(t.board(), middle(4), 1)).toBe(3);
  });
});
