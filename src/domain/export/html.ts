/**
 * Board to one self-contained HTML file: the drawing as inline SVG, the facts as
 * tables, no script and no network. This is what `vico publish` serves.
 */
import type { Actor } from "../events.ts";
import { findFormat } from "../formats.ts";
import { layoutBoard } from "../layout/index.ts";
import { esc, sceneToSvg } from "../render/svg.ts";
import type { Board } from "../workspace.ts";
import type { ExportMeta } from "./markdown.ts";

const WHO: Record<Actor, string> = { human: "humain", agent: "agent", system: "système" };

export const PAGE_STYLE = `
:root { --vico-bg: #FFFFFF; --vico-ink: #1F2328; --vico-muted: #59636E; --vico-faint: #8C959F; --vico-rule: #E3E6EA; --vico-lane: #F3F4F6; --vico-conn: #6E7781; }
@media (prefers-color-scheme: dark) {
  :root { --vico-bg: #15181C; --vico-ink: #E6EAEF; --vico-muted: #A3ADB8; --vico-faint: #7A8490; --vico-rule: #2B3138; --vico-lane: #1D2126; --vico-conn: #8C959F; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 16px 64px; background: var(--vico-bg); color: var(--vico-ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; }
.meta { color: var(--vico-muted); margin: 0 0 20px; }
.drawing { overflow-x: auto; border: 1px solid var(--vico-rule); border-radius: 10px; padding: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vico-rule); vertical-align: top; }
th { color: var(--vico-muted); font-weight: 600; }
td.id { font-weight: 700; white-space: nowrap; }
.swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; border: 1px solid rgba(0,0,0,.2); margin-right: 6px; vertical-align: -1px; }
ul { padding-left: 20px; }
a { color: #1A6FAE; }
footer { margin-top: 40px; color: var(--vico-faint); font-size: 13px; }
`;

export function toHtml(board: Board, meta: ExportMeta): string {
  const format = findFormat(board.format);
  const layout = format?.layout;
  const type = (id: string) => format?.types.find((t) => t.id === id);
  const lane = (id: string): string => format?.lanes.find((l) => l.id === id)?.label ?? id;
  const where = layout === "timeline" ? "Étape" : layout === "columns" ? "Colonne" : undefined;

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
      return `<tr><td class="id">${esc(e.id)}</td><td><span class="swatch" style="background:${esc(t?.fill ?? "#E8EEF4")}"></span>${esc(t?.label ?? e.type)}</td><td>${esc(e.label)}</td>${place}<td>${esc(e.detail ?? "")}</td><td>${WHO[e.by]}</td></tr>`;
    })
    .join("\n");

  const links = board.edges
    .map(
      (edge) =>
        `<tr><td class="id">${esc(edge.src)}</td><td class="id">${esc(edge.dst)}</td><td>${esc(edge.label ?? "")}</td></tr>`,
    )
    .join("\n");

  const open = board.notes.filter((n) => !n.resolved);
  const notes = open
    .map(
      (n) =>
        `<li>❓ <strong>${esc(n.id)}</strong>${n.target ? ` (sur ${esc(n.target)})` : ""}, ${WHO[n.by]} : ${esc(n.text)}</li>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(board.title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<h1>${esc(board.title)}</h1>
<p class="meta">${format ? `<strong>${esc(format.name)}</strong> — ${esc(format.purpose)}` : esc(board.format)}</p>
<div class="drawing">
${sceneToSvg(layoutBoard(board), board.title)}
</div>
<h2>Éléments</h2>
${
  board.elements.length === 0
    ? "<p>Aucun élément.</p>"
    : `<table><thead><tr><th>Id</th><th>Type</th><th>Libellé</th>${where ? `<th>${where}</th>` : ""}<th>Détail</th><th>Par</th></tr></thead><tbody>\n${rows}\n</tbody></table>`
}
${links ? `<h2>Liens</h2>\n<table><thead><tr><th>De</th><th>Vers</th><th>Libellé</th></tr></thead><tbody>\n${links}\n</tbody></table>` : ""}
${notes ? `<h2>Questions ouvertes</h2>\n<ul>\n${notes}\n</ul>` : ""}
<footer>Source : journal Vico, tableau <code>${esc(board.id)}</code>, seq ${board.changedSeq}, exporté le ${esc(meta.exportedAt.slice(0, 10))}.</footer>
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
  const items = boards
    .map((b) => {
      const name = findFormat(b.format)?.name ?? b.format;
      return `<tr><td><a href="${esc(b.id)}.html">${esc(b.title)}</a></td><td>${esc(name)}</td><td>${b.elements}</td><td><a href="${esc(b.id)}.md">Markdown</a> · <a href="${esc(b.id)}.svg">SVG</a> · <a href="${esc(b.id)}.model.json">JSON</a></td></tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="meta">${boards.length} tableau${boards.length > 1 ? "x" : ""}, publié${boards.length > 1 ? "s" : ""} le ${esc(meta.exportedAt.slice(0, 10))}.</p>
<table><thead><tr><th>Tableau</th><th>Atelier</th><th>Éléments</th><th>Autres formats</th></tr></thead><tbody>
${items}
</tbody></table>
</main>
</body>
</html>
`;
}
