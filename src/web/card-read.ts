/**
 * The detail of a card read by the keyboard alone (T276): E writes it, I reads
 * it. The page shows the card in its panel, and the panel takes the keyboard:
 * a screen reader reads it from its top, Tab goes on to what it offers, and
 * Escape gives the card the keyboard back. Nothing is opened for writing.
 */

/** Shows the card in its panel by `show`, then gives the panel the keyboard once it is drawn. */
export function readDetail(show: () => void): void {
  show();
  // The panel is drawn at the next frame: it has nothing to hold the keyboard before.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(".card-panel");
      if (!panel || panel.hidden) return;
      // Reached by this key, not by Tab: the tabs above it are how Tab comes to it.
      panel.tabIndex = -1;
      panel.focus();
    }),
  );
}
