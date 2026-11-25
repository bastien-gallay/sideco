/**
 * The languages Sideco speaks to its readers. English unless the reader asks
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
  /** Before the ids a card went by, renumbered since. */
  formerly: string;
  /** A card that splits another, and a card split: how many of its parts are done (see kin.ts). */
  splits: (card: string, others?: number) => string;
  splitDone: (done: number, of: number) => string;
  /** A card that says the same as another, and the card they are gathered on: how many say the same. */
  sameAs: (card: string, others?: number) => string;
  sameCount: (others: number) => string;
  /** What the button of a column does: fold it, or open it folded, with how many cards it keeps (S307). */
  foldLane: (name: string) => string;
  openLane: (name: string, cards: number) => string;
  /** An author, in a table cell. */
  who: Record<Actor, string>;
  step: string;
  column: string;
  elements: string;
  noElement: string;
  title: string;
  label: string;
  detail: string;
  by: string;
  links: string;
  from: string;
  to: string;
  openQuestions: string;
  resolvedNotes: string;
  /** Over the kinds of a notation, each named beside its letter. */
  key: string;
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
    formerly: "formerly",
    splits: (card, others = 0) =>
      `splits ${card}${others > 0 ? `, and ${others} ${others > 1 ? "others" : "other"}` : ""}`,
    splitDone: (done, of) => `${done} of ${of} task${of > 1 ? "s" : ""} done`,
    sameAs: (card, others = 0) =>
      `says the same as ${card}${others > 0 ? `, and ${others} ${others > 1 ? "others" : "other"}` : ""}`,
    sameCount: (others) => `${others} other${others > 1 ? "s say" : " says"} the same`,
    foldLane: (name) => `Fold the column ${name}`,
    openLane: (name, cards) => `Open the column ${name}, ${cards} card${cards > 1 ? "s" : ""}`,
    who: { human: "human", agent: "agent", system: "system" },
    step: "Step",
    column: "Column",
    elements: "Cards",
    noElement: "No card.",
    title: "Title",
    label: "Label",
    detail: "Detail",
    by: "By",
    links: "Links",
    from: "From",
    to: "To",
    openQuestions: "Open questions",
    resolvedNotes: "Resolved notes",
    key: "Key",
    on: (target) => `on ${target}`,
    colon: ":",
    source: (board, seq, day) => `Source: Sideco journal, board ${board}, seq ${seq}, exported on ${day}.`,
    board: "Board",
    workshop: "Workshop",
    otherFormats: "Other formats",
    published: (boards, day) => `${boards} board${boards > 1 ? "s" : ""}, published on ${day}.`,
    site: "Sideco boards",
  },
  fr: {
    addedBy: { agent: "ajouté par Claude", human: "ajouté par toi", system: "ajouté par le système" },
    done: "fait",
    formerly: "anciennement",
    splits: (card, others = 0) =>
      `découpe ${card}${others > 0 ? `, et ${others} ${others > 1 ? "autres" : "autre"}` : ""}`,
    splitDone: (done, of) => `${done} tâche${done > 1 ? "s" : ""} faite${done > 1 ? "s" : ""} sur ${of}`,
    sameAs: (card, others = 0) =>
      `dit la même chose que ${card}${others > 0 ? `, et ${others} ${others > 1 ? "autres" : "autre"}` : ""}`,
    sameCount: (others) => `${others} autre${others > 1 ? "s disent" : " dit"} la même chose`,
    foldLane: (name) => `Replier la colonne ${name}`,
    openLane: (name, cards) => `Ouvrir la colonne ${name}, ${cards} carte${cards > 1 ? "s" : ""}`,
    who: { human: "humain", agent: "agent", system: "système" },
    step: "Étape",
    column: "Colonne",
    elements: "Cartes",
    noElement: "Aucune carte.",
    title: "Titre",
    label: "Libellé",
    detail: "Détail",
    by: "Par",
    links: "Liens",
    from: "De",
    to: "Vers",
    openQuestions: "Questions ouvertes",
    resolvedNotes: "Notes résolues",
    key: "Légende",
    on: (target) => `sur ${target}`,
    colon: " :",
    source: (board, seq, day) => `Source : journal Sideco, tableau ${board}, seq ${seq}, exporté le ${day}.`,
    board: "Tableau",
    workshop: "Atelier",
    otherFormats: "Autres formats",
    published: (boards, day) =>
      `${boards} tableau${boards > 1 ? "x" : ""}, publié${boards > 1 ? "s" : ""} le ${day}.`,
    site: "Tableaux Sideco",
  },
};

/** The ids a card went by before it was renumbered, said in the reader's language: "formerly T1". */
export function formerly(ids: readonly string[] | undefined, locale: Locale): string | undefined {
  return ids && ids.length > 0 ? `${WORDS[locale].formerly} ${ids.join(", ")}` : undefined;
}
