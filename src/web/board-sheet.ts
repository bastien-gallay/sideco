/**
 * The sheet that changes what a board is called and the question it asks
 * (T289, T290): what `sideco retitle` and `sideco purpose` do, from the page.
 * It opens from the board's menu, or at the question when the palette's is
 * double-clicked. Its words live here, as messages.ts is at its ceiling.
 */
import { findFormat } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import { findBoard } from "../domain/workspace.ts";
import { changes } from "./board-changes.ts";
import { h } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { isLive, send, state } from "./store.ts";

const WORDS: Record<
  Locale,
  { item: string; tip: string; heading: string; question: string; hint: string; save: string }
> = {
  en: {
    item: "Title and question…",
    tip: "Double-click to change the question",
    heading: "This board",
    question: "Question it asks",
    hint: "Left empty, the board asks its workshop's question again.",
    save: "Save",
  },
  fr: {
    item: "Titre et question…",
    tip: "Double-clic pour changer la question",
    heading: "Ce tableau",
    question: "Question qu'il pose",
    hint: "Laissée vide, le tableau reprend la question de son atelier.",
    save: "Enregistrer",
  },
};

export const boardSheetWords = WORDS[locale];

export const boardSheet = h("dialog", { class: "sheet board-sheet" });

/** Opens the sheet of the board in view, or of board `id`: the cursor in its title or in its question. */
export function openBoardSheet(at: "title" | "purpose", id = state.boardId): void {
  const board = id ? findBoard(state.live, id) : undefined;
  if (!board || !isLive()) return;
  const words = WORDS[locale];
  const title = h("input", {
    type: "text",
    name: "title",
    required: true,
    maxlength: 120,
    value: board.title,
  });
  const purpose = h(
    "textarea",
    {
      name: "purpose",
      class: "board-question",
      rows: 2,
      maxlength: 120,
      placeholder: findFormat(board.format)?.purpose[locale] ?? "",
    },
    board.purpose ?? "",
  );
  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    const commands = changes(board, title.value.trim(), purpose.value.trim());
    if (commands.length > 0 && !(await send(...commands))) return;
    boardSheet.close();
  };
  boardSheet.replaceChildren(
    h(
      "form",
      { onsubmit: (event: Event) => void save(event) },
      h("h2", {}, words.heading),
      h("label", { class: "field" }, t.title, title),
      h("label", { class: "field" }, words.question, purpose),
      h("p", { class: "hint" }, words.hint),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "quiet", onclick: () => boardSheet.close() }, t.cancel),
        h("button", { type: "submit", class: "primary" }, words.save),
      ),
    ),
  );
  // The sheet puts itself in the page the first time it opens: main.ts is at its ceiling.
  if (!boardSheet.isConnected) document.body.append(boardSheet);
  boardSheet.showModal();
  (at === "purpose" ? purpose : title).focus();
}
