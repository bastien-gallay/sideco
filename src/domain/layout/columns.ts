/**
 * Columns layout: one named lane per column, elements stacked top to bottom in
 * board order. Kanban, retrospectives, any "sort these into buckets" workshop.
 */

import type { Format } from "../formats.ts";
import type { Locale } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";
import { type Band, CARD_H, CARD_W, type Card, MARGIN, type Scene, type Target } from "./scene.ts";

const LANE_W = 192;
const LANE_GAP = 16;
const HEADER_H = 44;
const STACK_GAP = 10;
const LANE_PAD = 12;
const MIN_SLOTS = 3;

export function layoutColumns(
  board: Board,
  format: Format,
  card: (e: Element, x: number, y: number) => Card,
  locale: Locale,
): Scene {
  const stacks = format.lanes.map((lane) => board.elements.filter((e) => e.lane === lane.id));
  const slots = Math.max(MIN_SLOTS, ...stacks.map((s) => s.length + 1));
  const laneH = HEADER_H + LANE_PAD + slots * (CARD_H + STACK_GAP);

  const bands: Band[] = [];
  const cards: Card[] = [];
  format.lanes.forEach((lane, i) => {
    const x = laneX(i);
    const stack = stacks[i] ?? [];
    bands.push({
      kind: "lane",
      id: lane.id,
      label: lane.label[locale],
      x,
      y: MARGIN,
      w: LANE_W,
      h: laneH,
      count: stack.length,
    });
    stack.forEach((e, k) => {
      cards.push(card(e, x + (LANE_W - CARD_W) / 2, slotY(k)));
    });
  });
  const width = laneX(format.lanes.length) - LANE_GAP + MARGIN;
  return { width, height: MARGIN + laneH + MARGIN, bands, cards, connectors: [] };
}

function laneX(index: number): number {
  return MARGIN + index * (LANE_W + LANE_GAP);
}

function slotY(k: number): number {
  return MARGIN + HEADER_H + LANE_PAD + k * (CARD_H + STACK_GAP);
}

/** The lane under a point and the card the drop would land before; `moving` is left out of the count. */
export function locateInColumns(board: Board, format: Format, x: number, y: number, moving?: string): Target {
  const index = format.lanes.findIndex((_, i) => x >= laneX(i) && x < laneX(i) + LANE_W);
  const lane = format.lanes[index];
  if (!lane || y < MARGIN) return { kind: "none" };
  const stack = board.elements.filter((e) => e.lane === lane.id && e.id !== moving);
  const k = Math.max(0, Math.round((y - slotY(0)) / (CARD_H + STACK_GAP)));
  return { kind: "slot", lane: lane.id, before: stack[k]?.id };
}
