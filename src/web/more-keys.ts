/**
 * Keys the sheet tells that messages.ts does not hold (S332, S334): messages.ts is
 * at its ceiling, so a new key says its words here, and where it goes on the sheet.
 */
import type { Locale } from "../domain/i18n.ts";

/** Each key with the key it follows on the sheet. */
interface More {
  /** The key this one follows; with `starts`, the key that starts by it: Alt and its arrows differ by board. */
  after: string;
  starts?: true;
  row: [string, string];
  /** What the row says on a kanban, in its word, and on a diagram, where the key does not do quite the same. */
  kanban?: [string, string];
  graph?: [string, string];
  columns?: true;
  cells?: true;
}

const MORE: Record<Locale, More[]> = {
  en: [
    {
      after: "← → ↑ ↓",
      columns: true,
      row: ["Page ↑ ↓, Home, End", "Along the column: a page further, its first card, its last"],
    },
    // Where it lands is the board's to say: under the card, in the lane of its kind, at the next rank of a diagram.
    {
      after: "Alt +",
      starts: true,
      row: ["A", "Add a card linked from this one"],
      graph: ["A", "The same: the next step, linked"],
    },
    { after: "E", row: ["I", "Read its detail, in the right panel"] },
    {
      after: "/ or ⌘K / Ctrl+K",
      row: ["B, S", "To the boards; to Claude's sessions"],
    },
    {
      after: "Shift + ← → ↑ ↓",
      cells: true,
      row: ["Shift + Home, End", "Send the card to the top of its cell, or to its foot"],
      kanban: ["Shift + Home, End", "Send the card to the top of its lane, or to its foot"],
    },
    { after: "E", row: ["T", "Add a label, in the right panel"] },
    { after: "Space", row: ["X", "Keep it chosen, and choose more"] },
    { after: "Space", row: ["F", "Put the card chosen in the focus, or take it out"] },
  ],
  fr: [
    {
      after: "← → ↑ ↓",
      columns: true,
      row: [
        "Page ↑ ↓, Début, Fin",
        "Le long de la colonne : une page plus loin, sa première carte, sa dernière",
      ],
    },
    {
      after: "Alt +",
      starts: true,
      row: ["A", "Ajouter une carte liée à celle-ci"],
      graph: ["A", "De même : l'étape suivante, liée"],
    },
    { after: "E", row: ["I", "Lire son détail, dans le panneau de droite"] },
    {
      after: "/ ou ⌘K / Ctrl+K",
      row: ["B, S", "Aux tableaux ; aux sessions de Claude"],
    },
    {
      after: "Maj + ← → ↑ ↓",
      cells: true,
      row: ["Maj + Début, Fin", "Envoyer la carte en haut de sa case, ou en bas"],
      kanban: ["Maj + Début, Fin", "Envoyer la carte en haut de sa colonne, ou en bas"],
    },
    { after: "E", row: ["T", "Ajouter un label, dans le panneau de droite"] },
    {
      after: "Espace",
      row: ["X", "La garder choisie, en choisir d'autres"],
    },
    { after: "Espace", row: ["F", "Mettre la carte choisie au focus, ou l'en sortir"] },
  ],
};

/**
 * The rows of the sheet with the keys told here, each after the key it follows; left out where that key is not
 * told. A key of the columns is told where the lanes are columns: a kanban, a retro; a key of the cells where
 * the board has cells, which a diagram has not.
 */
export function withMoreKeys(
  rows: readonly [string, string][],
  locale: Locale,
  columns = false,
  cells = true,
): [string, string][] {
  const told = MORE[locale].filter((more) => (columns || !more.columns) && (cells || !more.cells));
  const follows = (more: More, key: string) =>
    more.starts ? key.startsWith(more.after) : more.after === key;
  const says = (more: More) => (columns && more.kanban) || (!cells && more.graph) || more.row;
  return rows.flatMap((row) => [row, ...told.filter((more) => follows(more, row[0])).map(says)]);
}
