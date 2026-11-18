/**
 * Board to a design note in Markdown: the diagram, then the facts as tables, then
 * what is still open. Written to be committed next to the code it describes.
 */

import { findFormat } from "../formats.ts";
import { DEFAULT_LOCALE, type Locale, WORDS } from "../i18n.ts";
import type { Board } from "../workspace.ts";
import { toMermaid } from "./mermaid.ts";

export interface ExportMeta {
  /** ISO date-time of the export. */
  exportedAt: string;
  /** The language of the document; English when absent. */
  locale?: Locale;
}

export function toMarkdown(board: Board, meta: ExportMeta): string {
  const format = findFormat(board.format);
  const layout = format?.layout;
  const locale = meta.locale ?? DEFAULT_LOCALE;
  const w = WORDS[locale];
  const typeLabel = (id: string): string => format?.types.find((t) => t.id === id)?.label[locale] ?? id;
  const laneLabel = (id: string): string => format?.lanes.find((l) => l.id === id)?.label[locale] ?? id;
  const out: string[] = [`# ${board.title}`, ""];

  if (format) out.push(`> **${format.name[locale]}** — ${format.purpose[locale]}`, "");
  out.push("```mermaid", toMermaid(board, locale), "```", "");
  out.push(w.source(`\`${board.id}\``, board.changedSeq, meta.exportedAt.slice(0, 10)), "");

  out.push(`## ${w.elements}`, "");
  if (board.elements.length === 0) out.push(w.noElement, "");
  else {
    const where = layout === "timeline" ? w.step : layout === "columns" ? w.column : undefined;
    out.push(row(["Id", "Type", w.label, ...(where ? [where] : []), w.detail, w.by]));
    out.push(row(["---", "---", "---", ...(where ? ["---"] : []), "---", "---"]));
    const sorted = [...board.elements].sort((a, b) => a.col - b.col);
    for (const e of sorted) {
      const place = layout === "timeline" ? [String(e.col)] : layout === "columns" ? [laneLabel(e.lane)] : [];
      out.push(row([e.id, typeLabel(e.type), e.label, ...place, e.detail ?? "", w.who[e.by]]));
    }
    out.push("");
  }

  if (board.edges.length > 0) {
    out.push(`## ${w.links}`, "", row([w.from, w.to, w.label]), row(["---", "---", "---"]));
    for (const edge of board.edges) out.push(row([edge.src, edge.dst, edge.label ?? ""]));
    out.push("");
  }

  const open = board.notes.filter((n) => !n.resolved);
  const settled = board.notes.filter((n) => n.resolved);
  if (open.length > 0) {
    out.push(`## ${w.openQuestions}`, "");
    for (const n of open)
      out.push(
        `- ❓ ${n.id}${n.target ? ` (${w.on(n.target)})` : ""}, ${w.who[n.by]}${w.colon} ${inline(n.text)}`,
      );
    out.push("");
  }
  if (settled.length > 0) {
    out.push(`## ${w.resolvedNotes}`, "");
    for (const n of settled)
      out.push(
        `- ✅ ${n.id}${n.target ? ` (${w.on(n.target)})` : ""}, ${w.who[n.by]}${w.colon} ${inline(n.text)}`,
      );
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function row(cells: string[]): string {
  return `| ${cells.map((c) => inline(c).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function inline(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}
