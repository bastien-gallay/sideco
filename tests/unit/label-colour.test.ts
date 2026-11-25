import { describe, expect, test } from "bun:test";
import { parseCommand } from "../../src/domain/commands.ts";
import { exportBoard } from "../../src/domain/export/index.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { describeLabels } from "../../src/domain/project-digest.ts";
import { LABEL_COLOURS, labelColours } from "../../src/domain/render/labels.ts";
import { sceneToSvg } from "../../src/domain/render/svg.ts";
import { KANBAN, table } from "../support.ts";

describe("the colour of a label's key (S328)", () => {
  test("a key is given one of the eight colours, for every board of the project", () => {
    const t = table(KANBAN).script("colour type pink");
    expect(t.events.at(-1)).toMatchObject({ event: "LabelColoured", key: "type", colour: "pink" });
    expect("board" in (t.events.at(-1) ?? {})).toBe(false);
    expect(t.ws.colours).toEqual({ type: "pink" });
  });

  test("the key is read as a label is: its case does not count, `type:` and `type:bug` say `type`, `@` says assignee", () => {
    const t = table(KANBAN)
      .script("colour Type: pink")
      .script("colour epic:site teal")
      .script("colour @ green");
    expect(t.ws.colours).toEqual({ type: "pink", epic: "teal", assignee: "green" });
  });

  test("asked for the colour it has, nothing is recorded; `auto` gives the key back to chance", () => {
    const t = table(KANBAN).script("colour type pink");
    const before = t.events.length;
    t.script("colour type pink");
    expect(t.events.length).toBe(before);
    t.script("colour type auto");
    expect(t.events.at(-1)).toMatchObject({ event: "LabelColoured", key: "type" });
    expect(t.events.at(-1)).not.toHaveProperty("colour");
    expect(t.ws.colours).toEqual({});
    const after = t.events.length;
    t.script("colour type auto");
    expect(t.events.length).toBe(after);
  });

  test("a colour that is not one of the eight is refused, and the eight are named", () => {
    expect(() => table(KANBAN).script("colour type red")).toThrow(
      "`colour` must be one of: blue, green, purple, orange, teal, pink, olive, grey",
    );
    expect(() => parseCommand({ kind: "colour-label", key: " ", colour: "pink" })).toThrow();
  });

  test("a label wears the colour chosen for its key; the others keep theirs", () => {
    const pink = LABEL_COLOURS[5];
    expect(labelColours("type:bug", { type: "pink" })).toEqual(pink as (typeof LABEL_COLOURS)[number]);
    expect(labelColours("TYPE:Feature", { type: "pink" })).toEqual(pink as (typeof LABEL_COLOURS)[number]);
    expect(labelColours("epic:site", { type: "pink" })).toEqual(labelColours("epic:site"));
    // A name no build knows, written by a later one: chance again.
    expect(labelColours("type:bug", { type: "mauve" })).toEqual(labelColours("type:bug"));
  });

  test("a card drawn wears it, in the page and on paper", () => {
    const t = table(KANBAN).script('add task "Corriger" --lane todo').script("colour type teal");
    const id = t.board().elements.at(-1)?.id ?? "";
    t.script(`label ${id} type:bug epic:site`);
    const scene = layoutBoard(t.board(), "en", { colours: t.ws.colours });
    expect(scene.cards.find((c) => c.id === id)?.tints).toEqual({ type: "teal" });
    expect(sceneToSvg(scene, "t")).toContain(`fill="${LABEL_COLOURS[4]?.fill}"`);
    // Chance gives `type` pink: teal is there by choice alone.
    expect(sceneToSvg(layoutBoard(t.board(), "en"), "t")).not.toContain(`fill="${LABEL_COLOURS[4]?.fill}"`);
    // Without a choice, a card says nothing of colours: it is drawn as it always was.
    expect(layoutBoard(t.board(), "en").cards.find((c) => c.id === id)).not.toHaveProperty("tints");
  });

  test("a board exported wears the colours chosen, as a drawing and as a page", () => {
    const t = table(KANBAN).script('add task "Corriger" --lane todo').script("colour type teal");
    const id = t.board().elements.at(-1)?.id ?? "";
    t.script(`label ${id} type:bug`);
    const meta = { exportedAt: "2026-11-25T00:00:00Z", colours: t.ws.colours };
    const teal = `fill="${LABEL_COLOURS[4]?.fill}"`;
    expect(exportBoard(t.board(), "svg", meta)).toContain(teal);
    expect(exportBoard(t.board(), "html", meta)).toContain(teal);
    expect(exportBoard(t.board(), "svg", { exportedAt: meta.exportedAt })).not.toContain(teal);
  });

  test("the list of the labels says which keys were given a colour", () => {
    const t = table(KANBAN).script('add task "Corriger" --lane todo');
    const id = t.board().elements.at(-1)?.id ?? "";
    t.script(`label ${id} type:bug epic:site`);
    expect(describeLabels(t.ws)).not.toContain("colours");
    t.script("colour type pink").script("colour epic teal");
    expect(describeLabels(t.ws).split("\n").at(-1)).toBe("colours  epic teal · type pink");
    expect(describeLabels(t.ws, "type").split("\n").at(-1)).toBe("colours  type pink");
    expect(describeLabels(t.ws, "assignee")).not.toContain("colours");
  });
});
