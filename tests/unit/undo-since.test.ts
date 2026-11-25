/**
 * An undo never overwrites, unsaid, what the other author did since: a card put
 * in a column, a lane taken away, a kind changed (S356, audit SY-1, SY-2, SY-3, SY-7).
 */
import { describe, expect, test } from "bun:test";
import type { Actor } from "../../src/domain/events.ts";
import { lanesOf } from "../../src/domain/formats.ts";
import { findElement } from "../../src/domain/workspace.ts";
import { KANBAN, ORDERING, type Table, table } from "../support.ts";

const undo = (t: Table, board: string, actor: Actor = "human"): void => {
  t.do({ kind: "undo", board }, actor);
};
const last = (t: Table): string => t.board().elements.at(-1)?.id ?? "";
const formerly = (t: Table, id: string) =>
  t.board().elements.find((el) => el.id === id || el.formerIds?.includes(id));

describe("a column inserted, then given a card by Claude", () => {
  test("taking the column back is refused: Claude's card stays where it was put", () => {
    const t = table(ORDERING).script("insert-col 2", "human");
    t.script('add event "Nouveau" --col 2', "agent");
    const card = last(t);
    expect(() => undo(t, "commande")).toThrow(/^refused: your gesture seq \d+ \(insert-col 2\)/);
    expect(findElement(t.board(), card)?.col).toBe(2);
  });

  test("a card put in another column does not stand in the way", () => {
    const t = table(ORDERING).script("insert-col 2", "human");
    t.script('add event "Plus loin" --col 3', "agent");
    const card = last(t);
    undo(t, "commande");
    expect(findElement(t.board(), card)?.col).toBe(2);
  });
});

describe("a lane taken away by Claude", () => {
  const withLane = (): { t: Table; lane: string; card: string } => {
    const t = table(KANBAN).script('lane add "Revue"', "human");
    const lane = lanesOf(t.board()).find((l) => l.startsWith("lane-")) ?? "";
    t.script(`add task "X" --lane ${lane}`, "human");
    return { t, lane, card: last(t) };
  };

  test("moving a card back into it is refused, and the card stays on the board", () => {
    const { t, lane, card } = withLane();
    t.script(`move ${card} --lane doing`, "human");
    t.script(`lane rm ${lane}`, "agent");
    expect(() => undo(t, "sprint")).toThrow(/^refused: .*lane rm/);
    expect(findElement(t.board(), card)?.lane).toBe("doing");
  });

  test("restoring a card into it is refused", () => {
    const { t, lane, card } = withLane();
    t.script(`rm ${card}`, "human");
    t.script(`lane rm ${lane}`, "agent");
    expect(() => undo(t, "sprint")).toThrow(/^refused: .*lane rm/);
    expect(findElement(t.board(), card)).toBeUndefined();
  });

  test("Claude moving another card into the same lane does not stand in the way", () => {
    const t = table(KANBAN).script('add task "Moi" --lane todo', "human");
    const mine = last(t);
    t.script(`move ${mine} --lane doing`, "human");
    t.script('add task "Claude" --lane done', "agent");
    t.script(`move ${last(t)} --lane todo`, "agent");
    undo(t, "sprint");
    expect(findElement(t.board(), mine)?.lane).toBe("todo");
  });
});

describe("a card renumbered or retyped, then changed by the other author", () => {
  test("Claude retyped it since: your retype is not taken back over Claude's", () => {
    const t = table(ORDERING).script("retype E1 hotspot", "human");
    const hot = formerly(t, "E1")?.id ?? "";
    t.script(`retype ${hot} policy`, "agent");
    expect(() => undo(t, "commande")).toThrow(/^refused: your gesture seq \d+ \(retype E1 hotspot/);
    expect(formerly(t, "E1")?.type).toBe("policy");
  });

  test("Claude renamed it since: your renumber still comes back, and the new name stays", () => {
    const t = table(ORDERING).script("renumber E1", "human");
    const now = formerly(t, "E1")?.id ?? "";
    t.script(`rename ${now} "Par Claude"`, "agent");
    undo(t, "commande");
    expect(findElement(t.board(), "E1")?.label).toBe("Par Claude");
  });

  test("the human removed the card Claude renumbered: Claude's undo is refused, not a silent ok", () => {
    const t = table(ORDERING).script("renumber E1", "agent");
    t.script(`rm ${formerly(t, "E1")?.id}`, "human");
    expect(() => undo(t, "commande", "agent")).toThrow(/^refused: your gestures? seq \d+ \(renumber E1/);
  });
});
