/**
 * Board to a design note in Markdown: the diagram, then the facts as tables, then
 * what is still open. Written to be committed next to the code it describes.
 */

import type { Actor } from "../events.ts";
import { findFormat } from "../formats.ts";
import type { Board } from "../workspace.ts";
import { toMermaid } from "./mermaid.ts";

export interface ExportMeta {
  /** ISO date-time of the export. */
  exportedAt: string;
}

const WHO: Record<Actor, string> = { human: "humain", agent: "agent", system: "système" };

export function toMarkdown(board: Board, meta: ExportMeta): string {
  const format = findFormat(board.format);
  const layout = format?.layout;
  const typeLabel = (id: string): string => format?.types.find((t) => t.id === id)?.label ?? id;
  const laneLabel = (id: string): string => format?.lanes.find((l) => l.id === id)?.label ?? id;
  const out: string[] = [`# ${board.title}`, ""];

  if (format) out.push(`> **${format.name}** — ${format.purpose}`, "");
  out.push("```mermaid", toMermaid(board), "```", "");
  out.push(
    `Source : journal Vico, tableau \`${board.id}\`, seq ${board.changedSeq}, exporté le ${meta.exportedAt.slice(0, 10)}.`,
    "",
  );

  out.push("## Éléments", "");
  if (board.elements.length === 0) out.push("Aucun élément.", "");
  else {
    const where = layout === "timeline" ? "Étape" : layout === "columns" ? "Colonne" : undefined;
    out.push(row(["Id", "Type", "Libellé", ...(where ? [where] : []), "Détail", "Par"]));
    out.push(row(["---", "---", "---", ...(where ? ["---"] : []), "---", "---"]));
    const sorted = [...board.elements].sort((a, b) => a.col - b.col);
    for (const e of sorted) {
      const place = layout === "timeline" ? [String(e.col)] : layout === "columns" ? [laneLabel(e.lane)] : [];
      out.push(row([e.id, typeLabel(e.type), e.label, ...place, e.detail ?? "", WHO[e.by]]));
    }
    out.push("");
  }

  if (board.edges.length > 0) {
    out.push("## Liens", "", row(["De", "Vers", "Libellé"]), row(["---", "---", "---"]));
    for (const edge of board.edges) out.push(row([edge.src, edge.dst, edge.label ?? ""]));
    out.push("");
  }

  const open = board.notes.filter((n) => !n.resolved);
  const settled = board.notes.filter((n) => n.resolved);
  if (open.length > 0) {
    out.push("## Questions ouvertes", "");
    for (const n of open)
      out.push(`- ❓ ${n.id}${n.target ? ` (sur ${n.target})` : ""}, ${WHO[n.by]} : ${inline(n.text)}`);
    out.push("");
  }
  if (settled.length > 0) {
    out.push("## Notes résolues", "");
    for (const n of settled)
      out.push(`- ✅ ${n.id}${n.target ? ` (sur ${n.target})` : ""}, ${WHO[n.by]} : ${inline(n.text)}`);
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
