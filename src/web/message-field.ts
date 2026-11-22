/**
 * The field a word for Claude is typed in: one line at rest, room for several
 * once it has the keyboard. Enter sends the form, Shift+Enter breaks the line.
 */
import { h, type Props } from "./dom.ts";

export function messageField(placeholder: string, label: string): HTMLTextAreaElement {
  const field = h("textarea", {
    name: "message",
    rows: 1,
    placeholder,
    "aria-label": label,
    maxlength: 1000,
    onkeydown: (event: Event) => {
      const { key, shiftKey, isComposing } = event as KeyboardEvent;
      if (key !== "Enter" || shiftKey || isComposing) return;
      event.preventDefault();
      field.form?.requestSubmit();
    },
  });
  return field;
}

/**
 * A field for a few words that may run over several lines: Enter sends them,
 * Shift+Enter breaks the line, and ⌘↵ or Ctrl+Enter sends them then calls
 * `chord`: the chord that hands over anywhere else hands over from here too.
 */
export function wordsField(
  props: Props,
  words: string,
  oninput: (words: string) => void,
  chord?: () => void,
): HTMLTextAreaElement {
  const field = h("textarea", {
    class: "words",
    rows: 1,
    maxlength: 1000,
    ...props,
    oninput: () => oninput(field.value),
  });
  field.value = words;
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    field.form?.requestSubmit();
    if (event.metaKey || event.ctrlKey) chord?.();
  });
  return field;
}
