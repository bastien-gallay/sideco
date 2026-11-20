/**
 * The sheet of keys says what the board in view takes: a plan's own axes by
 * their names, and the double-clicks that rewrite a lane's subtitle or an axis.
 */
import { describe, expect, test } from "bun:test";
import { MESSAGES } from "../../src/web/messages.ts";

const says = (rows: [string, string][]) => rows.map(([keys, does]) => `${keys} = ${does}`).join("\n");

describe("the sheet of keys", () => {
  test("names a plan's axes as the board does", () => {
    expect(says(MESSAGES.en.shortcutList("grid", false, { y: "Origin", x: "Effect" }))).toContain(
      "↑ ↓ Origin, ← → Effect",
    );
    expect(says(MESSAGES.fr.shortcutList("grid", false, { y: "Origine", x: "Effet" }))).toContain(
      "↑ ↓ Origine, ← → Effet",
    );
  });

  test("tells Shift+Enter on a lane heading", () => {
    expect(says(MESSAGES.en.shortcutList("kanban", true))).toContain("Shift + Enter writes its subtitle");
    expect(says(MESSAGES.fr.shortcutList("kanban", true))).toContain("Maj + Entrée écrit son sous-titre");
  });

  test("tells the double-clicks on a subtitle, and on an axis or its ends", () => {
    const kanban = says(MESSAGES.en.mouseList("kanban"));
    expect(kanban).toContain("Double-click a lane's subtitle, or Add a subtitle under its name");
    expect(kanban).not.toContain("axis");
    const grid = says(MESSAGES.en.mouseList("grid"));
    expect(grid).toContain("Double-click an axis, or a word at one of its ends");
    expect(says(MESSAGES.fr.mouseList("grid"))).toContain(
      "Double-clic sur un axe, ou un mot à l'un de ses bouts",
    );
    expect(says(MESSAGES.en.mouseList("graph"))).not.toContain("subtitle");
  });
});
