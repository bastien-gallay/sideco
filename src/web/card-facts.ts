/**
 * Who did what to a card, under its name in the Detail tab (S311): who added
 * it, who changed it last and when, and whether it is done. The tooltip says
 * who added it to a pointer; this line says it to everyone, with the last
 * change, without a search in the history. Its words live here, in each
 * language, as messages.ts is at its ceiling.
 */
import type { Actor, Recorded } from "../domain/events.ts";
import { findFormat, findType, wearsDone } from "../domain/formats.ts";
import { DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";
import { kinSaid } from "../domain/kin.ts";
import { type Board, findElement } from "../domain/workspace.ts";

interface Words {
  added: Record<Actor, string>;
  changed: Record<Actor, string>;
  at: (hour: string) => string;
  on: (day: string, hour: string) => string;
  done: string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    added: { agent: "Added by Claude", human: "Added by you", system: "Added by the system" },
    changed: { agent: "changed by Claude", human: "changed by you", system: "changed by the system" },
    at: (hour) => `at ${hour}`,
    on: (day, hour) => `on ${day} at ${hour}`,
    done: "done",
  },
  fr: {
    added: { agent: "Ajoutée par Claude", human: "Ajoutée par toi", system: "Ajoutée par le système" },
    changed: { agent: "changée par Claude", human: "changée par toi", system: "changée par le système" },
    at: (hour) => `à ${hour}`,
    on: (day, hour) => `le ${day} à ${hour}`,
    done: "faite",
  },
};

/** What the card is and, after it, its kin (S323): "Task · splits S3 Pay online", "Story · 1 of 2 tasks done". */
export function kindSaid(board: Board, id: string, locale: Locale = DEFAULT_LOCALE): string | undefined {
  const el = findElement(board, id);
  const format = findFormat(board.format);
  const kind = el && format && findType(format, el.type)?.label[locale];
  return [kind, kinSaid(board, id, locale)].filter(Boolean).join(" · ") || undefined;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** The hour of a change made today, the day too for an older one: as the reader's own clock tells them. */
function when(ts: string, now: Date, w: Words): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return "";
  const hour = `${two(at.getHours())}:${two(at.getMinutes())}`;
  return at.toDateString() === now.toDateString()
    ? w.at(hour)
    : w.on(`${two(at.getDate())}/${two(at.getMonth() + 1)}`, hour);
}

/** One line: who added the card, its last change when there was one since, and that it is done. Empty for no card. */
export function cardFacts(
  board: Board,
  id: string,
  events: readonly Recorded[],
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  const el = findElement(board, id);
  if (!el) return "";
  const w = WORDS[locale];
  // The page opens with its recent events only: a change older than those is not said until the past is read.
  const last = events.find((e) => e.seq === el.changedSeq);
  const added = last?.event === "ElementAdded";
  return [
    w.added[el.by],
    last && !added && `${w.changed[last.actor]} ${when(last.ts, now, w)}`.trim(),
    wearsDone(board, el) && w.done,
  ]
    .filter(Boolean)
    .join(" · ");
}
