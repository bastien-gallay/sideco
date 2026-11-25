/**
 * The board's menu, ⋯ at the top (out of main.ts, tidy-first for T289): a new
 * board, the board's title and question (T289, T290), the exports, and
 * removing the board. It closes as a menu does: on a
 * click elsewhere, or on Escape, which gives its button the keyboard back.
 */
import { EXPORT_FORMATS, type ExportFormat } from "../domain/export/index.ts";
import { boardSheetWords, openBoardSheet } from "./board-sheet.ts";
import { askToRemove, openNewBoard } from "./boards.ts";
import { h, region } from "./dom.ts";
import { copiedMermaid, downloadBoard } from "./export-out.ts";
import { t } from "./locale.ts";
import { currentBoard } from "./store.ts";

export interface BoardMenuModel {
  board: { id: string; title: string } | undefined;
  live: boolean;
}

/** What the menu tells the page: words to say, and a board removed, which Undo may take back. */
export interface BoardMenuActs {
  say(text: string): void;
  removed(title: string): void;
}

export const boardMenu = h("details", { class: "menu board-menu" });

document.addEventListener("click", (event) => {
  if (boardMenu.open && !boardMenu.contains(event.target as Node)) boardMenu.open = false;
});
boardMenu.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !boardMenu.open) return;
  event.stopPropagation();
  boardMenu.open = false;
  boardMenu.querySelector("summary")?.focus();
});

/** Closes the menu, then does what was picked in it. */
function picked(act: () => unknown): () => void {
  return () => {
    boardMenu.open = false;
    act();
  };
}

export function mountBoardMenu(acts: BoardMenuActs): (m: BoardMenuModel) => void {
  const exportAs = (format: ExportFormat): void => {
    const board = currentBoard();
    if (board) downloadBoard(board, format);
  };
  const copyMermaid = async (): Promise<void> => {
    const board = currentBoard();
    if (board) acts.say((await copiedMermaid(board)) ? t.mermaidCopied : t.clipboardRefused);
  };
  return region(boardMenu, (m: BoardMenuModel) => [
    h("summary", { title: t.boardMenu, "aria-label": t.boardMenu }, "⋯"),
    h(
      "div",
      { class: "menu-items" },
      h("button", { type: "button", onclick: picked(() => openNewBoard()) }, t.newBoardItem),
      m.board &&
        h(
          "button",
          {
            type: "button",
            disabled: !m.live,
            onclick: picked(() => m.board && openBoardSheet("title", m.board.id)),
          },
          boardSheetWords.item,
        ),
      h("p", { class: "menu-heading" }, t.export),
      ...EXPORT_FORMATS.map((format) =>
        h(
          "button",
          { type: "button", disabled: !m.board, onclick: picked(() => exportAs(format)) },
          t.exportAs[format],
        ),
      ),
      h("button", { type: "button", disabled: !m.board, onclick: picked(copyMermaid) }, t.copyMermaid),
      h("p", { class: "menu-note" }, t.publishAll),
      m.board &&
        h(
          "button",
          {
            type: "button",
            class: "remove-board",
            title: t.removeBoard(m.board.title),
            disabled: !m.live,
            onclick: picked(() => m.board && askToRemove(m.board.id, acts.removed)),
          },
          t.removeBoardItem,
        ),
    ),
  ]);
}
