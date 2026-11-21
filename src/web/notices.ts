/**
 * What the page says on its own: briefly, at the bottom, to everyone (the
 * toast), and to a screen reader only (what the eye already sees on the board).
 */
import { h } from "./dom.ts";

/** Something to press beside what is said: it keeps the toast up longer. */
export type Offer = { label: string; run: () => void };

export interface Notices {
  /** The toast, at the bottom of the page. */
  readonly toast: HTMLDivElement;
  /** The live region only a screen reader hears. */
  readonly spoken: HTMLDivElement;
  /** Says one thing, briefly. With an `offer`, it stays longer: there is something to press. */
  say(text: string, offer?: Offer): void;
  /** Tells a screen reader, and only it. The same words twice in a row are said twice. */
  speak(text: string): void;
  /** An offer still shown leaves: what it offered no longer holds. */
  withdrawOffer(): void;
}

const SHOWN_MS = 5000;
const OFFERED_MS = 10000;

/** `onHide` runs when the toast goes away by itself or its offer is taken. */
export function mountNotices(onHide: () => void): Notices {
  const toast = h("div", { class: "toast", role: "alert", hidden: true });
  const spoken = h("div", { class: "spoken", role: "status", "aria-live": "polite" });
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = (): void => {
    toast.hidden = true;
    onHide();
  };

  return {
    toast,
    spoken,
    say(text, offer) {
      toast.replaceChildren(text);
      if (offer) {
        const take = (): void => {
          hide();
          offer.run();
        };
        toast.append(h("button", { type: "button", onclick: take }, offer.label));
      }
      toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(hide, offer ? OFFERED_MS : SHOWN_MS);
    },
    speak(text) {
      // Emptied first, so the same words twice in a row are said twice.
      spoken.textContent = "";
      requestAnimationFrame(() => {
        spoken.textContent = text;
      });
    },
    withdrawOffer() {
      if (toast.querySelector("button")) toast.hidden = true;
    },
  };
}
