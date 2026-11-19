/**
 * The lanes of a kanban are the board's own: added, moved and removed there,
 * told to the agent, worded in the history, exported and taken back.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { toMarkdown } from "../../src/domain/export/markdown.ts";
import { toMermaid } from "../../src/domain/export/mermaid.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { lanesOf } from "../../src/domain/formats.ts";
import { layoutBoard, locate } from "../../src/domain/layout/index.ts";
import { addOffers, describeEvent, keyMove } from "../../src/web/view.ts";
import { IMPACT_EFFORT, KANBAN, ORDERING, type Table, table } from "../support.ts";

const META = { exportedAt: "2026-11-18T10:00:00.000Z" };
const order = (t: Table): string[] => lanesOf(t.board());
const bands = (t: Table): (string | undefined)[] =>
  layoutBoard(t.board())
    .bands.filter((b) => b.kind === "lane")
    .map((b) => b.label);
const undo = (t: Table, actor: "human" | "agent" = "human"): void => {
  t.do({ kind: "undo", board: t.board().id }, actor);
};

describe("adding a lane to a kanban", () => {
  test("`lane add` puts a named lane at the end, or before another; a card goes there", () => {
    const t = table(KANBAN);
    expect(t.do({ kind: "add-lane", board: "sprint", label: "Revue", before: "done" })).toBe("lane-1");
    expect(t.events.at(-1)).toMatchObject({
      event: "LaneAdded",
      lane: "lane-1",
      label: "Revue",
      before: "done",
    });
    t.script('lane add "Livré"');
    expect(order(t)).toEqual(["todo", "doing", "lane-1", "done", "lane-2"]);
    expect(bands(t)).toEqual(["To do", "Doing", "Revue", "Done", "Livré"]);
    t.script('add task "À relire" --lane lane-1');
    expect(t.board().elements.at(-1)?.lane).toBe("lane-1");
  });

  test("refused on a board whose workshop fixes its lanes, or before a lane it does not have", () => {
    expect(() => table(ORDERING).script('lane add "X"')).toThrow(
      "Event Storming boards have no lanes to add",
    );
    expect(() => table(KANBAN).script('lane add "X" --before nowhere')).toThrow('no lane "nowhere"');
  });

  test("an id is never given twice, even after its lane is removed", () => {
    const t = table(KANBAN).script('lane add "Revue"\nlane rm lane-1\nlane add "Encore"');
    expect(order(t)).toEqual(["todo", "doing", "done", "lane-2"]);
  });
});

describe("moving a lane", () => {
  test("before another lane, or to the end; where it already is, nothing is recorded", () => {
    const t = table(KANBAN).script("lane move done --before doing");
    expect(order(t)).toEqual(["todo", "done", "doing"]);
    t.script("lane move todo");
    expect(order(t)).toEqual(["done", "doing", "todo"]);
    const seq = t.seq;
    t.script("lane move doing --before todo");
    expect(t.seq).toBe(seq);
    expect(() => t.script("lane move doing --before doing")).toThrow("cannot be placed before itself");
  });

  test("the cards go with their lane", () => {
    const t = table(KANBAN).script("lane move done --before todo");
    expect(t.board().elements.find((e) => e.id === "T1")?.lane).toBe("done");
    expect(describeBoard(t.board()).indexOf("lane done")).toBeLessThan(
      describeBoard(t.board()).indexOf("lane todo"),
    );
  });
});

describe("removing a lane", () => {
  test("only an empty one, and never the last", () => {
    const t = table(KANBAN);
    expect(() => t.script("lane rm doing")).toThrow(
      "lane doing still has 2 cards (T2, B1): move or remove them first",
    );
    t.script("rm T1\nlane rm done");
    expect(order(t)).toEqual(["todo", "doing"]);
    const lone = table('board new "Seul" --format kanban --id seul\nlane rm doing\nlane rm done');
    expect(() => lone.script("lane rm todo")).toThrow("a kanban keeps at least one lane");
  });

  test("its name goes with it", () => {
    const t = table(KANBAN).script('lane add "Revue"\nlane rm lane-1');
    expect(t.board().lanes["lane-1"]).toBeUndefined();
  });
});

describe("taking a lane gesture back", () => {
  test("undo removes the lane added, puts back the one removed, in its place and under its name", () => {
    const t = table(KANBAN).script('lane add "Revue" --before done', "human");
    undo(t);
    expect(order(t)).toEqual(["todo", "doing", "done"]);
    t.do({ kind: "redo", board: "sprint" }, "human");
    expect(bands(t)).toEqual(["To do", "Doing", "Revue", "Done"]);
    t.script('lane doing "En cours"\nrm T1\nlane rm done', "human");
    t.script("lane rm lane-1", "human");
    undo(t);
    undo(t);
    expect(bands(t)).toEqual(["To do", "En cours", "Revue", "Done"]);
  });

  test("undo puts a moved lane back where it was", () => {
    const t = table(KANBAN).script("lane move todo --before done", "human");
    undo(t);
    expect(order(t)).toEqual(["todo", "doing", "done"]);
  });

  test("a lane that got cards since cannot be taken back: undo says so", () => {
    const t = table(KANBAN).script('lane add "Revue"', "human");
    t.script('add task "Là" --lane lane-1', "agent");
    expect(() => undo(t)).toThrow("lane lane-1 has cards now");
  });
});

describe("the lanes, told and kept", () => {
  test("the agent reads the board's lanes in its order, and the changes", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    t.script('lane add "Revue" --before done\nlane move todo\nrm T1\nlane rm done', "human");
    expect(describeBoard(t.board())).toContain("lane lane-1 (Revue)");
    expect(describeBoard(t.board(), { lane: "lane-1" })).toContain("part: lane lane-1");
    expect(describeChanges(t.events, mark).text).toBe(
      [
        'board sprint "Sprint 12"',
        '  + lane lane-1 "Revue" added before done',
        "  ~ lane todo moved to the end",
        '  − T1 task "Écrire le PRD" removed',
        "  − lane done removed",
      ].join("\n"),
    );
  });

  test("the history words it", () => {
    const t = table(KANBAN).script('lane add "Revue"\nlane move todo --before done\nlane rm lane-1', "human");
    const at = (i: number) => t.events.at(i) as never;
    expect(describeEvent(at(-3))).toBe("You add the lane “Revue”");
    expect(describeEvent(at(-2), "fr")).toBe("Tu déplaces la colonne todo");
    expect(describeEvent(at(-1), "fr")).toBe("Tu supprimes la colonne lane-1");
  });

  test("exports follow the board's lanes, and a model read back keeps them", () => {
    const t = table(KANBAN).script(
      'lane add "Revue" --before done\nlane move todo --before done\nrm T1\nlane rm done',
    );
    expect(toMermaid(t.board())).toContain("lane-1[Revue]");
    expect(toMermaid(t.board())).not.toContain("done[");
    expect(toMarkdown(t.board(), META)).toContain("lane-1[Revue]");
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(toModel(t.board()))), "copy")) back.do(command);
    expect(bands(back)).toEqual(bands(t));
  });
});

describe("the keyboard follows the board's lanes", () => {
  test("Shift and an arrow move a card into a lane the board added", () => {
    const t = table(KANBAN).script('lane add "Revue" --before done');
    expect(keyMove(t.board(), "T2", "right")).toMatchObject({ kind: "move", lane: "lane-1" });
  });
});

describe("the page offers to add and remove lanes", () => {
  const lanesDrawn = (t: Table) => layoutBoard(t.board()).bands.filter((b) => b.kind === "lane");

  test("on the edge between two lane headings, a lane before the second; past the last, one at the end", () => {
    const t = table(KANBAN);
    const [todo, doing, done] = lanesDrawn(t);
    if (!todo || !doing || !done) throw new Error("three lanes");
    const between = (todo.x + todo.w + doing.x) / 2;
    expect(locate(t.board(), between, doing.y + 10)).toEqual({ kind: "lane-edge", before: "doing" });
    expect(locate(t.board(), done.x + done.w + 6, done.y + 10)).toEqual({ kind: "lane-edge" });
    // Under the headings, the gap is no place: cards are dropped into lanes.
    expect(locate(t.board(), between, doing.y + 200)).toEqual({ kind: "none" });
    const [offer, ...others] = addOffers(t.board(), { kind: "lane-edge", before: "doing" }, "fr");
    expect(others).toEqual([]);
    expect(offer).toMatchObject({
      type: "lane",
      before: "doing",
      text: "+",
      label: "Ajouter une colonne ici",
    });
    expect((offer?.x ?? 0) + (offer?.w ?? 0) / 2).toBe(between);
  });

  test("not on a board whose workshop sets its lanes", () => {
    const t = table(IMPACT_EFFORT);
    const [first] = lanesDrawn(t);
    if (!first) throw new Error("a lane");
    expect(locate(t.board(), first.x - 4, first.y + 10).kind).not.toBe("lane-edge");
  });

  test("an empty lane offers to remove it, in its heading; a lane with cards, or the last one, does not", () => {
    const t = table(KANBAN).script('lane add "Revue"');
    const remove = (lane: string) =>
      addOffers(t.board(), { kind: "slot", lane }, "en").find((o) => o.type === "remove-lane");
    const offer = remove("lane-1");
    expect(offer).toMatchObject({ lane: "lane-1", text: "×", label: "Remove the lane Revue" });
    const band = lanesDrawn(t).find((b) => b.id === "lane-1");
    if (!band || !offer) throw new Error("drawn");
    expect(offer.x + offer.w).toBeLessThanOrEqual(band.x + band.w);
    expect(offer.y).toBeGreaterThanOrEqual(band.y);
    expect(remove("doing")).toBeUndefined();
    const lone = table('board new "Seul" --format kanban --id seul\nlane rm doing\nlane rm done');
    expect(
      addOffers(lone.board(), { kind: "slot", lane: "todo" }, "en").some((o) => o.type === "remove-lane"),
    ).toBe(false);
  });
});
