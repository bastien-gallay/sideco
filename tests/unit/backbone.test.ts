/**
 * A story map keeps its backbone in sight: once the activities have scrolled
 * under the step numbers, each step says there which activity and which task it
 * belongs to.
 */
import { describe, expect, test } from "bun:test";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { bandMarkup } from "../../src/domain/render/svg.ts";
import { ORDERING, table } from "../support.ts";

const MAP = `
board new "Carte" --format story-map --id carte
add activity "Trouver un livre" --col 1
add task "Chercher par titre" --col 1
add task "Parcourir les rayons de la bibliothèque municipale" --col 2
add activity "Emprunter" --col 3
add story "Recherche plein texte" --col 1
`;

const steps = (script: string) => layoutBoard(table(script).board()).bands.filter((b) => b.kind === "step");

describe("the steps of a story map", () => {
  test("carry their activity, which runs on until the next one, and their own task", () => {
    expect(steps(MAP).map((b) => b.caption)).toEqual([
      ["Trouver un livre", "Chercher par titre"],
      ["Trouver un livre", "Parcourir les rayons de l…"],
      ["Emprunter", ""],
      ["Emprunter", ""],
    ]);
  });

  test("say where the backbone ends: past it, the page shows the captions", () => {
    const scene = layoutBoard(table(MAP).board());
    const activities = scene.bands.find((b) => b.kind === "row" && b.id === "activity");
    expect(scene.backbone).toBe((activities?.y ?? 0) + (activities?.h ?? 0));
  });

  test("are drawn with the captions hidden, and on another timeline, without any", () => {
    const first = steps(MAP)[0];
    if (!first) throw new Error("no step");
    expect(bandMarkup(first)).toContain(`<text class="step-caption" data-col="1"`);
    expect(bandMarkup(first)).toContain(">Trouver un livre</text>");
    expect(steps(ORDERING).every((b) => b.caption === undefined)).toBe(true);
    expect(layoutBoard(table(ORDERING).board()).backbone).toBeUndefined();
  });
});
