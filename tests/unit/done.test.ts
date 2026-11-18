/**
 * A card marked done: said by a command, kept by the board, shown on the card,
 * told to the agent, and taken back like any other gesture.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardMarkup } from "../../src/domain/render/svg.ts";
import { findElement } from "../../src/domain/workspace.ts";
import { describeEvent } from "../../src/web/view.ts";
import { KANBAN, type Table, table } from "../support.ts";

const done = (t: Table, id: string): boolean | undefined => findElement(t.board(), id)?.done;
const markup = (t: Table, id: string): string => {
  const card = layoutBoard(t.board()).cards.find((c) => c.id === id);
  if (!card) throw new Error(`no card ${id}`);
  return cardMarkup(card);
};

describe("marking a card done", () => {
  test("`done ID` marks it, `undone ID` clears it, and saying it twice records nothing", () => {
    const t = table(KANBAN).script("done T1");
    expect(done(t, "T1")).toBe(true);
    expect(t.events.at(-1)).toMatchObject({ event: "ElementMarked", id: "T1", done: true });
    const seq = t.seq;
    t.script("done T1");
    expect(t.seq).toBe(seq);
    t.script("undone T1");
    expect(done(t, "T1")).toBeUndefined();
    t.script("undone T1");
    expect(t.seq).toBe(seq + 1);
    expect(() => table(KANBAN).script("done T99")).toThrow("T99");
  });

  test("the card shows it by a sign, not by colour alone, and says it in its tooltip", () => {
    const t = table(KANBAN);
    expect(markup(t, "T1")).not.toContain("card-done");
    t.script("done T1");
    expect(markup(t, "T1")).toContain('<text class="card-done"');
    expect(markup(t, "T1")).toContain("✓");
    expect(markup(t, "T1")).toMatch(/<title>T1 · Task · added by Claude · done<\/title>/);
    const fr = layoutBoard(t.board(), "fr").cards.find((c) => c.id === "T1");
    expect(fr?.tip).toEndWith("· fait");
    // The mark is part of what the page repaints a card for.
    expect(layoutBoard(t.board()).cards.find((c) => c.id === "T1")?.done).toBe(true);
    expect(layoutBoard(t.board()).cards.find((c) => c.id === "T2")?.done).toBe(false);
  });

  test("undo takes the mark back, and a removed card comes back with it", () => {
    const t = table(KANBAN).script("done T1", "human");
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(done(t, "T1")).toBeUndefined();
    t.do({ kind: "redo", board: "sprint" }, "human");
    expect(done(t, "T1")).toBe(true);
    t.script("rm T1", "human");
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(done(t, "T1")).toBe(true);
  });

  test("the agent reads it on the board and among the changes", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    t.script("done T1", "human");
    expect(describeBoard(t.board())).toMatch(/^ {2}T1 task ".*" ✓ done/m);
    expect(describeChanges(t.events, mark).text).toContain("~ T1 marked done");
    const cleared = t.seq;
    t.script("undone T1", "human");
    expect(describeChanges(t.events, cleared).text).toContain("~ T1 no longer done");
    // Marked then cleared since the last look: nothing to tell.
    expect(describeChanges(t.events, mark).text).not.toContain("T1");
  });

  test("the history words it in both languages", () => {
    const t = table(KANBAN).script("done T1", "human");
    expect(describeEvent(t.events.at(-1) as never)).toBe("You mark T1 done");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Tu marques T1 comme fait");
    t.script("undone T1");
    expect(describeEvent(t.events.at(-1) as never)).toBe("Claude marks T1 not done");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Claude marque T1 comme non fait");
  });

  test("a board exported as a model and read back keeps its marks", () => {
    const t = table(KANBAN).script("done T1");
    const model = toModel(t.board());
    expect(JSON.stringify(model)).toContain('"done":true');
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(model)), "copy")) back.do(command);
    expect(findElement(back.board(), "T1")?.done).toBe(true);
    expect(findElement(back.board(), "T2")?.done).toBeUndefined();
  });
});
