/**
 * The project as text, for the agent, across its boards: the labels and the
 * cards that wear them, the cards that hold some words, the sessions open.
 */
import { type Found, findInWorkspace } from "./find.ts";
import { normalLabel } from "./labels.ts";
import { isOpen } from "./sessions.ts";
import { findBoard, type Workspace } from "./workspace.ts";

/**
 * Every label of the project with the cards that wear it, across boards, in
 * order. `only` narrows to a label (`@name` read as `assignee:name`), or to a
 * key: `type` is every `type:…`.
 */
export function describeLabels(ws: Workspace, only?: string): string {
  const wanted = only === undefined ? undefined : normalLabel(only).toLowerCase().replace(/:$/, "");
  const fits = (label: string): boolean => {
    if (wanted === undefined) return true;
    const low = label.toLowerCase();
    return low === wanted || low.startsWith(`${wanted}:`);
  };
  const found = new Map<string, { label: string; cards: string[] }>();
  for (const board of ws.boards)
    for (const e of board.elements)
      for (const label of e.labels ?? []) {
        if (!fits(label)) continue;
        const entry = found.get(label.toLowerCase()) ?? { label, cards: [] };
        entry.cards.push(`${board.id} ${e.id}`);
        found.set(label.toLowerCase(), entry);
      }
  if (found.size === 0) return only === undefined ? "no label yet" : `no label ${only}`;
  const listed = [...found.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ label, cards }) => `${label}  ${cards.length}  ${cards.join(" · ")}`);
  // The keys given a colour (S328), last: those left to chance are not said.
  const coloured = Object.entries(ws.colours ?? {})
    .filter(([key]) => fits(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, colour]) => `${key} ${colour}`);
  return [...listed, ...(coloured.length > 0 ? [`colours  ${coloured.join(" · ")}`] : [])].join("\n");
}

/** One line per card found, its board and id first, then where the words were when not in its name. */
function foundLine(hit: Found): string {
  if (hit.kind === "note") return `${hit.board} ${hit.id} note "${hit.label}"`;
  const head = `${hit.board} ${hit.id} ${hit.type} "${hit.label}"`;
  const where = hit.where;
  if (!where) return head;
  if (where.in === "labels") return `${head} [${where.text}]`;
  if (where.in === "detail") return `${head} — detail: ${where.text}`;
  return `${head} — note ${where.note}: ${where.text}`;
}

/**
 * Every card whose id, name, labels, detail or notes hold all the words of `query`, across the boards (or on
 * `only`): one line each, its board and id first, then where the words were when not in its name.
 */
export function describeFind(ws: Workspace, query: string, only?: string): string {
  const found = findInWorkspace(ws, query, only);
  return found.length === 0 ? `nothing matches "${query}"` : found.map(foundLine).join("\n");
}

/** The sessions still open, the latest to act first: who each is, what it does, what it follows. */
export function describeSessions(ws: Workspace, me: string | undefined, now: number): string {
  const open = ws.sessions.filter((s) => isOpen(s, now)).sort((a, b) => b.lastSeq - a.lastSeq);
  if (open.length === 0) return "no session open";
  return open
    .map((s) => {
      const who = s.name ? `${s.name} (${s.id.slice(0, 8)})` : s.id.slice(0, 8);
      const boards = (ws.follows[s.id] ?? []).filter((board) => findBoard(ws, board));
      const follows = boards.length > 0 ? `follows ${boards.join(", ")}` : "follows no board";
      return `${who}  ${s.status}  ${follows}${s.id === me ? "  ← you" : ""}`;
    })
    .join("\n");
}
