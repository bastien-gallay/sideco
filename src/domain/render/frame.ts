/**
 * What a notation asks around a drawing that leaves the page: a heading over it
 * and, under it, a key that names each kind beside the way it is drawn.
 */
import type { Shape } from "../formats/types.ts";
import { MARGIN } from "../layout/scene.ts";

export interface KeyEntry {
  label: string;
  fill: string;
  shape: Shape;
  /** Drawn in outline, as the cards of its kind are: its colour on a light page and on a dark one. */
  tone?: { light: string; dark: string };
}

export interface Frame {
  /** Absent where the document around the drawing already says it. */
  heading?: string;
  key: readonly KeyEntry[];
}

const HEADING_H = 32;
const HEADING_CHAR_W = 8.2;
const KEY_H = 30;
const SWATCH_W = 20;
const SWATCH_H = 13;
const KEY_CHAR_W = 6.6;
const KEY_GAP = 22;

const escaped = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const entryWidth = (entry: KeyEntry): number => SWATCH_W + 6 + Math.ceil(entry.label.length * KEY_CHAR_W);

/** The room the frame takes around a drawing: above it, under it, and how wide it has to be. */
export function frameRoom(frame: Frame | undefined): { top: number; bottom: number; width: number } {
  if (!frame) return { top: 0, bottom: 0, width: 0 };
  const key = frame.key.reduce((sum, entry) => sum + entryWidth(entry), 0) + KEY_GAP * (frame.key.length - 1);
  const heading = Math.ceil((frame.heading?.length ?? 0) * HEADING_CHAR_W);
  return { top: frame.heading ? HEADING_H : 0, bottom: KEY_H, width: Math.max(key, heading) + 2 * MARGIN };
}

/** The heading at the top, the key on one line from `y` down, both from the margin the cards start at. */
export function frameMarkup(frame: Frame, y: number): string[] {
  const heading = frame.heading
    ? [`<text class="frame-heading" x="${MARGIN}" y="22">${escaped(frame.heading)}</text>`]
    : [];
  let x = MARGIN;
  const key = frame.key.map((entry) => {
    const at = x;
    x += entryWidth(entry) + KEY_GAP;
    const tone = entry.tone
      ? ` card-outline" style="--tone-light:${escaped(entry.tone.light)};--tone-dark:${escaped(entry.tone.dark)}`
      : "";
    const radius = entry.shape === "person" || entry.shape === "pill" ? SWATCH_H / 2 : 3;
    return `<g class="frame-key${tone}" transform="translate(${at} ${y})"><rect class="card-shape" fill="${escaped(entry.fill)}" width="${SWATCH_W}" height="${SWATCH_H}" rx="${radius}"/><text x="${SWATCH_W + 6}" y="11">${escaped(entry.label)}</text></g>`;
  });
  return [...heading, ...key];
}
