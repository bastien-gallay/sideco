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

interface Words {
  moving: string;
  placing: string;
  card: string;
  page: string;
  lane: KeySection;
  axis: KeySection;
}

const WORDS: Record<Locale, Words> = {
  en: {
    moving: "Moving about",
    placing: "Moving a card, adding one",
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
    axis: {
      title: "An axis of the plan",
      rows: [
        ["Tab", "To an axis, or to a word at one of its ends"],
        ["Enter or F2", "Rename it for this board"],
      ],
    },
  },
  fr: {
    moving: "Se déplacer",
    placing: "Déplacer une carte, en ajouter une",
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
    axis: {
      title: "Un axe du plan",
      rows: [
        ["Tab", "À un axe, ou à un mot à l'un de ses bouts"],
        ["Entrée ou F2", "Le renommer pour ce tableau"],
      ],
    },
  },
};

/** A key held with an arrow: the first of those that act on a card. */
const ACTS = /\+ [←→]/;
/** A key that moves a card or adds one beside it: one held with another, or A. */
const PLACES = /\+ |^A$/;

/**
 * The rows of the sheet under their headings. The rows keep their order: those before the first key held with an
 * arrow move the keyboard; from there to the search, they act on a card; the search and what follows are the page's.
 * The keys of a card are two sections (T304): one of fifteen rows was a column of the sheet by itself.
 */
export function keySections(rows: readonly Row[], locale: Locale, how: SheetKind): KeySection[] {
  const w = WORDS[locale];
  const acts = rows.findIndex(([keys]) => ACTS.test(keys));
  const page = rows.findIndex(([keys]) => keys.startsWith("/"));
  const from = acts < 0 ? rows.length : acts;
  const to = page < 0 ? rows.length : page;
  const start = Math.min(from, to);
  // Of the keys of a card, those held with another, and A which adds as Alt does, place it or add beside it.
  const changes = rows.findIndex(([keys], at) => at >= start && !PLACES.test(keys));
  const split = changes < 0 || changes > to ? to : changes;
  const sections: KeySection[] = [
    { title: w.moving, rows: rows.slice(0, start) },
    { title: w.placing, rows: rows.slice(start, split) },
    { title: w.card, rows: rows.slice(split, to) },
    { title: w.page, rows: rows.slice(to) },
  ];
  if (how === "kanban") sections.push(w.lane);
  // What the keyboard does to an axis was told among the gestures of the mouse.
  if (how === "grid") sections.push(w.axis);
  return sections.filter((section) => section.rows.length > 0);
}
