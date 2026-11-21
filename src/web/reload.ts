/**
 * The companion came back serving another page than this one: Sideco was
 * updated. The tab reloads to become that page as soon as no words would be
 * lost. Until then, or when a reload already failed to bring it, it says so
 * once, and reloading is the reader's to choose.
 */
import { t } from "./locale.ts";
import type { Offer } from "./notices.ts";

const RELOADED_FOR = "sideco.reloadedFor";

/**
 * True while a reload would lose words: a reply kept as a draft, a field with
 * text in it, a question being asked.
 */
function holdsWords(hasDraft: () => boolean): boolean {
  if (document.querySelector("dialog[open]")) return true;
  if (hasDraft()) return true;
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[type="text"], textarea',
  );
  return [...fields].some((field) => field.value !== "" && field.checkVisibility());
}

/**
 * Notes, across the reload, that this tab reloads by itself for `served`. False when
 * it already did, or cannot keep the note: one reload per build served, never a loop.
 */
function firstReloadFor(served: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === served) return false;
    sessionStorage.setItem(RELOADED_FOR, served);
    return true;
  } catch {
    return false;
  }
}

/** The page is the one served: the next update gets a reload of its own. */
function forgetReload(): void {
  try {
    sessionStorage.removeItem(RELOADED_FOR);
  } catch {
    // Nothing could be kept, so nothing is left behind.
  }
}

/** Returns what meets each build the companion serves; `null` is none known yet. */
export function meetUpdates(
  say: (text: string, offer: Offer) => void,
  hasDraft: () => boolean,
): (served: string | null) => void {
  /** The build this page is, as the companion signed it into the document. */
  const build = document.querySelector<HTMLMetaElement>('meta[name="sideco-build"]')?.content;
  /** The served build this page has offered to reload for: it says so once. */
  let offered: string | null = null;
  return (served) => {
    if (served === null) return;
    if (served === build) forgetReload();
    else if (!holdsWords(hasDraft) && firstReloadFor(served)) location.reload();
    else if (offered !== served) {
      offered = served;
      say(t.updated, { label: t.reload, run: () => location.reload() });
    }
  };
}
