/**
 * The keys of the whole page (out of main.ts, T171): wherever the keyboard is,
 * except in a text being typed. main.ts says what each one does; this module
 * says which key asks for it.
 */

export interface PageKeys {
  /** `/` or Ctrl+K: the search. False where there is no board to search: the key is then the browser's. */
  find(): boolean;
  /** `?`: the sheet of the keys and gestures. */
  keys(): void;
  /** `F`: the card chosen is pointed at, or no longer (S334). False with no card chosen: the key is the browser's. */
  focus(): boolean;
  /** `<` and `>`, or `[` and `]`: a side panel folds, or comes back. */
  fold(side: "left" | "right"): void;
  undo(): void;
  redo(): void;
  /** Ctrl+Enter: the turn goes to Claude, with the word in the field. False while it cannot be sent. */
  send(): boolean;
}

/** A text being typed has its own keys, and a question asked in a dialog comes first. */
function typing(target: EventTarget | null): boolean {
  if (document.querySelector("dialog[open]")) return true;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/** What a key alone asks for; undefined for a key the page does not take. */
function plain(key: string, on: PageKeys): (() => unknown) | undefined {
  if (key === "/") return on.find;
  if (key === "?") return on.keys;
  if (key === "f" || key === "F") return on.focus;
  // < and > a key away on a French keyboard, [ and ] on an American one (T201).
  if (key === "<" || key === "[") return () => on.fold("left");
  if (key === ">" || key === "]") return () => on.fold("right");
  return undefined;
}

/** What a key asks for with Ctrl or ⌘ held. */
function chord(key: string, shift: boolean, on: PageKeys): (() => unknown) | undefined {
  if (key === "z") return shift ? on.redo : on.undo;
  if (shift) return undefined;
  if (key === "k") return on.find;
  if (key === "y") return on.redo;
  // Sending is one chord from anywhere but a text being typed: the word in the field goes with it.
  if (key === "enter") return on.send;
  return undefined;
}

/** Listens to the keys of the page. A key whose action answers false was not taken: the browser keeps it. */
export function mountPageKeys(on: PageKeys): void {
  window.addEventListener("keydown", (event) => {
    if (event.altKey || typing(event.target)) return;
    const held = event.ctrlKey || event.metaKey;
    const act = held ? chord(event.key.toLowerCase(), event.shiftKey, on) : plain(event.key, on);
    // A key held down points once: each repeat would put the card in and out again.
    // Nor does it open the sheet of keys again, which the same key closes.
    if (event.repeat && (act === on.focus || act === on.keys)) return void event.preventDefault();
    if (act && act() !== false) event.preventDefault();
  });
}
