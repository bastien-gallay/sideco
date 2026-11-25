/**
 * The sheet of keys in sections (T282): the keys that move the keyboard, those
 * that act on a card, those of the page, each under its name; and, where the
 * lanes are a board's own, what the heading of a lane takes, key by key. The
 * words of the headings are here: messages.ts is at its ceiling.
 */
import type { Locale } from "../domain/i18n.ts";
import type { SheetKind } from "./messages.ts";

type Row = [keys: string, does: string];

export interface KeySection {
  title: string;
  rows: Row[];
}

const WORDS: Record<Locale, { moving: string; card: string; page: string; lane: KeySection }> = {
  en: {
    moving: "Moving about",
    card: "Changing a card",
    page: "The page",
    lane: {
      title: "A lane heading",
      rows: [
        ["← →", "To the heading beside it"],
        ["↓", "To the cards of the lane"],
        ["Enter or F2", "Rename the lane"],
        ["Shift + Enter", "Write its subtitle"],
        ["Shift + ← →", "Move the lane"],
        ["+ or Alt + ← →", "Add a lane beside it"],
        ["Delete", "Remove the lane, when it is empty"],
      ],
    },
  },
  fr: {
    moving: "Se déplacer",
    card: "Changer une carte",
    page: "La page",
    lane: {
      title: "Un en-tête de colonne",
      rows: [
        ["← →", "À l'en-tête voisin"],
        ["↓", "Aux cartes de la colonne"],
        ["Entrée ou F2", "Renommer la colonne"],
        ["Maj + Entrée", "Écrire son sous-titre"],
        ["Maj + ← →", "Déplacer la colonne"],
        ["+ ou Alt + ← →", "Ajouter une colonne à côté"],
        ["Suppr", "Supprimer la colonne, si elle est vide"],
      ],
    },
  },
};

/** A key held with an arrow: the first of those that act on a card. */
const ACTS = /\+ [←→]/;

/**
 * The rows of the sheet under their headings. The rows keep their order: those before the first key held with an
 * arrow move the keyboard; from there to the search, they act on a card; the search and what follows are the page's.
 */
export function keySections(rows: readonly Row[], locale: Locale, how: SheetKind): KeySection[] {
  const w = WORDS[locale];
  const acts = rows.findIndex(([keys]) => ACTS.test(keys));
  const page = rows.findIndex(([keys]) => keys.startsWith("/"));
  const from = acts < 0 ? rows.length : acts;
  const to = page < 0 ? rows.length : page;
  const sections: KeySection[] = [
    { title: w.moving, rows: rows.slice(0, Math.min(from, to)) },
    { title: w.card, rows: rows.slice(Math.min(from, to), to) },
    { title: w.page, rows: rows.slice(to) },
  ];
  if (how === "kanban") sections.push(w.lane);
  return sections.filter((section) => section.rows.length > 0);
}
