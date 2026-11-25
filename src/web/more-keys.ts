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
      row: [
        "Page ↑ ↓, Home, End",
        "Along the column of the card: a window further, its first card, its last",
      ],
    },
    { after: "E", row: ["T", "Add a label to the card, in the panel on the right"] },
    {
      after: "E",
      row: [
        "X",
        "Keep the card chosen while an arrow goes to the next, chosen in turn (or Shift and a click): D and Delete are then for them all",
      ],
    },
    { after: "E", row: ["F", "Point at the card chosen as Claude does, or no longer: it joins the focus"] },
  ],
  fr: [
    {
      after: "← → ↑ ↓",
      columns: true,
      row: [
        "Page ↑ ↓, Début, Fin",
        "Le long de la colonne de la carte : une fenêtre plus loin, sa première carte, sa dernière",
      ],
    },
    { after: "E", row: ["T", "Ajouter un label à la carte, dans le panneau de droite"] },
    {
      after: "E",
      row: [
        "X",
        "Garder la carte choisie pendant qu'une flèche passe à la suivante, choisie à son tour (ou Maj et un clic) : D et Suppr valent alors pour toutes",
      ],
    },
    {
      after: "E",
      row: ["F", "Viser la carte choisie comme le fait Claude, ou ne plus la viser : elle rejoint le focus"],
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
