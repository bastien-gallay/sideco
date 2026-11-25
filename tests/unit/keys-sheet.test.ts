/**
 * The sheet of keys says what the board in view takes: a plan's own axes by
 * their names, and the double-clicks that rewrite a lane's subtitle or an axis.
 */
import { describe, expect, test } from "bun:test";
import { MESSAGES } from "../../src/web/messages.ts";
import { withMoreKeys } from "../../src/web/more-keys.ts";

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

  test("tells T, which adds a label, after E (S332)", () => {
    const en = withMoreKeys(MESSAGES.en.shortcutList("kanban", true), "en").map(([keys]) => keys);
    expect(en[en.indexOf("E") + 2]).toBe("T");
    expect(says(withMoreKeys(MESSAGES.fr.shortcutList("kanban", true), "fr"))).toContain(
      "T = Ajouter un label, dans le panneau de droite",
    );
  });

  test("tells the keys that go along a column where the lanes are columns, after the arrows (T284)", () => {
    const rows = MESSAGES.en.shortcutList("kanban", true);
    const en = withMoreKeys(rows, "en", true).map(([keys]) => keys);
    expect(en[en.indexOf("← → ↑ ↓") + 1]).toBe("Page ↑ ↓, Home, End");
    expect(withMoreKeys(rows, "en").map(([keys]) => keys)).not.toContain("Page ↑ ↓, Home, End");
    expect(says(withMoreKeys(MESSAGES.fr.shortcutList("kanban", true), "fr", true))).toContain(
      "Page ↑ ↓, Début, Fin = Le long de la colonne",
    );
  });

  test("tells I, which reads the detail, after E which writes it (T276)", () => {
    const en = withMoreKeys(MESSAGES.en.shortcutList("kanban", true), "en").map(([keys]) => keys);
    expect(en[en.indexOf("E") + 1]).toBe("I");
    expect(says(withMoreKeys(MESSAGES.fr.shortcutList("graph", true), "fr"))).toContain(
      "I = Lire son détail, dans le panneau de droite",
    );
  });

  test("tells A, which adds a linked card, after Alt and the arrows which add one too (T272, T304)", () => {
    const en = withMoreKeys(MESSAGES.en.shortcutList("kanban", true), "en").map(([keys]) => keys);
    expect(en[en.indexOf("Alt + ← → ↑ ↓") + 1]).toBe("A");
    expect(says(withMoreKeys(MESSAGES.fr.shortcutList("kanban", true), "fr"))).toContain(
      "A = Ajouter une carte liée à celle-ci, sous elle",
    );
    // On a diagram Alt and an arrow say it already, and nothing is under a card: A is the same, one way.
    const flow = says(withMoreKeys(MESSAGES.en.shortcutList("graph", true), "en", false, false));
    expect(flow).toContain("A = The same, to its right");
    expect(flow).not.toContain("under it");
  });

  test("says a row in the word of the board, and in one line (T304)", () => {
    // A kanban has lanes: the key that sends a card to an end says lane, as Shift and the arrows do.
    const kanban = says(withMoreKeys(MESSAGES.en.shortcutList("kanban", true), "en", true));
    expect(kanban).toContain("Shift + Home, End = Send the card to the top of its lane, or to its foot");
    expect(says(withMoreKeys(MESSAGES.fr.shortcutList("kanban", true), "fr", true))).toContain(
      "Maj + Début, Fin = Envoyer la carte en haut de sa colonne, ou en bas",
    );
    // X stands by Space, which chooses too.
    const keys = withMoreKeys(MESSAGES.en.shortcutList("kanban", true), "en").map(([key]) => key);
    expect(keys[keys.indexOf("Space") + 1]).toBe("X");
    // No row of the sheet is a paragraph: the guide tells the rest.
    for (const locale of ["en", "fr"] as const)
      for (const how of ["timeline", "lanes", "kanban", "grid", "graph"] as const)
        for (const [, does] of withMoreKeys(MESSAGES[locale].shortcutList(how, true), locale, true))
          expect(does.length).toBeLessThanOrEqual(80);
  });

  test("tells Shift and Home or End, which send a card to an end of its cell, after Shift and the arrows (S355)", () => {
    const en = withMoreKeys(MESSAGES.en.shortcutList("kanban", true), "en").map(([keys]) => keys);
    expect(en[en.indexOf("Shift + ← → ↑ ↓") + 1]).toBe("Shift + Home, End");
    expect(says(withMoreKeys(MESSAGES.fr.shortcutList("kanban", true), "fr"))).toContain(
      "Maj + Début, Fin = Envoyer la carte en haut de sa case, ou en bas",
    );
    // A diagram has no cell: its sheet does not tell a key that does nothing there.
    expect(says(withMoreKeys(MESSAGES.en.shortcutList("graph", true), "en", false, false))).not.toContain(
      "Home, End",
    );
  });

  test("tells B and S, which reach the lists of boards and of sessions, after the search (T275, T273)", () => {
    const en = withMoreKeys(MESSAGES.en.shortcutList("kanban", true), "en").map(([keys]) => keys);
    expect(en[en.indexOf("/ or ⌘K / Ctrl+K") + 1]).toBe("B, S");
    expect(says(withMoreKeys(MESSAGES.fr.shortcutList("graph", true), "fr"))).toContain(
      "B, S = À la liste des tableaux ; à celle des sessions de Claude, s'il y en a plusieurs",
    );
  });

  test("tells Redo beside Undo, with every key that does it", () => {
    expect(says(MESSAGES.en.shortcutList("kanban", true))).toContain(
      "⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y = Redo the change undone",
    );
    expect(says(MESSAGES.fr.shortcutList("kanban", true))).toContain(
      "⇧⌘Z / Ctrl+Maj+Z ou Ctrl+Y = Rétablir le changement annulé",
    );
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
