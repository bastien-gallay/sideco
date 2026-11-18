/**
 * The languages Vico speaks to its readers. English unless the reader asks
 * otherwise; what the agent reads (the digest, the errors) is always English.
 */
import type { Actor } from "./events.ts";

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** One text in every language. */
export type Text = Readonly<Record<Locale, string>>;

/** The locale behind a language tag as a shell (`fr_FR.UTF-8`) or a browser (`fr-FR`) writes it. */
export function asLocale(tag: string | null | undefined): Locale | undefined {
  const language = tag?.trim().toLowerCase().split(/[-_.]/)[0];
  return LOCALES.find((locale) => locale === language);
}

/** The words of the drawing and of the exported documents. */
export interface Words {
  /** A card's tooltip: who put it on the board. */
  addedBy: Record<Actor, string>;
  /** A card's tooltip, and its mark: what it stands for is done. */
  done: string;
  /** An author, in a table cell. */
  who: Record<Actor, string>;
  step: string;
  column: string;
  elements: string;
  noElement: string;
  label: string;
  detail: string;
  by: string;
  links: string;
  from: string;
  to: string;
  openQuestions: string;
  resolvedNotes: string;
  /** `(on E1)`, after a note's id. */
  on: (target: string) => string;
  /** Between a note's author and its text: French puts a space before the colon. */
  colon: string;
  source: (board: string, seq: number, day: string) => string;
  board: string;
  workshop: string;
  otherFormats: string;
  published: (boards: number, day: string) => string;
  /** The title of a published site. */
  site: string;
}

export const WORDS: Record<Locale, Words> = {
  en: {
    addedBy: { agent: "added by Claude", human: "added by you", system: "added by the system" },
    done: "done",
    who: { human: "human", agent: "agent", system: "system" },
    step: "Step",
    column: "Column",
    elements: "Elements",
    noElement: "No element.",
    label: "Label",
    detail: "Detail",
    by: "By",
    links: "Links",
    from: "From",
    to: "To",
    openQuestions: "Open questions",
    resolvedNotes: "Resolved notes",
    on: (target) => `on ${target}`,
    colon: ":",
    source: (board, seq, day) => `Source: Vico journal, board ${board}, seq ${seq}, exported on ${day}.`,
    board: "Board",
    workshop: "Workshop",
    otherFormats: "Other formats",
    published: (boards, day) => `${boards} board${boards > 1 ? "s" : ""}, published on ${day}.`,
    site: "Vico boards",
  },
  fr: {
    addedBy: { agent: "ajouté par Claude", human: "ajouté par toi", system: "ajouté par le système" },
    done: "fait",
    who: { human: "humain", agent: "agent", system: "système" },
    step: "Étape",
    column: "Colonne",
    elements: "Éléments",
    noElement: "Aucun élément.",
    label: "Libellé",
    detail: "Détail",
    by: "Par",
    links: "Liens",
    from: "De",
    to: "Vers",
    openQuestions: "Questions ouvertes",
    resolvedNotes: "Notes résolues",
    on: (target) => `sur ${target}`,
    colon: " :",
    source: (board, seq, day) => `Source : journal Vico, tableau ${board}, seq ${seq}, exporté le ${day}.`,
    board: "Tableau",
    workshop: "Atelier",
    otherFormats: "Autres formats",
    published: (boards, day) =>
      `${boards} tableau${boards > 1 ? "x" : ""}, publié${boards > 1 ? "s" : ""} le ${day}.`,
    site: "Tableaux Vico",
  },
};
