/**
 * The two lists of the page reached by a key (T275, T273): B for the board
 * shown, at the head of the page; S for the session of Claude the page tells
 * about and hands over to, at its foot. The list takes the keyboard and its
 * arrows open it: what is picked there is the choice. Then the keyboard goes
 * back to the board, as it does when Escape leaves the list.
 */

type Listed = "board" | "session";

/** The list named `name`, where the page shows it: one session alone has no list to choose in. */
function picker(name: Listed): HTMLSelectElement | undefined {
  const list = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  return list && list.getClientRects().length > 0 ? list : undefined;
}

/** The card the keyboard was on, where it is still drawn; else the card of the board Tab stops at. */
function toBoard(from: Element | null): void {
  const card = from instanceof SVGGElement && from.isConnected ? from : null;
  (card ?? document.querySelector<SVGGElement>('g.card[tabindex="0"]'))?.focus();
}

/**
 * Shut, a list takes an arrow or a letter as a choice made on some systems: the board would change at each key.
 * The keys open it; what is picked there is the choice. Escape leaves it for the board, and nothing else of the
 * page hears it.
 */
function onKey(list: HTMLSelectElement, event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    toBoard(from);
    return;
  }
  if (!event.key.startsWith("Arrow") && event.key.length !== 1) return;
  if (event.key === " " || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  list.showPicker?.();
}

/**
 * Gives the board the keyboard once the page has drawn what was chosen, a frame at a time. Another board takes a
 * few frames to show its cards, and the cards of the board left are still there meanwhile: the keyboard is given
 * again until a card has held it for `STEADY` frames. It stops at once if the reader took it elsewhere.
 */
const STEADY = 4;
function settle(back: Element | null, frames: number, steady = 0): void {
  if (frames === 0 || steady === STEADY) return;
  requestAnimationFrame(() => {
    const at = document.activeElement;
    const nowhere = at === null || at === document.body || !at.isConnected || at instanceof HTMLSelectElement;
    if (!nowhere && !at.closest("g.card")) return;
    if (nowhere) toBoard(back);
    settle(back, frames - 1, nowhere ? 0 : steady + 1);
  });
}

/** What held the keyboard when the key asked for a list. */
let from: Element | null = null;
/** The lists that already listen: the page draws a list anew when what it lists changes. */
const heard = new WeakSet<HTMLSelectElement>();

/**
 * Gives the list the keyboard. False where there is none: the key is then the browser's. Once another is
 * chosen the page draws the list anew, and the keyboard would be nowhere: it goes to the board, drawn by then.
 */
export function toPicker(name: Listed): boolean {
  const list = picker(name);
  if (!list) return false;
  from = document.activeElement;
  if (!heard.has(list)) {
    heard.add(list);
    list.addEventListener("keydown", (event) => onKey(list, event));
    list.addEventListener("change", () => {
      const back = name === "session" ? from : null;
      settle(back, 60);
    });
  }
  list.focus();
  return true;
}
