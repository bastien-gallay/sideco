/**
 * The two lists at the head of the page reached by a key (T275, T273): B for
 * the board shown, S for the session of Claude the page tells about and hands
 * over to. The list takes the keyboard; its own arrows choose, as in any list.
 */

/** The list named `name`, where the page shows it: one session alone has no list to choose in. */
function picker(name: "board" | "session"): HTMLSelectElement | undefined {
  const list = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  return list && list.getClientRects().length > 0 ? list : undefined;
}

/** Gives the list the keyboard. False where there is none: the key is then the browser's. */
export function toPicker(name: "board" | "session"): boolean {
  const list = picker(name);
  list?.focus();
  return list !== undefined;
}
