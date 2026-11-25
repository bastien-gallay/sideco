/**
 * What takes the boards out of the workspace from the terminal: one board in a
 * format, or all of them as a static site.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toIndexHtml } from "../domain/export/html.ts";
import { EXPORT_FORMATS, EXTENSION, exportBoard } from "../domain/export/index.ts";
import { type Locale, WORDS } from "../domain/i18n.ts";
import type { Workspace } from "../domain/workspace.ts";
import { dataDir } from "../server/start.ts";
import { type Args, UsageError } from "./args.ts";
import { chooseBoard } from "./choose.ts";
import { findServer } from "./client.ts";

/** Writes one board in the format asked for, to a file or to the terminal. */
export function exportOne(ws: Workspace, args: Args, locale: Locale): number {
  const board = chooseBoard(ws, args.positional[0] ?? args.flags.get("board"));
  const format = EXPORT_FORMATS.find((f) => f === (args.flags.get("format") ?? "md"));
  if (!format) throw new UsageError(`--format is one of: ${EXPORT_FORMATS.join(", ")}`);
  const text = exportBoard(board, format, {
    exportedAt: new Date().toISOString(),
    locale,
    colours: ws.colours,
  });
  const out = args.flags.get("out");
  if (out) {
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  } else {
    process.stdout.write(text);
  }
  return 0;
}

/** Writes every board as a static site, and says where. */
export async function publish(root: string, ws: Workspace, args: Args, locale: Locale): Promise<number> {
  const out = resolve(args.flags.get("out") ?? join(dataDir(root), "site"));
  const meta = { exportedAt: new Date().toISOString(), locale, colours: ws.colours };
  mkdirSync(out, { recursive: true });
  for (const board of ws.boards) {
    for (const format of EXPORT_FORMATS) {
      if (format !== "mermaid")
        writeFileSync(join(out, `${board.id}.${EXTENSION[format]}`), exportBoard(board, format, meta));
    }
  }
  const entries = ws.boards.map((b) => ({
    id: b.id,
    title: b.title,
    format: b.format,
    elements: b.elements.length,
  }));
  writeFileSync(join(out, "index.html"), toIndexHtml(WORDS[locale].site, entries, meta));
  // Publishing only writes files; a companion out of reach just leaves the address unsaid.
  const server =
    out === join(dataDir(root), "site") ? await findServer(root).catch(() => undefined) : undefined;
  console.log(
    `published ${ws.boards.length} board${ws.boards.length === 1 ? "" : "s"} to ${out}${server ? `\nserved at ${server.url}/pub/` : ""}`,
  );
  return 0;
}
