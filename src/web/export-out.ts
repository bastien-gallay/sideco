/**
 * A board taken out of the page (out of main.ts, T171): downloaded as a file
 * in one of the export formats, or copied as a Mermaid diagram. main.ts says
 * which board and tells the reader what happened.
 */
import { EXTENSION, type ExportFormat, exportBoard } from "../domain/export/index.ts";
import { toMermaid } from "../domain/export/mermaid.ts";
import type { Board } from "../domain/workspace.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";

const MIME: Record<ExportFormat, string> = {
  md: "text/markdown",
  html: "text/html",
  svg: "image/svg+xml",
  mermaid: "text/plain",
  json: "application/json",
};

/** Downloads the board as a file named after it. */
export function downloadBoard(board: Board, format: ExportFormat): void {
  const text = exportBoard(board, format, { exportedAt: new Date().toISOString(), locale });
  const url = URL.createObjectURL(new Blob([text], { type: MIME[format] }));
  const link = h("a", { href: url, download: `${board.id}.${EXTENSION[format]}` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies the board as a Mermaid diagram; false when the browser refused the clipboard. */
export async function copiedMermaid(board: Board): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(toMermaid(board, locale));
    return true;
  } catch {
    return false;
  }
}
