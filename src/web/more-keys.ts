/**
 * Keys the sheet tells that messages.ts does not hold (S332, S334): messages.ts is
 * at its ceiling, so a new key says its words here, and where it goes on the sheet.
 */
import type { Locale } from "../domain/i18n.ts";

/** Each key with the key it follows on the sheet. */
const MORE: Record<Locale, { after: string; row: [string, string]; columns?: true; cells?: true }[]> = {
  en: [
    {
      after: "← → ↑ ↓",
      columns: true,
      row: ["Page ↑ ↓, Home, End", "Along the column: a page further, its first card, its last"],
    },
    {
      after: "L",
      row: ["A", "Add a card linked from this one: of the kind it leads to, else of its own, under it"],
    },
    { after: "E", row: ["I", "Read its detail, in the right panel"] },
    {
      after: "Shift + ← → ↑ ↓",
      cells: true,
      row: ["Shift + Home, End", "Send the card to the top of its cell, or to its foot"],
    },
    { after: "E", row: ["T", "Add a label, in the right panel"] },
    {
      after: "E",
      row: [
        "X",
        "Keep this card chosen while the arrows choose another (or Shift and a click): D and Delete are for them all",
      ],
    },
    { after: "E", row: ["F", "Put the card chosen in the focus, or take it out"] },
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
      after: "L",
      row: ["A", "Ajouter une carte liée à celle-ci : du type auquel elle mène, sinon du sien, sous elle"],
    },
    { after: "E", row: ["I", "Lire son détail, dans le panneau de droite"] },
    {
      after: "Maj + ← → ↑ ↓",
      cells: true,
      row: ["Maj + Début, Fin", "Envoyer la carte en haut de sa case, ou en bas"],
    },
    { after: "E", row: ["T", "Ajouter un label, dans le panneau de droite"] },
    {
      after: "E",
      row: [
        "X",
        "Garder cette carte choisie pendant que les flèches en choisissent une autre (ou Maj et un clic) : D et Suppr valent pour toutes",
      ],
    },
    {
      after: "E",
      row: ["F", "Mettre la carte choisie au focus, ou l'en sortir"],
    },
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
  return rows.flatMap((row) => [row, ...told.filter((more) => more.after === row[0]).map((m) => m.row)]);
}
