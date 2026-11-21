/**
 * What the page says on its own (T89). Briefly, at the bottom, to everyone: the
 * toast. Until it is resolved: an error, in a bar of its own. To a screen
 * reader only: what the eye already sees on the board. And all of it but the
 * last, kept in the Notifications tab, newest first, with what it offered while
 * that still holds. Its words live here, in each language, as messages.ts is
 * at its ceiling.
 */
import type { Locale } from "../domain/i18n.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";

/**
 * Something to press beside what is said: it keeps the toast up longer. It can
 * be pressed, in the toast or the tab, while `holds` says so and until taken.
 */
export type Offer = { label: string; run: () => void; holds?: () => boolean };

export interface Notices {
  /** The error bar and the toast, at the bottom of the page. */
  readonly bottom: HTMLDivElement;
  /** The live region only a screen reader hears. */
  readonly spoken: HTMLDivElement;
  /** The Notifications tab's panel, and the count its tab button carries. */
  readonly panel: HTMLElement;
  readonly count: HTMLSpanElement;
  /** Says one thing, briefly, and keeps it. With an `offer`, it stays longer: there is something to press. */
  say(text: string, offer?: Offer): void;
  /** Tells a screen reader, and only it. The same words twice in a row are said twice. */
  speak(text: string): void;
  /** The error now, or none: shown until resolved or dismissed, kept once each time it comes. */
  showError(text: string | null): void;
  /** Repaints the tab and takes back the offers that no longer hold. */
  paint(): void;
}

interface Said {
  at: Date;
  text: string;
  error: boolean;
  offer?: Offer;
  taken: boolean;
}

const WORDS: Record<Locale, { dismiss: string; none: string }> = {
  en: { dismiss: "Dismiss", none: "Nothing said yet." },
  fr: { dismiss: "Fermer", none: "Rien de dit pour l'instant." },
};

const SHOWN_MS = 5000;
const OFFERED_MS = 10000;
/** ponytail: a page open for days keeps only the latest; the journal keeps the rest. */
const KEPT = 100;

const holds = (said: Said): boolean => !!said.offer && !said.taken && (said.offer.holds?.() ?? true);

/** `onDismiss` runs when the reader closes the error bar. */
export function mountNotices(onDismiss: () => void): Notices {
  const w = WORDS[locale];
  const toast = h("div", { class: "toast", role: "alert", hidden: true });
  const errorBar = h("div", { class: "error-bar", role: "alert", hidden: true });
  const spoken = h("div", { class: "spoken", role: "status", "aria-live": "polite" });
  const list = h("ul", { class: "notices-list" });
  const panel = h(
    "section",
    {
      class: "notices",
      id: "tab-notices-panel",
      role: "tabpanel",
      "aria-labelledby": "tab-notices",
      hidden: true,
    },
    list,
  );
  const count = h("span", { class: "tab-count", hidden: true });
  const kept: Said[] = [];
  let inToast: Said | undefined;
  let unseen = 0;
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const take = (said: Said): void => {
    said.taken = true;
    if (inToast === said) toast.hidden = true;
    said.offer?.run();
    paint();
  };
  const button = (said: Said): HTMLButtonElement | false =>
    holds(said) && h("button", { type: "button", onclick: () => take(said) }, said.offer?.label ?? "");

  const keep = (said: Said): void => {
    kept.unshift(said);
    kept.length = Math.min(kept.length, KEPT);
    unseen++;
  };

  function paint(): void {
    if (inToast && !holds(inToast)) toast.querySelector("button")?.remove();
    if (panel.checkVisibility()) unseen = 0;
    count.hidden = unseen === 0;
    count.textContent = String(unseen);
    count.classList.toggle(
      "is-error",
      kept.slice(0, unseen).some((s) => s.error),
    );
    const clock = (at: Date): string => at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    list.replaceChildren(
      ...(kept.length === 0
        ? [h("li", { class: "notices-none" }, w.none)]
        : kept.map((said) =>
            h(
              "li",
              { class: said.error ? "is-error" : undefined },
              h("time", { datetime: said.at.toISOString() }, clock(said.at)),
              h("span", {}, said.text),
              button(said),
            ),
          )),
    );
  }

  return {
    bottom: h("div", { class: "notices-bottom" }, errorBar, toast),
    spoken,
    panel,
    count,
    paint,
    say(text, offer) {
      const said: Said = { at: new Date(), text, error: false, offer, taken: false };
      keep(said);
      inToast = said;
      toast.replaceChildren(text);
      const offered = button(said);
      if (offered) toast.append(offered);
      toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => (toast.hidden = true), offer ? OFFERED_MS : SHOWN_MS);
      paint();
    },
    speak(text) {
      // Emptied first, so the same words twice in a row are said twice.
      spoken.textContent = "";
      requestAnimationFrame(() => {
        spoken.textContent = text;
      });
    },
    showError(text) {
      if (text === error) return;
      error = text;
      errorBar.hidden = text === null;
      if (text === null) return;
      const dismiss = (): void => {
        errorBar.hidden = true;
        error = null;
        onDismiss();
      };
      errorBar.replaceChildren(text, h("button", { type: "button", onclick: dismiss }, w.dismiss));
      keep({ at: new Date(), text, error: true, taken: false });
      paint();
    },
  };
}
