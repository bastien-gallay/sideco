/**
 * Board to Mermaid, for documents that render it (GitHub, GitLab, most wikis).
 * Mermaid cannot say everything a board says; each export names what it drops in
 * a leading `%% lossy:` comment instead of dropping it silently.
 */
import { type Format, findFormat, laneName, lanesOf, wearsDone } from "../formats.ts";
import { DEFAULT_LOCALE, type Locale } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";

export function toMermaid(board: Board, locale: Locale = DEFAULT_LOCALE): string {
  const format = findFormat(board.format);
  if (!format) return "flowchart TD";
  if (format.layout === "columns") return kanban(board, format, locale);
  if (format.id === "c4-context") return c4Context(board);
  return flowchart(board, format);
}

function flowchart(board: Board, format: Format): string {
  const timeline = format.layout === "timeline";
  const lines: string[] = [];
  if (timeline) lines.push("%% lossy: the order of stickies inside a step is not kept");
  lines.push(timeline ? "flowchart LR" : "flowchart TD");

  if (timeline) {
    const columns = [...new Set(board.elements.map((e) => e.col))].sort((a, b) => a - b);
    for (const col of columns) {
      lines.push(`  subgraph step${col}["${col}"]`, "    direction TB");
      for (const e of board.elements) if (e.col === col) lines.push(`    ${node(e, format)}`);
      lines.push("  end");
    }
  } else {
    for (const e of board.elements) lines.push(`  ${node(e, format)}`);
  }
  for (const edge of board.edges) {
    lines.push(`  ${edge.src} -->${edge.label ? `|"${text(edge.label)}"|` : ""} ${edge.dst}`);
  }
  for (const type of format.types) {
    const ids = board.elements.filter((e) => e.type === type.id).map((e) => e.id);
    if (ids.length === 0) continue;
    lines.push(`  classDef ${type.id} fill:${type.fill},color:${type.ink},stroke:#00000033`);
    lines.push(`  class ${ids.join(",")} ${type.id}`);
  }
  return lines.join("\n");
}

/** The C4 macro for each type of a system context. */
const C4_MACROS: Record<string, string> = { person: "Person", system: "System", external: "System_Ext" };

/** Mermaid's own C4 notation: a card's detail is its description, a link's label what it does. */
function c4Context(board: Board): string {
  const lines = ["C4Context", `  title ${c4(board.title)}`];
  for (const e of board.elements) {
    const macro = C4_MACROS[e.type] ?? "System";
    const description = e.detail ? `, "${c4(e.detail)}"` : "";
    lines.push(`  ${macro}(${e.id}, "${c4(labelSaid(board, e))}"${description})`);
  }
  for (const edge of board.edges) lines.push(`  Rel(${edge.src}, ${edge.dst}, "${c4(edge.label ?? "")}")`);
  return lines.join("\n");
}

/** Inside a C4 string, which takes no escape: a double quote becomes a single one, a line break a space. */
function c4(said: string): string {
  return said.replace(/"/g, "'").replace(/\s*\n\s*/g, " ");
}

function node(e: Element, format: Format): string {
  const label = `"${text(labelSaid({ format: format.id }, e))}"`;
  const shape = format.types.find((t) => t.id === e.type)?.shape;
  if (shape === "diamond") return `${e.id}{${label}}`;
  if (shape === "pill" || shape === "person") return `${e.id}([${label}])`;
  return `${e.id}[${label}]`;
}

function kanban(board: Board, format: Format, locale: Locale): string {
  const lines: string[] = [];
  if (board.edges.length > 0) lines.push("%% lossy: links between cards are not kept");
  lines.push("kanban");
  for (const lane of lanesOf(board)) {
    lines.push(`  ${lane}[${plain(laneName(format, board, lane, locale))}]`);
    for (const e of board.elements)
      if (e.lane === lane) lines.push(`    ${e.id}[${plain(`${e.id} ${labelSaid(board, e)}`)}]`);
  }
  return lines.join("\n");
}

/** A card's label as a text export says it: a card marked done wears the sign, since nothing is struck through there. */
export function labelSaid(board: { format: string }, e: { label: string; done?: boolean }): string {
  return wearsDone(board, e) ? `✓ ${e.label}` : e.label;
}

/** Inside a quoted Mermaid label. */
function text(label: string): string {
  return label.replace(/"/g, "#quot;").replace(/\n/g, " ");
}

/** Inside an unquoted Mermaid label, where brackets end it. */
function plain(label: string): string {
  return label
    .replace(/[[\]{}()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
