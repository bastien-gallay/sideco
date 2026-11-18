/**
 * The language of this page, fixed for its lifetime: choosing another one
 * reloads, since everything on screen is rebuilt from the journal anyway.
 */
import type { Locale } from "../domain/i18n.ts";
import { MESSAGES, type Messages, pickLocale } from "./messages.ts";

const KEY = "vico.lang";

/** The reader's own choice in this browser; absent in a private window or with storage blocked. */
function chosen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The companion serves the page in its default language, as the document's `lang`. */
export const locale: Locale = pickLocale(chosen(), document.documentElement.lang);
document.documentElement.lang = locale;

/** The page's words. */
export const t: Messages = MESSAGES[locale];

export function chooseLocale(next: Locale): void {
  if (next === locale) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Nowhere to remember it: the page stays in its current language.
    return;
  }
  location.reload();
}
