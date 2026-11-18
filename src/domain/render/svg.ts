/**
 * Scene to SVG. The same markup is used by the static export and by the live
 * page, so a published diagram looks like the board it came from.
 *
 * Colours of the chrome are CSS variables with fallbacks: standalone files get
 * the light theme, the page overrides the variables.
 */
import { type Band, type Card, type Connector, LINE_H, type Scene } from "../layout/scene.ts";

export const SVG_STYLE = `
.vico-board { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.band-rule { stroke: var(--vico-rule, #E3E6EA); stroke-width: 1; }
.band-label { fill: var(--vico-muted, #59636E); font-size: 12px; font-weight: 600; }
.band-step-label { fill: var(--vico-faint, #8C959F); font-size: 11px; text-anchor: middle; }
.lane-bg { fill: var(--vico-lane, #F3F4F6); }
.lane-label { fill: var(--vico-ink, #1F2328); font-size: 13px; font-weight: 600; }
.lane-count { fill: var(--vico-faint, #8C959F); font-size: 12px; text-anchor: end; }
.conn path { fill: none; stroke: var(--vico-conn, #6E7781); stroke-width: 1.5; }
.conn-label { fill: var(--vico-muted, #59636E); font-size: 11px; paint-order: stroke; stroke: var(--vico-bg, #FFFFFF); stroke-width: 4px; stroke-linejoin: round; }
.vico-arrow { fill: var(--vico-conn, #6E7781); }
.card-shape { stroke: rgba(0, 0, 0, 0.2); stroke-width: 1; }
.card-id { font-size: 10px; font-weight: 700; opacity: 0.7; }
.card-label { font-size: 13px; text-anchor: middle; }
.card-detail { font-size: 11px; opacity: 0.7; text-anchor: end; }
.card-notes circle { fill: #1A6FAE; stroke: var(--vico-bg, #FFFFFF); stroke-width: 2; }
.card-notes text { fill: #FFFFFF; font-size: 10px; font-weight: 700; text-anchor: middle; }
`;

const ID_STRIP = 14;

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sceneToSvg(scene: Scene, title: string): string {
  const w = Math.max(scene.width, 1);
  const h = Math.max(scene.height, 1);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="vico-board" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<style>${SVG_STYLE}</style>`,
    arrowDefs(),
    ...scene.bands.map(bandMarkup),
    ...scene.connectors.map(connectorMarkup),
    ...scene.cards.map((c) => `<g transform="translate(${c.x} ${c.y})">${cardMarkup(c)}</g>`),
    "</svg>",
  ].join("\n");
}

export function arrowDefs(): string {
  return `<defs><marker id="vico-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="vico-arrow" d="M0 0L10 5L0 10z"/></marker></defs>`;
}

export function bandMarkup(b: Band): string {
  const mid = b.y + b.h / 2;
  switch (b.kind) {
    case "step":
      return `<g class="band band-step"><line class="band-rule" x1="${b.x}" y1="0" x2="${b.x}" y2="${b.h}"/><text class="band-step-label" x="${b.x + b.w / 2}" y="20">${esc(b.label)}</text></g>`;
    case "row":
      return `<g class="band band-row"><line class="band-rule" x1="0" y1="${b.y}" x2="${b.w}" y2="${b.y}"/><rect x="12" y="${mid - 6}" width="12" height="12" rx="2" fill="${esc(b.swatch ?? "#E8EEF4")}" stroke="rgba(0,0,0,.2)"/><text class="band-label" x="32" y="${mid + 4}">${esc(b.label)}</text></g>`;
    case "lane":
      return `<g class="band band-lane"><rect class="lane-bg" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/><text class="lane-label" x="${b.x + 14}" y="${b.y + 27}">${esc(b.label)}</text><text class="lane-count" x="${b.x + b.w - 14}" y="${b.y + 27}">${b.count ?? 0}</text></g>`;
  }
}

export function connectorMarkup(c: Connector): string {
  const label = c.label
    ? `<text class="conn-label" x="${c.labelX}" y="${c.labelY}">${esc(c.label)}</text>`
    : "";
  return `<g class="conn" data-src="${esc(c.src)}" data-dst="${esc(c.dst)}"><path d="${c.d}" marker-end="url(#vico-arrow)"/>${label}</g>`;
}

/** A card drawn at the origin; the caller positions it. */
export function cardMarkup(c: Card): string {
  const first = (c.h + ID_STRIP - c.lines.length * LINE_H) / 2 + 12;
  const lines = c.lines
    .map((line, i) => `<tspan x="${c.w / 2}" y="${first + i * LINE_H}">${esc(line)}</tspan>`)
    .join("");
  return [
    `<title>${esc(c.tip)}</title>`,
    shapeMarkup(c),
    `<text class="card-id" x="${8 + inset(c)}" y="14" fill="${esc(c.ink)}">${esc(c.id)}</text>`,
    authorMark(c),
    `<text class="card-label" fill="${esc(c.ink)}">${lines}</text>`,
    c.hasDetail
      ? `<text class="card-detail" x="${c.w - 8}" y="${c.h - 7}" fill="${esc(c.ink)}">≡</text>`
      : "",
    c.notes > 0
      ? `<g class="card-notes"><circle cx="${c.w - 3}" cy="3" r="9"/><text x="${c.w - 3}" y="6.5">${c.notes}</text></g>`
      : "",
  ].join("");
}

/** How far a shape's cut corners push the id and the author mark inward. */
function inset(c: Card): number {
  return c.shape === "diamond" || c.shape === "pill" ? 16 : 0;
}

function shapeMarkup(c: Card): string {
  const fill = `class="card-shape" fill="${esc(c.fill)}"`;
  if (c.shape === "diamond") {
    const cut = 14;
    const points = `${cut},0 ${c.w - cut},0 ${c.w},${c.h / 2} ${c.w - cut},${c.h} ${cut},${c.h} 0,${c.h / 2}`;
    return `<polygon ${fill} points="${points}"/>`;
  }
  const radius = { sticky: 2, sharp: 0, box: 8, pill: c.h / 2 }[c.shape];
  return `<rect ${fill} width="${c.w}" height="${c.h}" rx="${radius}"/>`;
}

/** Who put the card there: a diamond for the agent, a dot for the human. Shape, not colour. */
function authorMark(c: Card): string {
  const x = (c.notes > 0 ? c.w - 26 : c.w - 12) - inset(c);
  const ink = `fill="${esc(c.ink)}" opacity="0.7"`;
  if (c.by === "agent") return `<path class="card-author" ${ink} d="M${x} 6l4 4l-4 4l-4-4z"/>`;
  if (c.by === "human") return `<circle class="card-author" ${ink} cx="${x}" cy="10" r="3"/>`;
  return "";
}
