/**
 * Finding cards by their words, across the boards: what `sideco find` prints and
 * the page lists as the reader types. Case and accents aside; a word that looks
 * like an id (`T2`) matches that id only, never `T22`.
 */
import type { Workspace } from "./workspace.ts";

/** Where the words were, when not in the card's id or name. */
export type FoundWhere =
  | { in: "labels"; text: string }
  | { in: "detail"; text: string }
  | { in: "note"; note: string; text: string };

/** A card, or a note on the board itself, holding every word asked. */
export interface Found {
  board: string;
  id: string;
  kind: "card" | "note";
  /** The card's type; none for a note. */
  type?: string;
  /** The card's name, or the words around the match for a note. */
  label: string;
  where?: FoundWhere;
}

/** Lower case, without accents: `Écrire` is found by `ecrire`. NFC text keeps its length, so indexes carry over. */
const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A word that looks like an id (`T2`) matches that id only, never `T22`; any other word matches inside words. */
function wordAt(text: string, word: string): number {
  if (!/^[a-z]+\d+$/.test(word)) return text.indexOf(word);
  return text.search(new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`));
}

/** The words around the first of `words` found in `text`: a few before, the rest of a short line after. */
function excerpt(text: string, words: readonly string[]): string {
  const folded = fold(text);
  const at = Math.min(...words.map((w) => wordAt(folded, w)).filter((i) => i >= 0));
  let start = Math.max(0, at - 24);
  const space = start > 0 ? text.indexOf(" ", start - 1) : -1;
  if (space >= 0 && space < at) start = space + 1;
  let end = Math.min(text.length, at + 60);
  if (end < text.length) end = text.lastIndexOf(" ", end) > at ? text.lastIndexOf(" ", end) : end;
  const line = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${line}${end < text.length ? "…" : ""}`;
}

/** The query's words, folded: none when it is blank. */
export const queryWords = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean);

/**
 * Every card whose id, name, labels, detail or notes hold all the words of `query`, across the boards (or on
 * `only`), board by board in their order, with where the words were when not in its name.
 */
export function findInWorkspace(ws: Workspace, query: string, only?: string): Found[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const holds = (texts: readonly string[]): boolean => {
    const all = fold(texts.join("\n"));
    return words.every((w) => wordAt(all, w) >= 0);
  };
  const has = (text: string): boolean => words.some((w) => wordAt(fold(text), w) >= 0);
  const found: Found[] = [];
  for (const board of ws.boards) {
    if (only !== undefined && board.id !== only) continue;
    for (const note of board.notes)
      if (note.target === undefined && holds([note.id, note.text]))
        found.push({ board: board.id, id: note.id, kind: "note", label: excerpt(note.text, words) });
    for (const e of board.elements) {
      const notes = board.notes.filter((n) => n.target === e.id);
      const labels = (e.labels ?? []).join(", ");
      if (!holds([e.id, e.label, labels, e.detail ?? "", ...notes.map((n) => n.text)])) continue;
      const hit: Found = { board: board.id, id: e.id, kind: "card", type: e.type, label: e.label };
      const note = notes.find((n) => has(n.text));
      const where: FoundWhere | undefined = holds([e.id, e.label])
        ? undefined
        : labels && has(labels)
          ? { in: "labels", text: labels }
          : e.detail && has(e.detail)
            ? { in: "detail", text: excerpt(e.detail, words) }
            : note
              ? { in: "note", note: note.id, text: excerpt(note.text, words) }
              : undefined;
      found.push(where ? { ...hit, where } : hit);
    }
  }
  return found;
}

/** A piece of shown text: `found` when it is one of the words asked. */
export interface Marked {
  text: string;
  found?: true;
}

/** The text cut where the words asked appear, case and accents aside; overlapping words make one piece. */
export function markWords(text: string, words: readonly string[]): Marked[] {
  const folded = fold(text);
  const hit = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    const id = /^[a-z]+\d+$/.test(word);
    const pattern = new RegExp(
      id ? `(?<![a-z0-9])${word}(?![a-z0-9])` : word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g",
    );
    for (const m of folded.matchAll(pattern)) hit.fill(true, m.index, m.index + m[0].length);
  }
  const parts: Marked[] = [];
  for (let at = 0; at < text.length; ) {
    let end = at;
    while (end < text.length && hit[end] === hit[at]) end++;
    parts.push(hit[at] ? { text: text.slice(at, end), found: true } : { text: text.slice(at, end) });
    at = end;
  }
  return parts;
}
