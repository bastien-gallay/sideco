/**
 * The bar that says what Claude points at (out of main.ts, T171): the cards in
 * focus and why, over the board, with what lifts the focus.
 */
import type { Board } from "../domain/workspace.ts";
import { h, region } from "./dom.ts";
import { t } from "./locale.ts";
import { send } from "./store.ts";

export const focusBar = h("div", { class: "focus-bar", hidden: true });

const paintFocus = region(
  focusBar,
  (m: { ids: string[]; reason?: string; live: boolean; board?: string }) => [
    h("span", {}, h("strong", {}, t.focus(m.ids.join(", "))), m.reason ? ` — ${m.reason}` : ""),
    m.live && m.board
      ? h(
          "button",
          {
            type: "button",
            class: "quiet",
            onclick: () => void send({ kind: "focus", board: m.board ?? "", ids: [] }),
          },
          t.clearFocus,
        )
      : null,
  ],
);

/** Shows the bar while the board has a focus, and what it says. */
export function paintFocusBar(board: Board | undefined, live: boolean): void {
  focusBar.hidden = !board?.focus;
  if (board?.focus) paintFocus({ ids: board.focus.ids, reason: board.focus.reason, live, board: board.id });
}
