/**
 * The detail of a card read by the keyboard alone (T276): E writes it, I reads
 * it. The page shows the card in its panel, and the panel takes the keyboard:
 * the arrows scroll it, Tab goes on to what it offers, and Escape gives the
 * card the keyboard back. Nothing is opened for writing.
 */
import { state } from "./store.ts";

/** Set while the panel is read from a card that was chosen before: Escape then leaves the choice as it was. */
let back: (() => void) | undefined;

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.isComposing || !back) return;
  // Before the board's own Escape, which lets the choice go: reading a detail changes nothing of it.
  event.stopPropagation();
  back();
}

/**
 * Shows the card in its panel by `show`, then gives the panel the keyboard. `toCard` gives it back to the card.
 * While a link is drawn the key does nothing: the card under the keyboard is the one the link may go to.
 */
export function readDetail(id: string, show: (id: string) => void, toCard: (id: string) => void): void {
  if (state.linking !== null) return;
  const wasChosen = state.selected !== null;
  show(id);
  const panel = document.querySelector<HTMLElement>(".card-panel");
  if (!panel || panel.hidden) return;
  // Reached by this key, not by Tab: the tabs above it are how Tab comes to it. Left, it is as it was, so that a
  // click in its words takes the keyboard from nothing.
  panel.tabIndex = -1;
  back = wasChosen ? () => toCard(id) : undefined;
  panel.addEventListener("keydown", onKey);
  panel.addEventListener("focusout", function left(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && panel.contains(event.relatedTarget)) return;
    panel.removeEventListener("focusout", left);
    panel.removeEventListener("keydown", onKey);
    if (document.activeElement !== panel) panel.removeAttribute("tabindex");
    back = undefined;
  });
  panel.focus();
}
