/**
 * Boards as text, for the agent: `describeBoard` reads the whole board, compact
 * enough to read on every turn, or a part of it; `describeCard`, one card with
 * what is tied to it. What changed since a given point is `digest.ts`.
 *
 * Lines carry a sign so the meaning survives without colour.
 */
import { CommandError } from "./commands.ts";
import { findFormat, laneHint, laneName, lanesOf, planAxis, wearsDone } from "./formats.ts";
import { threads } from "./threads.ts";
import { type Board, type Element, findElement, type Thread } from "./workspace.ts";

/** A part of a board to read instead of the whole; the fields combine. */
export interface Part {
  /** One lane, with the links and the notes that touch its cards. */
  lane?: string;
  /** One column of a timeline, likewise. */
  col?: number;
  /** The cards without their details. */
  brief?: boolean;
  /** The open notes and nothing else. */
  notes?: boolean;
}

/** The first line of every reading: the board, and the part read when it is not all of it. */
function heading(board: Board, part: string[]): string {
  const snap = board.byHand ? ", Snap" : "";
  const whole = `# ${board.id} — ${board.title} (${board.format}${snap}, seq ${board.changedSeq})`;
  return part.length === 0 ? whole : `${whole} · part: ${part.join(", ")}`;
}

function cardLine(board: Board, e: Element, brief = false): string {
  const detail = e.detail && !brief ? ` — ${under(e.detail)}` : "";
  const labels = e.labels?.length ? ` [${e.labels.join(", ")}]` : "";
  const former = e.formerIds?.length ? ` (formerly ${e.formerIds.join(", ")})` : "";
  // On a Snap diagram, where the card stands: what Claude needs to place one beside it.
  const at = board.byHand && e.at ? ` at ${e.at.x},${e.at.y}` : "";
  return `  ${e.id}${former} ${e.type} ${quote(e.label)}${at}${wearsDone(board, e) ? " ✓ done" : ""}${labels}${detail}`;
}

function linkLine(edge: { src: string; dst: string; label?: string }): string {
  return `  ${edge.src} -> ${edge.dst}${edge.label ? ` ${quote(edge.label)}` : ""}`;
}

function threadLines(thread: Thread, sayClosed = false): string[] {
  const [first, ...replies] = thread.notes;
  if (!first) return [];
  const closed = sayClosed && thread.resolved ? " (resolved)" : "";
  return [
    `  ${first.id} by ${first.by}${first.target ? ` on ${first.target}` : ""}: ${first.text}${closed}`,
    ...replies.map((reply) => `    ${reply.id} by ${reply.by}: ${reply.text}`),
  ];
}

export function describeBoard(board: Board, part: Part = {}): string {
  const format = findFormat(board.format);
  const name = format?.name.en ?? board.format;
  if (part.lane !== undefined) {
    if (format?.layout !== "columns") throw new CommandError(`${name} boards have no columns`);
    const lanes = lanesOf(board);
    if (!lanes.includes(part.lane))
      throw new CommandError(`${name} has no column "${part.lane}" (columns: ${lanes.join(", ")})`);
  }
  if (part.col !== undefined && format?.layout !== "timeline")
    throw new CommandError(`${name} boards have no columns`);

  const said = [
    part.lane !== undefined && `lane ${part.lane}`,
    part.col !== undefined && `col ${part.col}`,
    part.brief && "brief",
    part.notes && "notes",
  ].filter((word): word is string => typeof word === "string");
  const lines = [heading(board, said)];
  if (board.purpose) lines.push(`question: ${quote(board.purpose)}`);
  const narrowed = part.lane !== undefined || part.col !== undefined;
  const elements = board.elements.filter(
    (e) =>
      (part.lane === undefined || e.lane === part.lane) && (part.col === undefined || e.col === part.col),
  );
  const shown = new Set(elements.map((e) => e.id));
  const show = (e: Element): string => cardLine(board, e, part.brief);

  if (part.notes) {
    // The notes alone: the cards are left out.
  } else if (elements.length === 0) lines.push("(empty)");
  else if (format?.layout === "timeline") {
    const columns = [...new Set(elements.map((e) => e.col))].sort((a, b) => a - b);
    for (const col of columns) {
      lines.push(`col ${col}`);
      for (const type of format.types) {
        for (const e of elements) if (e.col === col && e.type === type.id) lines.push(show(e));
      }
    }
  } else if (format?.layout === "columns") {
    for (const id of ["x", "y"] as const) {
      const axis = narrowed ? undefined : planAxis(format, board, id, "en");
      if (axis) lines.push(`axis ${id} ${quote(axis.label)} (${axis.low} → ${axis.high})`);
    }
    for (const id of lanesOf(board)) {
      if (part.lane !== undefined && id !== part.lane) continue;
      const hint = laneHint(format, board, id, "en");
      const laneSaid = laneName(format, board, id, "en");
      lines.push(`lane ${id} (${hint ? `${laneSaid}: ${hint}` : laneSaid})`);
      for (const e of elements) if (e.lane === id) lines.push(show(e));
    }
  } else {
    lines.push("elements");
    for (const e of elements) lines.push(show(e));
  }

  const slices = board.slices ?? [];
  if (slices.length > 0 && !narrowed)
    lines.push(`slices: ${slices.map((slice) => `${slice.id} ${quote(slice.label)}`).join(", ")}`);
  // Of a part, the links and the notes that touch a card shown.
  const edges = part.notes
    ? []
    : board.edges.filter((edge) => !narrowed || shown.has(edge.src) || shown.has(edge.dst));
  if (edges.length > 0) lines.push("links", ...edges.map(linkLine));
  const open = threads(board).filter((thread) => {
    const target = thread.notes[0]?.target;
    return !thread.resolved && (!narrowed || (target !== undefined && shown.has(target)));
  });
  if (open.length > 0) lines.push("open notes", ...open.flatMap((thread) => threadLines(thread)));
  if (board.focus && !part.notes)
    lines.push(`focus: ${board.focus.ids.join(", ")}${board.focus.reason ? ` — ${board.focus.reason}` : ""}`);
  return lines.join("\n");
}

/** One card: its line, where it is, its links, and its threads, closed ones included. */
export function describeCard(board: Board, id: string): string {
  const e = findElement(board, id);
  if (!e) throw new CommandError(`no element ${id} on "${board.id}"`);
  const format = findFormat(board.format);
  const lines = [heading(board, [`card ${id}`]), cardLine(board, e)];
  if (format?.layout === "timeline") lines.push(`  in col ${e.col}`);
  else if (format?.layout === "columns")
    lines.push(`  in lane ${e.lane} (${laneName(format, board, e.lane, "en")})`);
  const edges = board.edges.filter((edge) => edge.src === id || edge.dst === id);
  if (edges.length > 0) lines.push("links", ...edges.map(linkLine));
  const about = threads(board).filter((thread) => thread.notes[0]?.target === id);
  if (about.length > 0) lines.push("notes", ...about.flatMap((thread) => threadLines(thread, true)));
  return lines.join("\n");
}

/** A text of several lines, its later lines set under the line that carries it. */
export function under(text: string): string {
  return text.replace(/\n/g, "\n      ");
}

/** Words between quotes, their own double quotes turned single. */
export function quote(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}
