/**
 * On a kanban, done is where the card is: in the last lane. There is no mark
 * besides: marking a card done takes it there, and the card wears no tick.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard } from "../../src/domain/digest.ts";
import { toMarkdown } from "../../src/domain/export/markdown.ts";
import { toMermaid } from "../../src/domain/export/mermaid.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { isDone } from "../../src/domain/formats.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { FLOW, KANBAN, table } from "../support.ts";

const META = { exportedAt: "2026-11-18T10:00:00.000Z" };
const el = (t: ReturnType<typeof table>, id: string) => {
  const found = t.board().elements.find((e) => e.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("done on a kanban is the last lane", () => {
  test("a card in the last lane is done, whatever the lane is called or wherever it moved", () => {
    const t = table(KANBAN);
    expect(isDone(t.board(), el(t, "T1"))).toBe(true);
    expect(isDone(t.board(), el(t, "T2"))).toBe(false);
    t.script('lane add "Livré"');
    expect(isDone(t.board(), el(t, "T1"))).toBe(false);
  });

  test("`done` takes the card to the last lane; `undone` to the lane before it", () => {
    const t = table(KANBAN).script("done T3");
    expect(el(t, "T3").lane).toBe("done");
    expect(t.events.at(-1)).toMatchObject({ event: "ElementMoved", id: "T3", lane: "done" });
    const seq = t.seq;
    t.script("done T3");
    expect(t.seq).toBe(seq);
    t.script("undone T3");
    expect(el(t, "T3").lane).toBe("doing");
    t.script("undone T4");
    expect(el(t, "T4").lane).toBe("todo");
  });

  test("the card wears no tick: the lane says it", () => {
    const t = table(KANBAN);
    expect(layoutBoard(t.board()).cards.find((c) => c.id === "T1")?.done).toBe(false);
    expect(describeBoard(t.board())).not.toContain("✓ done");
    expect(toMermaid(t.board())).toContain("T1[T1 Écrire le PRD]");
    expect(toMarkdown(t.board(), META)).not.toContain("✓");
  });

  test("a model read back keeps the cards where they were, without moving any", () => {
    const t = table(KANBAN);
    const model = {
      ...toModel(t.board()),
      elements: toModel(t.board()).elements.map((e) => ({ ...e, done: true })),
    };
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(model)), "copy")) back.do(command);
    expect(back.board().elements.map((e) => e.lane)).toEqual(t.board().elements.map((e) => e.lane));
  });

  test("elsewhere, done stays a mark of its own", () => {
    const t = table(FLOW).script("done S1");
    const first = t.board().elements[0];
    if (!first) throw new Error("a step");
    expect(isDone(t.board(), first)).toBe(true);
    expect(layoutBoard(t.board()).cards.find((c) => c.id === first.id)?.done).toBe(true);
  });
});
