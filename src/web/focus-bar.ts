/**
 * The focus of a board in the page: the bar that says what is pointed at and
 * why, over the board, and the gestures of the reader on it. Claude points by
 * `sideco focus`; the reader points too (S334), by F on the card chosen or the
 * button of its Detail tab, and copies the link of what is pointed at. The
 * reader puts the focus aside without lifting it (S335): this page then shows
 * the board whole, Claude keeps its focus, and a word in the bar recalls it.
 */
import type { Locale } from "../domain/i18n.ts";
import { isBoardId, isElementId } from "../domain/ids.ts";
import { boardLink, cardLink } from "../domain/links.ts";
import type { Board } from "../domain/workspace.ts";
import { h, region } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { changed, currentBoard, isLive, send, state } from "./store.ts";

const WORDS: Record<
  Locale,
  {
    copy: string;
    copied: string;
    refused: string;
    aside: string;
    asideTitle: string;
    put: (cards: number) => string;
    show: string;
    into: string;
    out: string;
  }
> = {
  en: {
    copy: "Copy the link",
    copied: "Link copied",
    refused: "The browser did not let the link be copied",
    aside: "Put aside",
    asideTitle: "On this page alone: the focus stays, for Claude and for the others",
    put: (cards) => `Focus put aside: ${cards} card${cards > 1 ? "s" : ""}`,
    show: "Show it",
    into: "Put in the focus",
    out: "Take out of the focus",
  },
  fr: {
    copy: "Copier le lien",
    copied: "Lien copié",
    refused: "Le navigateur n'a pas laissé copier le lien",
    aside: "Mettre de côté",
    asideTitle: "Sur cette page seulement : le focus reste, pour Claude et pour les autres",
    put: (cards) => `Focus mis de côté : ${cards} carte${cards > 1 ? "s" : ""}`,
    show: "Le montrer",
    into: "Mettre au focus",
    out: "Sortir du focus",
  },
};
const w = WORDS[locale];

export const focusBar = h("div", { class: "focus-bar", hidden: true });

/** The focus this reader put aside, as it was then: one set anew is shown again. */
let aside: string | undefined;
const signed = (board: Board): string => `${board.id} ${JSON.stringify(board.focus)}`;
const isAside = (board: Board): boolean => board.focus !== null && aside === signed(board);

/** The board as this reader sees it: without its focus while it is put aside. */
export function focusShown(board: Board | undefined): Board | undefined {
  return board && isAside(board) ? { ...board, focus: null } : board;
}

/** The link of what is pointed at: the card when it is one, else the board, which shows its focus. */
async function copyLink(board: Board, ids: readonly string[], say: (words: string) => void): Promise<void> {
  const [only, more] = ids;
  if (!isBoardId(board.id)) return;
  const one = only !== undefined && more === undefined && isElementId(only) ? only : undefined;
  const link = one ? cardLink(board.id, one) : boardLink(board.id);
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}${link}`);
    say(w.copied);
  } catch {
    say(w.refused);
  }
}

interface BarModel {
  board: string;
  ids: string[];
  reason?: string;
  live: boolean;
  aside: boolean;
}

let speak: (words: string) => void = () => {};

const paintFocus = region(focusBar, (m: BarModel) => {
  const board = currentBoard();
  const button = (words: string, onclick: () => void, title?: string): HTMLElement =>
    h("button", { type: "button", class: "quiet", title, onclick }, words);
  const setAside = (now: boolean): void => {
    aside = now && board ? signed(board) : undefined;
    changed();
  };
  if (m.aside) return [h("span", {}, w.put(m.ids.length)), button(w.show, () => setAside(false))];
  return [
    h("span", {}, h("strong", {}, t.focus(m.ids.join(", "))), m.reason ? ` — ${m.reason}` : ""),
    h(
      "span",
      { class: "focus-acts" },
      board && button(w.copy, () => void copyLink(board, m.ids, speak)),
      button(w.aside, () => setAside(true), w.asideTitle),
      m.live && button(t.clearFocus, () => void send({ kind: "focus", board: m.board, ids: [] })),
    ),
  ];
});

/** Shows the bar while the board has a focus, and what it says; `say` tells a screen reader what a button did. */
export function paintFocusBar(board: Board | undefined, live: boolean, say: (words: string) => void): void {
  speak = say;
  focusBar.hidden = !board?.focus;
  if (!board?.focus) return;
  const { ids, reason } = board.focus;
  paintFocus({ board: board.id, ids, reason, live, aside: isAside(board) });
}

/** Puts the card in the focus, beside what is pointed at already and for the same reason, or takes it out. */
export function toggleFocus(board: Board, id: string): void {
  const ids = board.focus?.ids ?? [];
  const next = ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
  // Pointing shows the focus again: what was put aside is no longer the one there.
  aside = undefined;
  void send({
    kind: "focus",
    board: board.id,
    ids: next,
    reason: next.length > 0 ? board.focus?.reason : undefined,
  });
}

/** F: the card chosen is pointed at, or no longer. False with no card chosen, or on a board that cannot be written. */
export function pointAtChosen(): boolean {
  const board = currentBoard();
  if (!board || !state.selected || !isLive()) return false;
  toggleFocus(board, state.selected);
  return true;
}

/** The button of the Detail tab that does what F does, for who has no keyboard at hand. */
export function focusButton(id: string, inFocus: boolean): HTMLElement {
  const words = t.withKey(inFocus ? w.out : w.into, "F");
  const press = (): void => {
    const board = currentBoard();
    if (board) toggleFocus(board, id);
  };
  return h("button", { type: "button", class: "quiet focus-toggle", onclick: press }, words);
}
