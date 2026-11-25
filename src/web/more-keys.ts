/**
 * Keys the sheet tells that messages.ts does not hold (S332, S334): messages.ts is
 * at its ceiling, so a new key says its words here, and where it goes on the sheet.
 */
import type { Locale } from "../domain/i18n.ts";

/** Each key with the key it follows on the sheet. */
const MORE: Record<Locale, { after: string; row: [string, string]; columns?: true }[]> = {
  en: [
    {
      after: "← → ↑ ↓",
      columns: true,
      row: ["Page ↑ ↓, Home, End", "Along the column: a page further, its first card, its last"],
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
 * told. A key of the columns is told where the lanes are columns: a kanban, a retro.
 */
export function withMoreKeys(
  rows: readonly [string, string][],
  locale: Locale,
  columns = false,
): [string, string][] {
  const told = MORE[locale].filter((more) => columns || !more.columns);
  return rows.flatMap((row) => [row, ...told.filter((more) => more.after === row[0]).map((m) => m.row)]);
}
