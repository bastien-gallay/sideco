import { describe, expect, test } from "bun:test";
import { byBoard, renameLabel } from "../../src/domain/label-rename.ts";
import { KANBAN, table } from "../support.ts";

describe("a label renamed on every card (S328, its second half)", () => {
  test("the commands go a batch a board, in the order of the boards", () => {
    const at = (board: string) => ({ kind: "unlabel" as const, board, id: "T1", labels: ["x"] });
    expect(byBoard([at("a"), at("a"), at("b"), at("a")])).toEqual([[at("a"), at("a"), at("a")], [at("b")]]);
  });

  const labelled = () => {
    const t = table(KANBAN);
    const [first, second, third] = t.ws.boards[0]?.elements.map((e) => e.id) ?? [];
    t.script(`label ${first} type:bug ui\nlabel ${second} Type:Bug\nlabel ${third} type:idea`);
    return { t, first, second, third };
  };

  test("each card that wears it loses it and takes the new one, whatever the case it was written in", () => {
    const { t, first, second } = labelled();
    const board = t.ws.boards[0]?.id ?? "";
    expect<unknown[]>(renameLabel(t.ws, "type:bug", "type:issue")).toEqual([
      { kind: "unlabel", board, id: first, labels: ["type:bug"] },
      { kind: "label", board, id: first, labels: ["type:issue"] },
      { kind: "unlabel", board, id: second, labels: ["Type:Bug"] },
      { kind: "label", board, id: second, labels: ["type:issue"] },
    ]);
  });

  test("applied, the cards wear the new name alone; a card that had both keeps one", () => {
    const { t, first, second, third } = labelled();
    t.script(`label ${first} type:idea`);
    for (const command of renameLabel(t.ws, "type:bug", "type:idea")) t.do(command, "human");
    const labels = (id: string | undefined) => t.ws.boards[0]?.elements.find((e) => e.id === id)?.labels;
    expect(labels(first)).toEqual(["ui", "type:idea"]);
    expect(labels(second)).toEqual(["type:idea"]);
    expect(labels(third)).toEqual(["type:idea"]);
  });

  test("the same name, a name worn by no card, or no new name: nothing to do; a change of case alone is a rename", () => {
    const { t } = labelled();
    expect(renameLabel(t.ws, "type:bug", "type:bug")).toEqual([]);
    expect(renameLabel(t.ws, "type:none", "type:issue")).toEqual([]);
    expect(renameLabel(t.ws, "type:bug", "  ")).toEqual([]);
    expect(renameLabel(t.ws, "type:bug", "Type:BUG")).toHaveLength(4);
    expect(renameLabel(t.ws, "@ana", "@bob")).toEqual([]);
  });
});
