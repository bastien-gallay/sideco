/**
 * A card marked done, where done is a mark: said by a command, kept by the board, shown on the card,
 * told to the agent, and taken back like any other gesture.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardMarkup } from "../../src/domain/render/svg.ts";
import { findElement } from "../../src/domain/workspace.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { KANBAN, type Table, table } from "../support.ts";

/** On a kanban, done is the last lane (see kanban-done.test.ts); on a retro, it is a mark. */
const RETRO = `
board new "Rétro" --format retro --id retro
add point "Revue rapide" --lane keep
add point "Réunions longues" --lane drop
`;

const done = (t: Table, id: string): boolean | undefined => findElement(t.board(), id)?.done;
const markup = (t: Table, id: string): string => {
  const card = layoutBoard(t.board()).cards.find((c) => c.id === id);
  if (!card) throw new Error(`no card ${id}`);
  return cardMarkup(card);
};

describe("marking a card done", () => {
  test("`done ID` marks it, `undone ID` clears it, and saying it twice records nothing", () => {
    const t = table(RETRO).script("done Q1");
    expect(done(t, "Q1")).toBe(true);
    expect(t.events.at(-1)).toMatchObject({ event: "ElementMarked", id: "Q1", done: true });
    const seq = t.seq;
    t.script("done Q1");
    expect(t.seq).toBe(seq);
    t.script("undone Q1");
    expect(done(t, "Q1")).toBeUndefined();
    t.script("undone Q1");
    expect(t.seq).toBe(seq + 1);
    expect(() => table(RETRO).script("done Q99")).toThrow("Q99");
  });

  test("the card shows it by a sign, not by colour alone, and says it in its tooltip", () => {
    const t = table(RETRO);
    expect(markup(t, "Q1")).not.toContain("card-done");
    t.script("done Q1");
    expect(markup(t, "Q1")).toContain('<text class="card-done"');
    expect(markup(t, "Q1")).toContain("✓");
    expect(markup(t, "Q1")).toMatch(/<text class="card-done" x="[\d.]+" y="14"/);
    expect(markup(t, "Q1")).toMatch(/<title>Q1 · Observation · added by Claude · done<\/title>/);
    const fr = layoutBoard(t.board(), "fr").cards.find((c) => c.id === "Q1");
    expect(fr?.tip).toEndWith("· fait");
    // The mark is part of what the page repaints a card for.
    expect(layoutBoard(t.board()).cards.find((c) => c.id === "Q1")?.done).toBe(true);
    expect(layoutBoard(t.board()).cards.find((c) => c.id === "Q2")?.done).toBe(false);
  });

  test("undo takes the mark back, and a removed card comes back with it", () => {
    const t = table(RETRO).script("done Q1", "human");
    t.do({ kind: "undo", board: "retro" }, "human");
    expect(done(t, "Q1")).toBeUndefined();
    t.do({ kind: "redo", board: "retro" }, "human");
    expect(done(t, "Q1")).toBe(true);
    t.script("rm Q1", "human");
    t.do({ kind: "undo", board: "retro" }, "human");
    expect(done(t, "Q1")).toBe(true);
  });

  test("the agent reads it on the board and among the changes", () => {
    const t = table(RETRO);
    const mark = t.seq;
    t.script("done Q1", "human");
    expect(describeBoard(t.board())).toMatch(/^ {2}Q1 point ".*" ✓ done/m);
    expect(describeChanges(t.events, mark).text).toContain("~ Q1 marked done");
    const cleared = t.seq;
    t.script("undone Q1", "human");
    expect(describeChanges(t.events, cleared).text).toContain("~ Q1 no longer done");
    // Marked then cleared since the last look: nothing to tell.
    expect(describeChanges(t.events, mark).text).not.toContain("Q1");
  });

  test("the history words it in both languages", () => {
    const t = table(RETRO).script("done Q1", "human");
    expect(describeEvent(t.events.at(-1) as never)).toBe("You mark Q1 done");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Tu marques Q1 comme fait");
    t.script("undone Q1");
    expect(describeEvent(t.events.at(-1) as never)).toBe("Claude marks Q1 not done");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Claude marque Q1 comme non fait");
  });

  test("a board exported as a model and read back keeps its marks", () => {
    const t = table(RETRO).script("done Q1");
    const model = toModel(t.board());
    expect(JSON.stringify(model)).toContain('"done":true');
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(model)), "copy")) back.do(command);
    expect(findElement(back.board(), "Q1")?.done).toBe(true);
    expect(findElement(back.board(), "Q2")?.done).toBeUndefined();
  });
});

describe("a detail kept on several lines", () => {
  test("the agent reads it under its card", () => {
    const t = table(KANBAN);
    t.do({ kind: "annotate", board: "sprint", id: "T1", detail: "une ligne\nune autre" });
    expect(describeBoard(t.board())).toContain("— une ligne\n      une autre");
  });
});
