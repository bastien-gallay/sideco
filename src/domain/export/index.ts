/** Every way a board leaves the companion, by name. */
import { layoutBoard } from "../layout/index.ts";
import { sceneToSvg } from "../render/svg.ts";
import type { Board } from "../workspace.ts";
import { toHtml } from "./html.ts";
import { type ExportMeta, toMarkdown } from "./markdown.ts";
import { toMermaid } from "./mermaid.ts";
import { toModel } from "./model.ts";

export const EXPORT_FORMATS = ["md", "html", "svg", "mermaid", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXTENSION: Record<ExportFormat, string> = {
  md: "md",
  html: "html",
  svg: "svg",
  mermaid: "mmd",
  json: "model.json",
};

export function exportBoard(board: Board, format: ExportFormat, meta: ExportMeta): string {
  switch (format) {
    case "md":
      return toMarkdown(board, meta);
    case "html":
      return toHtml(board, meta);
    case "svg":
      return `${sceneToSvg(layoutBoard(board), board.title)}\n`;
    case "mermaid":
      return `${toMermaid(board)}\n`;
    case "json":
      return `${JSON.stringify(toModel(board), null, 2)}\n`;
  }
}

export type { ExportMeta } from "./markdown.ts";
