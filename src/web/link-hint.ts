/**
 * What to do while a link is drawn from a card (T265): L, or Link in the
 * card's bar, turned the pointer into a cross and said nothing. The board now
 * says what comes next, over its foot, and tells a screen reader once: the
 * keys that end the gesture, and the click (T279). Its words live here, in
 * each language, as messages.ts is at its ceiling. The link made by choosing
 * the other card is said as the handle says its own.
 */
import type { Locale } from "../domain/i18n.ts";
import { h } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { send } from "./store.ts";

const WORDS: Record<Locale, string> = {
  en: "Arrows to the other card, then Space · or click it · Esc cancels",
  fr: "Flèches jusqu'à l'autre carte, puis Espace · ou un clic dessus · Échap annule",
};

/**
 * The hint lies in the board's frame, shown by the board's own `is-linking`:
 * it comes and goes with the mode, whatever began or ended it.
 */
export function mountLinkHint(canvas: HTMLElement, speak: (words: string) => void): void {
  canvas.append(h("p", { class: "linking-hint", "aria-hidden": "true" }, WORDS[locale]));
  let linking = false;
  new MutationObserver(() => {
    const now = canvas.classList.contains("is-linking");
    if (now && !linking) speak(WORDS[locale]);
    linking = now;
  }).observe(canvas, { attributes: true, attributeFilter: ["class"] });
}

/** Links `src` to `dst`, chosen while a link was drawn from `src`, and says so once it is saved. */
export function linkChosen(board: string, src: string, dst: string, say: (words: string) => void): void {
  void send({ kind: "link", board, src, dst }).then((saved) => {
    if (saved !== undefined) say(t.wired(t.linkBetween(src, dst), false));
  });
}
