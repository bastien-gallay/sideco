/**
 * A lane named on one board: the workshop gives the lanes, the board may call
 * them its own way. Said by a command, drawn, exported, told and taken back.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { toHtml } from "../../src/domain/export/html.ts";
import { toMarkdown } from "../../src/domain/export/markdown.ts";
import { toMermaid } from "../../src/domain/export/mermaid.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { KANBAN, ORDERING, type Table, table } from "../support.ts";

const META = { exportedAt: "2026-11-18T10:00:00.000Z" };
const band = (t: Table, lane: string): string | undefined =>
  layoutBoard(t.board()).bands.find((b) => b.kind === "lane" && b.id === lane)?.label;

describe("naming a lane on one board", () => {
  test('`lane ID "Name"` names it; the same name again records nothing; an unknown lane is refused', () => {
    const t = table(KANBAN).script('lane doing "À valider"');
    expect(t.events.at(-1)).toMatchObject({ event: "LaneNamed", lane: "doing", label: "À valider" });
    expect(band(t, "doing")).toBe("À valider");
    expect(band(t, "todo")).toBe("To do");
    const seq = t.seq;
    t.script('lane doing "À valider"');
    expect(t.seq).toBe(seq);
    expect(() => t.script('lane nowhere "X"')).toThrow('no lane "nowhere"');
    expect(() => table(ORDERING).script('lane todo "X"')).toThrow("no lanes to name");
  });

  test("the name is the board's own, in every language, and in every export", () => {
    const t = table(KANBAN).script('lane doing "À valider"');
    expect(layoutBoard(t.board(), "fr").bands.find((b) => b.id === "doing")?.label).toBe("À valider");
    expect(toMermaid(t.board())).toContain("doing[À valider]");
    expect(toMarkdown(t.board(), META)).toContain("| À valider |");
    expect(toHtml(t.board(), META)).toContain("<td>À valider</td>");
  });

  test("the agent reads it on the board and among the changes", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    t.script('lane doing "À valider"', "human");
    expect(describeBoard(t.board())).toContain("lane doing (À valider)");
    expect(describeChanges(t.events, mark).text).toContain('~ lane doing named "À valider"');
  });

  test("undo gives the lane its former name back", () => {
    const t = table(KANBAN).script('lane doing "À valider"', "human");
    t.script('lane doing "En revue"', "human");
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(band(t, "doing")).toBe("À valider");
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(band(t, "doing")).toBe("Doing");
  });

  test("the history words it, and a model read back keeps the name", () => {
    const t = table(KANBAN).script('lane doing "À valider"', "human");
    expect(describeEvent(t.events.at(-1) as never)).toBe("You name the lane doing “À valider”");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Tu nommes la colonne doing « À valider »");
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(toModel(t.board()))), "copy")) back.do(command);
    expect(band(back, "doing")).toBe("À valider");
  });
});
