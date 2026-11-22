/**
 * What a lane stands for and what the axes of a plan say belong to the board:
 * the workshop gives them, the board may say them its own way. A SWOT drawn on
 * an impact / effort plan does not keep "High impact · low effort" under
 * "Strength", nor "Effort" along the bottom.
 */
import { describe, expect, test } from "bun:test";
import { boardAction } from "../../src/cli/argv.ts";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { IMPACT_EFFORT, KANBAN, ORDERING, type Table, table } from "../support.ts";

const lane = (t: Table, id: string, locale: "en" | "fr" = "en") =>
  layoutBoard(t.board(), locale).bands.find((b) => b.kind === "lane" && b.id === id);
const axis = (t: Table, id: "x" | "y", locale: "en" | "fr" = "en") => {
  const b = layoutBoard(t.board(), locale).bands.find((band) => band.kind === "axis" && band.id === id);
  return b && [b.label, b.low, b.high];
};

describe("what a lane stands for, on one board", () => {
  test('`lane hint ID "…"` says it; the same again records nothing; an unknown lane is refused', () => {
    const t = table(IMPACT_EFFORT).script('lane hint quick "Interne · positif"');
    expect(t.events.at(-1)).toMatchObject({ event: "LaneHinted", lane: "quick", hint: "Interne · positif" });
    expect(lane(t, "quick")?.hint).toBe("Interne · positif");
    expect(lane(t, "quick", "fr")?.hint).toBe("Interne · positif");
    expect(lane(t, "bet")?.hint).toBe("High impact · high effort");
    const seq = t.seq;
    t.script('lane hint quick "Interne · positif"');
    expect(t.seq).toBe(seq);
    expect(() => t.script('lane hint nowhere "X"')).toThrow('no lane "nowhere"');
    expect(() => table(ORDERING).script('lane hint todo "X"')).toThrow("no lanes");
  });

  test("an empty hint gives the workshop's back; a lane of the board's own takes one too", () => {
    const t = table(IMPACT_EFFORT).script('lane hint quick "Interne · positif"\nlane hint quick ""');
    expect(lane(t, "quick")?.hint).toBe("High impact · low effort");
    const k = table(KANBAN).script('lane add "Revue" --before done\nlane hint lane-1 "Relu par un pair"');
    expect(lane(k, "lane-1")?.hint).toBe("Relu par un pair");
  });

  test("the agent reads it on the board and among the changes", () => {
    const t = table(IMPACT_EFFORT);
    const mark = t.seq;
    t.script('lane quick "Strength"\nlane hint quick "Interne · positif"', "human");
    expect(describeBoard(t.board())).toContain("lane quick (Strength: Interne · positif)");
    expect(describeChanges(t.events, mark).text).toContain('~ lane quick hinted "Interne · positif"');
  });

  test("undo gives the former hint back, and a removed lane takes its hint with it and back", () => {
    const t = table(IMPACT_EFFORT).script('lane hint quick "Un"', "human");
    t.script('lane hint quick "Deux"', "human");
    t.do({ kind: "undo", board: "priorites" }, "human");
    expect(lane(t, "quick")?.hint).toBe("Un");
    t.do({ kind: "undo", board: "priorites" }, "human");
    expect(lane(t, "quick")?.hint).toBe("High impact · low effort");

    const k = table(KANBAN).script('lane add "Revue"\nlane hint lane-1 "Relu"\nlane rm lane-1', "human");
    expect(k.board().hints?.["lane-1"]).toBeUndefined();
    k.do({ kind: "undo", board: "sprint" }, "human");
    expect(lane(k, "lane-1")?.hint).toBe("Relu");
  });

  test("the history words it, and a model read back keeps it", () => {
    const t = table(IMPACT_EFFORT).script('lane hint quick "Interne · positif"', "human");
    expect(describeEvent(t.events.at(-1) as never)).toBe(
      "You say what the lane quick stands for: “Interne · positif”",
    );
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe(
      "Tu dis ce que la colonne quick représente : « Interne · positif »",
    );
    // Told with the board at hand, the lane goes by its name, not by its id.
    expect(describeEvent(t.events.at(-1) as never, "en", t.ws)).toBe(
      "You say what the lane “Quick wins” stands for: “Interne · positif”",
    );
    t.script('lane quick "Strength"', "human");
    expect(describeEvent(t.events.at(-1) as never, "en", t.ws)).toBe(
      "You name the lane “Quick wins” “Strength”",
    );
    t.script('lane hint quick "Interne · utile"', "human");
    expect(describeEvent(t.events.at(-1) as never, "fr", t.ws)).toBe(
      "Tu dis ce que la colonne « Strength » représente : « Interne · utile »",
    );
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(toModel(t.board()))), "copy")) back.do(command);
    expect(lane(back, "quick")?.hint).toBe("Interne · utile");
  });
});

describe("the axes of a plan, on one board", () => {
  test('`axis ID "Name" "Low" "High"` names an axis and its two ends, in every language', () => {
    const t = table(IMPACT_EFFORT).script(
      'axis x "Effet" "Utile" "Nuisible"\naxis y "Origine" "Externe" "Interne"',
    );
    expect(t.events.at(-1)).toMatchObject({
      event: "AxisNamed",
      axis: "y",
      label: "Origine",
      low: "Externe",
      high: "Interne",
    });
    expect(axis(t, "x")).toEqual(["Effet", "Utile", "Nuisible"]);
    expect(axis(t, "y", "fr")).toEqual(["Origine", "Externe", "Interne"]);
  });

  test("the ends left out stay as they were; the same again records nothing", () => {
    const t = table(IMPACT_EFFORT).script('axis y "Valeur"');
    expect(axis(t, "y")).toEqual(["Valeur", "low", "high"]);
    expect(axis(t, "y", "fr")).toEqual(["Valeur", "faible", "fort"]);
    expect(axis(t, "x")).toEqual(["Effort", "low", "high"]);
    const seq = t.seq;
    t.script('axis y "Valeur"');
    expect(t.seq).toBe(seq);
  });

  test("an empty name gives the workshop's axis back; a board without a plan, or another axis, is refused", () => {
    const t = table(IMPACT_EFFORT).script('axis x "Effet" "Utile" "Nuisible"\naxis x ""');
    expect(axis(t, "x")).toEqual(["Effort", "low", "high"]);
    expect(() => table(KANBAN).script('axis x "X"')).toThrow("no axes");
    expect(() => table(IMPACT_EFFORT).script('axis z "X"')).toThrow('no axis "z"');
  });

  test("the agent reads the axes on the board, and their change", () => {
    const t = table(IMPACT_EFFORT);
    expect(describeBoard(t.board())).toContain('axis x "Effort" (low → high)');
    const mark = t.seq;
    t.script('axis x "Effet" "Utile" "Nuisible"', "human");
    expect(describeBoard(t.board())).toContain('axis x "Effet" (Utile → Nuisible)');
    expect(describeChanges(t.events, mark).text).toContain('~ axis x named "Effet" (Utile → Nuisible)');
  });

  test("undo gives the former axis back; the history words it; a model read back keeps it", () => {
    const t = table(IMPACT_EFFORT).script('axis x "Effet" "Utile" "Nuisible"', "human");
    expect(describeEvent(t.events.at(-1) as never)).toBe(
      "You name the axis x “Effet”, from “Utile” to “Nuisible”",
    );
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe(
      "Tu nommes l'axe x « Effet », de « Utile » à « Nuisible »",
    );
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(toModel(t.board()))), "copy")) back.do(command);
    expect(axis(back, "x")).toEqual(["Effet", "Utile", "Nuisible"]);
    t.do({ kind: "undo", board: "priorites" }, "human");
    expect(axis(t, "x")).toEqual(["Effort", "low", "high"]);
  });

  test("the command line takes one to three words after the axis, no more", () => {
    expect(() => boardAction(["axis", "x", "A", "B", "C", "D"], "priorites")).toThrow("takes 4 arguments");
  });
});
