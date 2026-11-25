/**
 * Board to a design note in Markdown: the diagram, then the facts as tables, then
 * what is still open. Written to be committed next to the code it describes.
 */

import { boardPurpose, findFormat, laneName } from "../formats.ts";
import { DEFAULT_LOCALE, type Locale, WORDS } from "../i18n.ts";
import { threads } from "../threads.ts";
import type { Board, Thread } from "../workspace.ts";
import { labelSaid, toMermaid } from "./mermaid.ts";
import { diagramTitle } from "./notation.ts";

export interface ExportMeta {
  /** ISO date-time of the export. */
  exportedAt: string;
  /** The language of the document; English when absent. */
  locale?: Locale;
  /** Per key of label, the colour chosen for it in the project: the drawing wears it. */
  colours?: Readonly<Record<string, string>>;
}

export function toMarkdown(board: Board, meta: ExportMeta): string {
  const format = findFormat(board.format);
  const layout = format?.layout;
  const locale = meta.locale ?? DEFAULT_LOCALE;
  const w = WORDS[locale];
  const typeLabel = (id: string): string => format?.types.find((t) => t.id === id)?.label[locale] ?? id;
  const laneLabel = (id: string): string => laneName(format, board, id, locale);
  const out: string[] = [`# ${diagramTitle(board, locale)}`, ""];

  if (format) out.push(`> **${format.name[locale]}** — ${boardPurpose(format, board, locale)}`, "");
  out.push("```mermaid", toMermaid(board, locale), "```", "");
  out.push(w.source(`\`${board.id}\``, board.changedSeq, meta.exportedAt.slice(0, 10)), "");

  if (format?.framed) {
    out.push(`## ${w.key}`, "");
    for (const type of format.types)
      out.push(`- **${type.prefix}** ${type.label[locale]}${w.colon} ${type.hint[locale]}`);
    out.push("");
  }

  out.push(`## ${w.elements}`, "");
  if (board.elements.length === 0) out.push(w.noElement, "");
  else {
    const where = layout === "timeline" ? w.step : layout === "columns" ? w.column : undefined;
    out.push(row(["Id", "Type", w.title, ...(where ? [where] : []), w.detail, w.by]));
    out.push(row(["---", "---", "---", ...(where ? ["---"] : []), "---", "---"]));
    const sorted = [...board.elements].sort((a, b) => a.col - b.col);
    for (const e of sorted) {
      const place = layout === "timeline" ? [String(e.col)] : layout === "columns" ? [laneLabel(e.lane)] : [];
      out.push(row([e.id, typeLabel(e.type), labelSaid(board, e), ...place, e.detail ?? "", w.who[e.by]]));
    }
    out.push("");
  }

  if (board.edges.length > 0) {
    out.push(`## ${w.links}`, "", row([w.from, w.to, w.label]), row(["---", "---", "---"]));
    for (const edge of board.edges) out.push(row([edge.src, edge.dst, edge.label ?? ""]));
    out.push("");
  }

  const all = threads(board);
  const discussions = (title: string, mark: string, list: Thread[]): void => {
    if (list.length === 0) return;
    out.push(`## ${title}`, "");
    for (const thread of list) {
      thread.notes.forEach((n, index) => {
        const said = `${w.who[n.by]}${w.colon} ${inline(n.text)}`;
        out.push(
          index === 0
            ? `- ${mark} ${n.id}${n.target ? ` (${w.on(n.target)})` : ""}, ${said}`
            : `  - ${n.id}, ${said}`,
        );
      });
    }
    out.push("");
  };
  discussions(
    w.openQuestions,
    "❓",
    all.filter((thread) => !thread.resolved),
  );
  discussions(
    w.resolvedNotes,
    "✅",
    all.filter((thread) => thread.resolved),
  );
  return `${out.join("\n").trimEnd()}\n`;
}

function row(cells: string[]): string {
  return `| ${cells.map((c) => inline(c).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function inline(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}
