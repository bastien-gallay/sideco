/**
 * A story map cut into slices: a named line under the stories, added by
 * command, drawn across the board, told to the agent, kept and taken back.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { bandMarkup } from "../../src/domain/render/svg.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { KANBAN, type Table, table } from "../support.ts";

const MAP = `
board new "Carte" --format story-map --id carte
add activity "Acheter" --col 1
add task "Chercher" --col 1
add story "Recherche simple" --col 1
`;

const slices = (t: Table): { id: string; label: string }[] => t.board().slices ?? [];
const sliceBands = (t: Table) => layoutBoard(t.board()).bands.filter((b) => b.kind === "slice");
const undo = (t: Table): void => {
  t.do({ kind: "undo", board: t.board().id }, "human");
};

describe("adding a slice", () => {
  test("`slice add` puts a named slice at the end, or before another", () => {
    const t = table(MAP);
    expect(t.do({ kind: "add-slice", board: "carte", label: "Lot 1" })).toBe("slice-1");
    expect(t.events.at(-1)).toMatchObject({ event: "SliceAdded", slice: "slice-1", label: "Lot 1" });
    t.script('slice add "Plus tard"\nslice add "Lot 2" --before slice-2');
    expect(slices(t)).toEqual([
      { id: "slice-1", label: "Lot 1" },
      { id: "slice-3", label: "Lot 2" },
      { id: "slice-2", label: "Plus tard" },
    ]);
  });

  test("refused on a board with no stories to slice, or before a slice it does not have", () => {
    expect(() => table(KANBAN).script('slice add "Lot 1"')).toThrow("Kanban boards have no slices");
    expect(() => table(MAP).script('slice add "Lot 1" --before slice-9')).toThrow('no slice "slice-9"');
  });

  test("removed by `slice rm`; an id is never given twice", () => {
    const t = table(MAP).script('slice add "Lot 1"\nslice rm slice-1\nslice add "Lot 2"');
    expect(slices(t)).toEqual([{ id: "slice-2", label: "Lot 2" }]);
    expect(() => t.script("slice rm slice-1")).toThrow('no slice "slice-1"');
  });
});

describe("a slice on the board", () => {
  test("is a line across the board under the stories, one under the other, each with its name", () => {
    const t = table(MAP);
    const before = layoutBoard(t.board());
    const stories = before.bands.find((b) => b.kind === "row" && b.id === "story");
    if (!stories) throw new Error("no story row");
    t.script('slice add "Lot 1"\nslice add "Lot 2"');
    const after = layoutBoard(t.board());
    const [first, second] = sliceBands(t);
    expect(first).toMatchObject({ id: "slice-1", label: "Lot 1", x: 0, y: stories.y + stories.h });
    expect(first?.w).toBe(after.width);
    expect(second?.y).toBe((first?.y ?? 0) + (first?.h ?? 0));
    expect(after.height).toBe(before.height + (first?.h ?? 0) + (second?.h ?? 0));
  });

  test("is drawn as a rule with its name", () => {
    const t = table(MAP).script('slice add "Lot <1>"');
    const [band] = sliceBands(t);
    if (!band) throw new Error("no slice band");
    const markup = bandMarkup(band);
    expect(markup).toContain('class="band band-slice"');
    expect(markup).toContain(`y1="${band.y}"`);
    expect(markup).toContain("Lot &lt;1&gt;");
  });
});

describe("taking a slice back", () => {
  test("undo removes the slice added, and puts back the one removed, in its place and under its name", () => {
    const t = table(MAP).script('slice add "Lot 1"\nslice add "Lot 2"', "human");
    undo(t);
    expect(slices(t)).toEqual([{ id: "slice-1", label: "Lot 1" }]);
    t.script('slice add "Lot 3"\nslice rm slice-1', "human");
    undo(t);
    expect(slices(t)).toEqual([
      { id: "slice-1", label: "Lot 1" },
      { id: "slice-3", label: "Lot 3" },
    ]);
  });
});

describe("the slices, told and kept", () => {
  test("the agent reads the slices, and the changes", () => {
    const t = table(MAP);
    const mark = t.seq;
    t.script(
      'slice add "Lot 1"\nslice add "Lot 2" --before slice-1\nslice add "Vite"\nslice rm slice-3',
      "human",
    );
    expect(describeBoard(t.board())).toContain('slices: slice-2 "Lot 2", slice-1 "Lot 1"');
    expect(describeChanges(t.events, mark).text).toBe(
      [
        'board carte "Carte"',
        '  + slice slice-1 "Lot 1" added at the end',
        '  + slice slice-2 "Lot 2" added before slice-1',
      ].join("\n"),
    );
  });

  test("the history words it", () => {
    const t = table(MAP).script('slice add "Lot 1"\nslice rm slice-1', "human");
    const at = (i: number) => t.events.at(i) as never;
    expect(describeEvent(at(-2))).toBe("You add the slice “Lot 1”");
    expect(describeEvent(at(-2), "fr")).toBe("Tu ajoutes la tranche « Lot 1 »");
    expect(describeEvent(at(-1), "fr")).toBe("Tu supprimes la tranche slice-1");
  });

  test("a model read back keeps them, in their order", () => {
    const t = table(MAP).script('slice add "Lot 1"\nslice add "Lot 2" --before slice-1\nslice rm slice-1');
    const model = JSON.parse(JSON.stringify(toModel(t.board())));
    expect(model.slices).toEqual([{ id: "slice-2", label: "Lot 2" }]);
    const back = table();
    for (const command of fromModel(model, "copy")) back.do(command);
    expect(slices(back)).toEqual(slices(t));
  });
});
