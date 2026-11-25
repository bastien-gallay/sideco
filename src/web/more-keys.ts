/**
 * Keys the sheet tells that messages.ts does not hold (S332): messages.ts is
 * at its ceiling, so a new key says its words here, and where it goes on the sheet.
 */
import type { Locale } from "../domain/i18n.ts";

/** Each key with the key it follows on the sheet. */
const MORE: Record<Locale, { after: string; row: [string, string] }[]> = {
  en: [{ after: "E", row: ["T", "Add a label to the card, in the panel on the right"] }],
  fr: [{ after: "E", row: ["T", "Ajouter un label à la carte, dans le panneau de droite"] }],
};

/** The rows of the sheet with the keys told here, each after the key it follows; left out where that key is not told. */
export function withMoreKeys(rows: readonly [string, string][], locale: Locale): [string, string][] {
  return rows.flatMap((row) => [
    row,
    ...MORE[locale].filter((more) => more.after === row[0]).map((m) => m.row),
  ]);
}
