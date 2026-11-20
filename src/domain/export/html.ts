/**
 * Board to one self-contained HTML file: the drawing as inline SVG, the facts as
 * tables, no script and no network. This is what `sideco publish` serves.
 */
import { boardPurpose, findFormat, laneName } from "../formats.ts";
import { DEFAULT_LOCALE, WORDS } from "../i18n.ts";
import { layoutBoard } from "../layout/index.ts";
import { esc, sceneToSvg } from "../render/svg.ts";
import { type Board, threads } from "../workspace.ts";
import type { ExportMeta } from "./markdown.ts";
import { labelSaid } from "./mermaid.ts";

export const PAGE_STYLE = `
:root { --sideco-bg: #FFFFFF; --sideco-ink: #1F2328; --sideco-muted: #59636E; --sideco-faint: #8C959F; --sideco-rule: #E3E6EA; --sideco-lane: #F3F4F6; --sideco-conn: #6E7781; }
@media (prefers-color-scheme: dark) {
  :root { --sideco-bg: #15181C; --sideco-ink: #E6EAEF; --sideco-muted: #A3ADB8; --sideco-faint: #7A8490; --sideco-rule: #2B3138; --sideco-lane: #1D2126; --sideco-conn: #8C959F; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 16px 64px; background: var(--sideco-bg); color: var(--sideco-ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; }
.meta { color: var(--sideco-muted); margin: 0 0 20px; }
.drawing { overflow-x: auto; border: 1px solid var(--sideco-rule); border-radius: 10px; padding: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--sideco-rule); vertical-align: top; }
th { color: var(--sideco-muted); font-weight: 600; }
td.id { font-weight: 700; white-space: nowrap; }
.swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; border: 1px solid rgba(0,0,0,.2); margin-right: 6px; vertical-align: -1px; }
ul { padding-left: 20px; }
a { color: #1A6FAE; }
footer { margin-top: 40px; color: var(--sideco-faint); font-size: 13px; }
`;

export function toHtml(board: Board, meta: ExportMeta): string {
  const format = findFormat(board.format);
  const layout = format?.layout;
  const type = (id: string) => format?.types.find((t) => t.id === id);
  const locale = meta.locale ?? DEFAULT_LOCALE;
  const w = WORDS[locale];
  const lane = (id: string): string => laneName(format, board, id, locale);
  const where = layout === "timeline" ? w.step : layout === "columns" ? w.column : undefined;

  const rows = [...board.elements]
    .sort((a, b) => a.col - b.col)
    .map((e) => {
      const t = type(e.type);
      const place =
        layout === "timeline"
          ? `<td>${e.col}</td>`
          : layout === "columns"
            ? `<td>${esc(lane(e.lane))}</td>`
            : "";
      return `<tr><td class="id">${esc(e.id)}</td><td><span class="swatch" style="background:${esc(t?.fill ?? "#E8EEF4")}"></span>${esc(t?.label[locale] ?? e.type)}</td><td>${esc(labelSaid(board, e))}</td>${place}<td>${esc(e.detail ?? "")}</td><td>${w.who[e.by]}</td></tr>`;
    })
    .join("\n");

  const links = board.edges
    .map(
      (edge) =>
        `<tr><td class="id">${esc(edge.src)}</td><td class="id">${esc(edge.dst)}</td><td>${esc(edge.label ?? "")}</td></tr>`,
    )
    .join("\n");

  const notes = threads(board)
    .filter((thread) => !thread.resolved)
    .map((thread) => {
      const [first, ...replies] = thread.notes.map((n, index) => {
        const on = index === 0 && n.target ? ` (${esc(w.on(n.target))})` : "";
        return `<strong>${esc(n.id)}</strong>${on}, ${w.who[n.by]}${w.colon} ${esc(n.text)}`;
      });
      const answers = replies.map((reply) => `<li>${reply}</li>`).join("");
      return `<li>❓ ${first}${answers ? `<ul>${answers}</ul>` : ""}</li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(board.title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<h1>${esc(board.title)}</h1>
<p class="meta">${format ? `<strong>${esc(format.name[locale])}</strong> — ${esc(boardPurpose(format, board, locale))}` : esc(board.format)}</p>
<div class="drawing">
${sceneToSvg(layoutBoard(board, locale), board.title)}
</div>
<h2>${w.elements}</h2>
${
  board.elements.length === 0
    ? `<p>${w.noElement}</p>`
    : `<table><thead><tr><th>Id</th><th>Type</th><th>${w.label}</th>${where ? `<th>${where}</th>` : ""}<th>${w.detail}</th><th>${w.by}</th></tr></thead><tbody>\n${rows}\n</tbody></table>`
}
${links ? `<h2>${w.links}</h2>\n<table><thead><tr><th>${w.from}</th><th>${w.to}</th><th>${w.label}</th></tr></thead><tbody>\n${links}\n</tbody></table>` : ""}
${notes ? `<h2>${w.openQuestions}</h2>\n<ul>\n${notes}\n</ul>` : ""}
<footer>${w.source(`<code>${esc(board.id)}</code>`, board.changedSeq, esc(meta.exportedAt.slice(0, 10)))}</footer>
</main>
</body>
</html>
`;
}

export interface IndexEntry {
  id: string;
  title: string;
  format: string;
  elements: number;
}

export function toIndexHtml(title: string, boards: IndexEntry[], meta: ExportMeta): string {
  const locale = meta.locale ?? DEFAULT_LOCALE;
  const w = WORDS[locale];
  const items = boards
    .map((b) => {
      const name = findFormat(b.format)?.name[locale] ?? b.format;
      return `<tr><td><a href="${esc(b.id)}.html">${esc(b.title)}</a></td><td>${esc(name)}</td><td>${b.elements}</td><td><a href="${esc(b.id)}.md">Markdown</a> · <a href="${esc(b.id)}.svg">SVG</a> · <a href="${esc(b.id)}.model.json">JSON</a></td></tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="meta">${w.published(boards.length, esc(meta.exportedAt.slice(0, 10)))}</p>
<table><thead><tr><th>${w.board}</th><th>${w.workshop}</th><th>${w.elements}</th><th>${w.otherFormats}</th></tr></thead><tbody>
${items}
</tbody></table>
</main>
</body>
</html>
`;
}
