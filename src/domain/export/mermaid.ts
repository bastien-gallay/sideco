/**
 * Board to Mermaid, for documents that render it (GitHub, GitLab, most wikis).
 * Mermaid cannot say everything a board says; each export names what it drops in
 * a leading `%% lossy:` comment instead of dropping it silently.
 */
import { type Format, findFormat } from "../formats.ts";
import { DEFAULT_LOCALE, type Locale } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";

export function toMermaid(board: Board, locale: Locale = DEFAULT_LOCALE): string {
  const format = findFormat(board.format);
  if (!format) return "flowchart TD";
  if (format.layout === "columns") return kanban(board, format, locale);
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

function node(e: Element, format: Format): string {
  const label = `"${text(e.label)}"`;
  const shape = format.types.find((t) => t.id === e.type)?.shape;
  if (shape === "diamond") return `${e.id}{${label}}`;
  if (shape === "pill") return `${e.id}([${label}])`;
  return `${e.id}[${label}]`;
}

function kanban(board: Board, format: Format, locale: Locale): string {
  const lines: string[] = [];
  if (board.edges.length > 0) lines.push("%% lossy: links between cards are not kept");
  lines.push("kanban");
  for (const lane of format.lanes) {
    lines.push(`  ${lane.id}[${plain(lane.label[locale])}]`);
    for (const e of board.elements)
      if (e.lane === lane.id) lines.push(`    ${e.id}[${plain(`${e.id} ${e.label}`)}]`);
  }
  return lines.join("\n");
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
