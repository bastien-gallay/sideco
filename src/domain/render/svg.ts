/**
 * Scene to SVG. The same markup is used by the static export and by the live
 * page, so a published diagram looks like the board it came from.
 *
 * Colours of the chrome are CSS variables with fallbacks: standalone files get
 * the light theme, the page overrides the variables.
 */

import { NAME_LINE_H, nameLines } from "../layout/connector-labels.ts";
import {
  type Band,
  BLURB_H,
  blurbHeight,
  type Card,
  type Connector,
  cardName,
  KIND_H,
  LINE_H,
  labelsHeight,
  PERSON_HEAD,
  type Scene,
} from "../layout/scene.ts";
import { cardChipText, chipText, labelColours } from "./labels.ts";

export const SVG_STYLE = `
.sideco-board { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.band-rule { stroke: var(--sideco-rule, #E3E6EA); stroke-width: 1; }
.band-label { fill: var(--sideco-muted, #59636E); font-size: 12px; font-weight: 600; }
.heads-backbone-strip { display: none; }
.shows-backbone .step-caption, .shows-backbone .heads-backbone-strip { display: inline; }
.step-caption { display: none; fill: var(--sideco-muted, #59636E); font-size: 11px; text-anchor: middle; }
.band-step-label { fill: var(--sideco-muted, #59636E); font-size: 11px; text-anchor: middle; }
.slice-rule { stroke: var(--sideco-ink, #1F2328); stroke-width: 2; stroke-dasharray: 8 4; }
.slice-label { fill: var(--sideco-ink, #1F2328); font-size: 12px; font-weight: 700; }
.lane-bg { fill: var(--sideco-lane, #F3F4F6); }
.lane-label { fill: var(--sideco-ink, #1F2328); font-size: 13px; font-weight: 600; }
.lane-count { fill: var(--sideco-muted, #59636E); font-size: 12px; text-anchor: end; }
.axis-bound { fill: var(--sideco-muted, #59636E); font-size: 11px; }
.axis-bound.is-high { text-anchor: end; }
.axis-label { fill: var(--sideco-muted, #59636E); font-size: 12px; font-weight: 600; text-anchor: middle; letter-spacing: 0.04em; }
.lane-hint { fill: var(--sideco-muted, #59636E); font-size: 11px; }
.conn path { fill: none; stroke: var(--sideco-conn, #6E7781); stroke-width: 1.5; }
.conn-label { fill: var(--sideco-muted, #59636E); font-size: 11px; paint-order: stroke; stroke: var(--sideco-bg, #FFFFFF); stroke-width: 4px; stroke-linejoin: round; }
.sideco-arrow { fill: var(--sideco-conn, #6E7781); }
.card-shape { stroke: rgba(0, 0, 0, 0.2); stroke-width: 1; }
.card-id { font-size: 10px; font-weight: 700; }
.card-label { font-size: 13px; text-anchor: middle; }
.card-detail { font-size: 11px; text-anchor: end; }
.card-done { font-size: 11px; font-weight: 700; }
.card-blurb { font-size: 11px; text-anchor: middle; }
.card-label-chip { stroke: rgba(0, 0, 0, 0.15); stroke-width: 1; }
.card-label-text { font-size: 10px; font-weight: 600; text-anchor: middle; }
.card-label-done { text-decoration: line-through; opacity: 0.65; }
.card-notes circle { fill: #1A6FAE; stroke: var(--sideco-bg, #FFFFFF); stroke-width: 2; }
.card-notes text { fill: #FFFFFF; font-size: 10px; font-weight: 700; text-anchor: middle; }
.card-kind { font-size: 11px; text-anchor: middle; }
.card-outline .card-shape { fill: var(--sideco-bg, #FFFFFF); fill-opacity: 1; stroke: light-dark(var(--tone-light), var(--tone-dark)); stroke-width: 2; }
.card-outline > text, .card-outline .card-person, .card-outline .card-author { fill: light-dark(var(--tone-light), var(--tone-dark)); opacity: 1; }
.card-outline .card-label { font-weight: 600; }
`;

const ID_STRIP = 14;

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sceneToSvg(scene: Scene, title: string): string {
  const w = Math.max(scene.width, 1);
  const h = Math.max(scene.height, 1);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="sideco-board" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`,
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
  return `<defs><marker id="sideco-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sideco-arrow" d="M0 0L10 5L0 10z"/></marker></defs>`;
}

export function bandMarkup(b: Band): string {
  const mid = b.y + b.h / 2;
  switch (b.kind) {
    case "step": {
      // A story map's step also says its activity and task, shown only once those rows have scrolled away.
      const caption = (b.caption ?? [])
        .map(
          (line, i) =>
            `<text class="step-caption" data-col="${esc(b.id)}" x="${b.x + b.w / 2}" y="${38 + 15 * i}">${esc(line)}</text>`,
        )
        .join("");
      return `<g class="band band-step"><line class="band-rule" x1="${b.x}" y1="0" x2="${b.x}" y2="${b.h}"/><text class="band-step-label" data-col="${esc(b.id)}" x="${b.x + b.w / 2}" y="20">${esc(b.label)}</text>${caption}</g>`;
    }
    case "row":
      return `<g class="band band-row"><line class="band-rule" x1="0" y1="${b.y}" x2="${b.w}" y2="${b.y}"/><rect x="12" y="${mid - 6}" width="12" height="12" rx="2" fill="${esc(b.swatch ?? "#E8EEF4")}" stroke="rgba(0,0,0,.2)"/><text class="band-label" x="32" y="${mid + 4}">${esc(b.label)}</text></g>`;
    case "axis": {
      // The name runs along its axis, and an arrow says which way it grows: up, or to the right.
      const cx = b.x + b.w / 2;
      const turn = b.id === "y" ? ` transform="rotate(-90 ${cx} ${mid})"` : "";
      // Its two ends are named where they are: low where it starts, high where it ends.
      const half = (b.id === "y" ? b.h : b.w) / 2 - 8;
      const axis = `data-axis="${esc(b.id)}"`;
      const end = (cls: string, bound: string, x: number, word: string | undefined): string =>
        word
          ? `<text class="${cls}" x="${x}" y="${mid + 4}"${turn} ${axis} data-bound="${bound}">${esc(word)}</text>`
          : "";
      return `<g class="band band-axis"><text class="axis-label" x="${cx}" y="${mid + 4}"${turn} ${axis}>${esc(b.label)} →</text>${end("axis-bound", "low", cx - half, b.low)}${end("axis-bound is-high", "high", cx + half, b.high)}</g>`;
    }
    case "slice":
      // A line across the board, its name just under it: the stories above it ship first.
      return `<g class="band band-slice"><line class="slice-rule" x1="${b.x}" y1="${b.y}" x2="${b.x + b.w}" y2="${b.y}"/><text class="slice-label" x="12" y="${b.y + 18}">${esc(b.label)}</text></g>`;
    case "lane":
      return `<g class="band band-lane"><rect class="lane-bg" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/>${laneHeading(b)}</g>`;
  }
}

/** Across the top of a lane: its name, how many cards it holds, and what it stands for when it says so. */
function laneHeading(b: Band): string {
  // The name moves up to leave the second line to the hint.
  const y = b.y + (b.hint ? 21 : 27);
  const hint = b.hint
    ? `<text class="lane-hint" x="${b.x + 14}" y="${b.y + 37}" data-lane="${esc(b.id)}">${esc(b.hint)}</text>`
    : "";
  return `<text class="lane-label" x="${b.x + 14}" y="${y}" data-lane="${esc(b.id)}">${esc(b.label)}</text><text class="lane-count" x="${b.x + b.w - 14}" y="${y}">${b.count ?? 0}</text>${hint}`;
}

export function connectorMarkup(c: Connector): string {
  const label = !c.label
    ? ""
    : c.unwritten
      ? `<title>${esc(c.label)}</title>`
      : connectorName(c.label, c.labelX, c.labelY);
  return `<g class="conn" data-src="${esc(c.src)}" data-dst="${esc(c.dst)}"><path d="${c.d}" marker-end="url(#sideco-arrow)"/>${label}</g>`;
}

/** A link's name on its lines; cut short, the link says it whole on hover. */
function connectorName(label: string, x: number, y: number): string {
  const lines = nameLines(label);
  if (lines.length === 1 && lines[0] === label)
    return `<text class="conn-label" x="${x}" y="${y}">${esc(label)}</text>`;
  const spans = lines.map((l, k) => `<tspan x="${x}" dy="${k === 0 ? 0 : NAME_LINE_H}">${esc(l)}</tspan>`);
  const whole = lines.join(" ") === label ? "" : `<title>${esc(label)}</title>`;
  return `<text class="conn-label" x="${x}" y="${y}">${whole}${spans.join("")}</text>`;
}

/** A card drawn at the origin; the caller positions it. In outline, it wears the tones of its kind. */
export function cardMarkup(c: Card): string {
  const parts = [
    `<title>${esc(tooltip(c))}</title>`,
    shapeMarkup(c),
    `<text class="card-id" x="${8 + inset(c)}" y="14" fill="${esc(c.ink)}">${esc(c.id)}</text>`,
    authorMark(c),
    wordsMarkup(c),
    labelsMarkup(c),
    c.done ? `<text class="card-done" x="${doneX(c)}" y="14" fill="${esc(c.ink)}">✓</text>` : "",
    // The glyph is small; the target around it is not: 22 by 24, under it, so a finger takes it too.
    c.hasDetail
      ? `<rect class="card-detail-hit" x="${detailX(c) - 15}" y="0" width="22" height="24" fill="transparent"/><text class="card-detail" x="${detailX(c)}" y="14" fill="${esc(c.ink)}">≡</text>`
      : "",
    c.notes > 0
      ? `<g class="card-notes"><circle cx="${c.w - 3}" cy="3" r="9"/><text x="${c.w - 3}" y="6.5">${c.notes}</text></g>`
      : "",
  ].join("");
  if (!c.tone) return parts;
  return `<g class="card-outline" style="--tone-light:${esc(c.tone.light)};--tone-dark:${esc(c.tone.dark)}">${parts}</g>`;
}

/** The name, what the card is, and the description under them: one block, centred below the strip of the id. */
function wordsMarkup(c: Card): string {
  const said = c.blurb ?? [];
  const kindH = c.kind ? KIND_H : 0;
  const block = c.lines.length * LINE_H + kindH + blurbHeight(said.length);
  // A row of labels takes the foot of the card: the words are centred in what is left above it.
  const body = c.h - labelsHeight(c.labels);
  const strip = ID_STRIP + (c.shape === "person" ? PERSON_HEAD : 0);
  const first = (body + strip - block) / 2 + 12;
  const tspans = (lines: readonly string[], y: number, step: number): string =>
    lines.map((line, i) => `<tspan x="${c.w / 2}" y="${y + i * step}">${esc(line)}</tspan>`).join("");
  const last = first + (c.lines.length - 1) * LINE_H;
  // The description's first line sits one line, and the gap, under what comes before it.
  const under = last + kindH + blurbHeight(1);
  const ink = `fill="${esc(c.ink)}"`;
  return [
    `<text class="${c.done ? "card-label card-label-done" : "card-label"}" ${ink}>${tspans(c.lines, first, LINE_H)}</text>`,
    c.kind ? `<text class="card-kind" ${ink}>${tspans([c.kind], last + KIND_H, 0)}</text>` : "",
    said.length > 0 ? `<text class="card-blurb" ${ink}>${tspans(said, under, BLURB_H)}</text>` : "",
  ].join("");
}

/**
 * What a pointer resting on a card reads: the whole label when the card cuts
 * it, then who added it, then the detail, which the card only marks with ≡.
 */
function tooltip(c: Card): string {
  const cut = c.lines.at(-1)?.endsWith("…") ?? false;
  const labels = c.labels?.map(chipText).join(" · ");
  return [cut ? cardName(c) : c.tip, labels, c.detail].filter(Boolean).join("\n");
}

/** About how wide a run of 10px text is: enough to size a chip without measuring it. */
const CHIP_CHAR_W = 5.9;
const CHIP_PAD = 5;
const CHIP_GAP = 4;
const CHIP_H = 14;

/**
 * The labels a card wears, as chips along its foot: as many as fit, the last
 * cut with … when it alone is too long, then "+N" for the ones left out. The
 * tooltip and the Detail tab name them all.
 */
function labelsMarkup(c: Card): string {
  const labels = c.labels ?? [];
  if (labels.length === 0) return "";
  const left = 8 + inset(c) / 2;
  const right = c.w - 6 - inset(c) / 2;
  const top = c.h - labelsHeight(labels) + 2;
  const width = (text: string): number => Math.round(text.length * CHIP_CHAR_W + 2 * CHIP_PAD);
  const chips: string[] = [];
  let x = left;
  for (const [i, label] of labels.entries()) {
    const rest = labels.length - i - 1;
    const more = rest > 0 ? width(`+${rest}`) + CHIP_GAP : 0;
    let text = cardChipText(label);
    const room = right - x - more;
    if (width(text) > room) {
      // The first chip is cut to fit; a later one gives way to the count of those left out.
      if (i > 0) {
        chips.push(chip(x, top, `+${labels.length - i}`, { fill: "#FFFFFF", ink: "#3A424B" }));
        break;
      }
      const keep = Math.max(1, Math.floor((room - 2 * CHIP_PAD) / CHIP_CHAR_W) - 1);
      text = `${text.slice(0, keep)}…`;
    }
    chips.push(chip(x, top, text, labelColours(label)));
    x += width(text) + CHIP_GAP;
  }
  return `<g class="card-labels">${chips.join("")}</g>`;

  function chip(at: number, y: number, text: string, colours: { fill: string; ink: string }): string {
    const w = width(text);
    return `<rect class="card-label-chip" x="${at}" y="${y}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${colours.fill}"/><text class="card-label-text" x="${at + w / 2}" y="${y + 10.5}" fill="${colours.ink}">${esc(text)}</text>`;
  }
}

/** How far a shape's cut corners push the id and the author mark inward. */
function inset(c: Card): number {
  return c.shape === "diamond" || c.shape === "pill" ? 16 : c.shape === "person" ? 4 : 0;
}

function shapeMarkup(c: Card): string {
  const fill = `class="card-shape" fill="${esc(c.fill)}"`;
  if (c.shape === "diamond") {
    const cut = 14;
    const points = `${cut},0 ${c.w - cut},0 ${c.w},${c.h / 2} ${c.w - cut},${c.h} ${cut},${c.h} 0,${c.h / 2}`;
    return `<polygon ${fill} points="${points}"/>`;
  }
  if (c.shape === "person") return `<rect ${fill} width="${c.w}" height="${c.h}" rx="16"/>${personMark(c)}`;
  const radius = { sticky: 2, sharp: 0, box: 8, pill: c.h / 2 }[c.shape];
  return `<rect ${fill} width="${c.w}" height="${c.h}" rx="${radius}"/>`;
}

/**
 * C4's person, centred above the name: a head and shoulders, 25 px tall.
 * Inside the card, so links still meet its edge and nothing overlaps the card above.
 */
function personMark(c: Card): string {
  const x = c.w / 2;
  return `<g class="card-person" fill="${esc(c.ink)}"><circle cx="${x}" cy="11" r="6"/><path d="M${x - 11} 30a11 9 0 0 1 22 0z"/></g>`;
}

/** Who put the card there: a diamond for the agent, a dot for the human. Shape, not colour. */
/** Where the author's mark sits, in the strip of the id: left of the notes count when there is one. */
function authorX(c: Card): number {
  return (c.notes > 0 ? c.w - 26 : c.w - 12) - inset(c);
}

/**
 * The marks share the strip of the id rather than the corners under the label,
 * where a long last line ran into them: ✓ just after the id, ≡ just before the
 * author's mark.
 */
function doneX(c: Card): number {
  return Math.round(8 + inset(c) + c.id.length * 6.5 + 4);
}

function detailX(c: Card): number {
  return c.by === "agent" || c.by === "human"
    ? authorX(c) - 10
    : (c.notes > 0 ? c.w - 16 : c.w - 8) - inset(c);
}

function authorMark(c: Card): string {
  const x = authorX(c);
  const ink = `fill="${esc(c.ink)}" opacity="0.7"`;
  if (c.by === "agent") return `<path class="card-author" ${ink} d="M${x} 6l4 4l-4 4l-4-4z"/>`;
  if (c.by === "human") return `<circle class="card-author" ${ink} cx="${x}" cy="10" r="3"/>`;
  return "";
}
