/**
 * What to do while a link is drawn from a card (T265): L, or Link in the
 * card's bar, turned the pointer into a cross and said nothing. The board now
 * says what comes next, over its foot, and tells a screen reader once. Its
 * words live here, in each language, as messages.ts is at its ceiling.
 */
import type { Locale } from "../domain/i18n.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";

const WORDS: Record<Locale, string> = {
  en: "Choose the card to link to · Esc cancels",
  fr: "Choisis la carte d'arrivée · Échap annule",
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
