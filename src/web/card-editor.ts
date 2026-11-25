/**
 * The editor of a board (out of board-view.ts, T259): the one field that is
 * put over a card, a name or an empty place to write a few words there. It
 * knows what is being written, saves it when left, holds it until the
 * companion took it, and hands it back when the card it was about is gone.
 * board-view.ts says where it opens and what the words become.
 */
import { h } from "./dom.ts";
import { t } from "./locale.ts";
import { changed, state } from "./store.ts";
import { keptLines, oneLine } from "./view.ts";

/** The editor's least height: room for two lines of words. */
const EDITOR_MIN_H = 72;

interface Editing {
  /** The text the editor opened with, as it would be saved: leaving it as it was saves nothing. */
  initial: string;
  /** Saves the words; true once the companion took them. Nothing to wait for when it returns nothing. */
  commit(value: string): Promise<boolean> | undefined;
  /** The words are on their way: the editor holds them, and nothing closes it meanwhile. */
  saving: boolean;
  /** How the words are kept: on one line for a label, line by line for a detail. */
  tidy(text: string): string;
  /** A text of several lines: read from the left, Shift+Enter breaks its lines. */
  lines: boolean;
  /** The card the keyboard goes back to once the editor closes. */
  from: string | undefined;
  /** Emptied, the words are saved too: a name taken off. */
  blank: boolean;
}

/** How an editor opens: what it is called, and whether its words are several lines read before they are changed. */
interface EditorKind {
  name: string;
  lines: boolean;
  from?: string;
  blank?: boolean;
  /** One word: the editor is one line tall. */
  short?: boolean;
}

/** What the board does for its editor: once it opened, and to give the keyboard back to a card. */
export interface EditorHooks {
  opened(): void;
  back(id: string): void;
}

export interface CardEditor {
  el: HTMLTextAreaElement;
  open(
    box: DOMRect,
    value: string,
    placeholder: string,
    colours: { fill: string; ink: string },
    commit: (value: string) => Promise<boolean> | undefined,
    kind?: EditorKind,
  ): void;
  close(save: boolean, refocus?: boolean): void;
  /** Words are being written. */
  writing(): boolean;
  /** The cards that are gone: the words being written on one of them are handed back, not dropped. */
  dropGone(alive: ReadonlySet<string>): void;
  /** The card written on took another id: the keyboard goes back to it under that one. */
  renumbered(from: string, to: string): void;
}

class Editor implements CardEditor {
  readonly el = h("textarea", {
    class: "card-editor",
    name: "card-editor",
    hidden: true,
    rows: 3,
    "aria-label": t.cardLabel,
  });
  private editing: Editing | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: EditorHooks,
  ) {
    this.el.addEventListener("keydown", (event) => {
      // As everywhere on the page: Enter saves, Shift+Enter breaks the line.
      const saves = event.key === "Enter" && !event.isComposing && !event.shiftKey;
      if (saves) {
        event.preventDefault();
        this.close(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close(false);
      }
      event.stopPropagation();
    });
    // Leaving the editor for elsewhere keeps what was typed, and leaves the keyboard where it went.
    this.el.addEventListener("blur", () => this.close(true, false));
  }

  /**
   * Opens the editor over a card, or under it. A label is a few words replaced
   * at once: they come selected, and Enter saves them. A note is a few lines
   * written at once: Enter saves it and Shift with Enter breaks the line. A
   * card's detail is not written here but in the page's panel.
   */
  open(
    box: DOMRect,
    value: string,
    placeholder: string,
    colours: { fill: string; ink: string },
    commit: (value: string) => Promise<boolean> | undefined,
    kind: EditorKind = { name: t.cardLabel, lines: false },
  ): void {
    const frame = this.host.getBoundingClientRect();
    const tidy = kind.lines ? keptLines : oneLine;
    const width = Math.max(box.width, 152);
    this.el.value = value;
    this.el.placeholder = placeholder;
    this.el.setAttribute("aria-label", kind.name);
    if (kind.lines) this.el.setAttribute("aria-description", t.saveLines);
    else this.el.removeAttribute("aria-description");
    this.el.title = kind.lines ? t.saveLines : "";
    this.el.classList.toggle("is-lines", kind.lines);
    this.el.style.left = `${Math.min(Math.max(0, frame.width - width - 8), box.left - frame.left)}px`;
    this.el.style.top = `${box.top - frame.top}px`;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${kind.short ? box.height : Math.max(box.height, EDITOR_MIN_H)}px`;
    this.el.style.background = colours.fill;
    this.el.style.color = colours.ink;
    this.el.hidden = false;
    this.editing = {
      initial: tidy(value),
      commit,
      tidy,
      lines: kind.lines,
      from: kind.from,
      blank: kind.blank ?? false,
      saving: false,
    };
    this.hooks.opened();
    this.el.focus();
    if (kind.lines) this.el.setSelectionRange(value.length, value.length);
    else this.el.select();
  }

  /** `refocus`: the keyboard goes back to the card the editor was about, rather than to nowhere. */
  close(save: boolean, refocus = true): void {
    const was = this.editing;
    if (!was || was.saving) return;
    const value = was.tidy(this.el.value);
    const pending =
      save && (value !== "" || was.blank) && value !== was.initial ? was.commit(value) : undefined;
    if (pending) {
      this.hold(was, pending, refocus);
      return;
    }
    this.editing = undefined;
    this.el.hidden = true;
    changed();
    if (refocus && was.from) this.hooks.back(was.from);
  }

  /**
   * Keeps the words on screen until the companion has them. Saved, the editor
   * closes; not saved, the words come back to the human, editable, with the
   * reason said by the page.
   */
  private hold(was: Editing, pending: Promise<boolean>, refocus: boolean): void {
    was.saving = true;
    this.el.readOnly = true;
    this.el.setAttribute("aria-busy", "true");
    void pending.then((saved) => {
      was.saving = false;
      this.el.readOnly = false;
      this.el.removeAttribute("aria-busy");
      if (this.editing !== was) return;
      if (saved) {
        this.close(false, refocus);
        return;
      }
      this.el.focus();
    });
  }

  writing(): boolean {
    return this.editing !== undefined;
  }

  dropGone(alive: ReadonlySet<string>): void {
    const editing = this.editing;
    if (!editing?.from || alive.has(editing.from)) return;
    const words = editing.tidy(this.el.value);
    if (words !== "" && words !== editing.initial) state.notice = t.wordsOrphaned(editing.from, words);
    this.editing = undefined;
    this.el.hidden = true;
  }

  renumbered(from: string, to: string): void {
    if (this.editing?.from === from) this.editing.from = to;
  }
}

export function mountEditor(host: HTMLElement, hooks: EditorHooks): CardEditor {
  return new Editor(host, hooks);
}
