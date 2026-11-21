/**
 * The field a word for Claude is typed in: one line at rest, room for several
 * once it has the keyboard. Enter sends the form, Shift+Enter breaks the line.
 */
import { h } from "./dom.ts";

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
