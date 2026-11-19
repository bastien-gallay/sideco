/**
 * A retrospective: what went well and what did not, then what to keep, stop and
 * try. Its lanes are the board's own, done stays a mark, and a point leads to an
 * action, which lands in Try.
 */
import { describe, expect, test } from "bun:test";
import { findFormat, isDone, lanesOf } from "../../src/domain/formats.ts";
import { findElement } from "../../src/domain/workspace.ts";
import { table } from "../support.ts";

const RETRO = `board new "Rétro" --format retro --id retro`;
const retro = findFormat("retro");

describe("the lanes of a retrospective", () => {
  test("start with what went well and what did not, before keep, stop and try", () => {
    expect(lanesOf(table(RETRO).board())).toEqual(["went-well", "went-badly", "keep", "drop", "try"]);
  });

  test("are the board's own: one is added there, and done stays a mark, wherever the card is", () => {
    const t = table(`${RETRO}
add point "Revue rapide" --lane try`);
    expect(t.do({ kind: "add-lane", board: "retro", label: "Questions" })).toBe("lane-1");
    t.script("move P1 --lane lane-1\ndone P1");
    expect(t.events.at(-1)).toMatchObject({ event: "ElementMarked", id: "P1", done: true });
    expect(isDone(t.board(), { lane: "keep", done: true })).toBe(true);
    expect(isDone(t.board(), { lane: "lane-1" })).toBe(false);
  });
});

describe("a card added without a lane", () => {
  test("goes, for a point, to the first lane; for an action, to Try", () => {
    const t = table(`${RETRO}
add point "Revue rapide"
add action "Timeboxer"`);
    expect(findElement(t.board(), "P1")?.lane).toBe("went-well");
    expect(findElement(t.board(), "A1")?.lane).toBe("try");
  });

  test("goes to the first lane when the board no longer has Try", () => {
    const t = table(`${RETRO}
lane rm try
add action "Timeboxer"`);
    expect(findElement(t.board(), "A1")?.lane).toBe("went-well");
  });
});

describe("the ids of a retrospective", () => {
  test("a point is P, not K, which reads Keep; an id from before, K, is still taken", () => {
    expect(retro?.types.find((type) => type.id === "point")?.prefix).toBe("P");
    const t = table(`${RETRO}
add point "Ancien" --id K4`);
    expect(findElement(t.board(), "K4")?.type).toBe("point");
    expect(() => t.script(`add point "Autre" --id A9`)).toThrow("starts with P");
  });
});

describe("a point made into an action", () => {
  test("a point leads to an action, added in Try and linked from it", () => {
    expect(retro?.types.find((type) => type.id === "point")?.leadsTo?.type).toBe("action");
    const t = table(`${RETRO}
add point "Réunions longues" --lane went-badly`);
    t.do({ kind: "add", board: "retro", type: "action", label: "Timeboxer", from: "P1" }, "human");
    expect(findElement(t.board(), "A1")?.lane).toBe("try");
    expect(t.board().edges).toContainEqual(expect.objectContaining({ src: "P1", dst: "A1" }));
  });
});
