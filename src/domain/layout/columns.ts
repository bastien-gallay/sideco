/**
 * Columns layout: one named lane per column, elements stacked top to bottom in
 * board order. Kanban, retrospectives, any "sort these into buckets" workshop.
 */

import type { Format } from "../formats.ts";
import type { Locale } from "../i18n.ts";
import type { Board, Element } from "../workspace.ts";
import {
  type Band,
  CARD_H,
  CARD_W,
  type Card,
  labelHeight,
  MARGIN,
  type Scene,
  type Target,
} from "./scene.ts";

const LANE_W = 192;
const LANE_GAP = 16;
const HEADER_H = 44;
const STACK_GAP = 10;
const LANE_PAD = 12;
const MIN_SLOTS = 3;
/** The room of one full-height card: the free slot at the end of a lane. */
const SLOT_H = CARD_H + STACK_GAP;
const STACK_TOP = MARGIN + HEADER_H + LANE_PAD;

export function layoutColumns(
  board: Board,
  format: Format,
  card: (e: Element, x: number, y: number) => Card,
  locale: Locale,
): Scene {
  const stacks = format.lanes.map((lane) => board.elements.filter((e) => e.lane === lane.id));
  const laneH = laneHeight(stacks);

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
    let y = STACK_TOP;
    for (const e of stack) {
      const placed = card(e, x + (LANE_W - CARD_W) / 2, y);
      cards.push(placed);
      y += placed.h + STACK_GAP;
    }
  });
  const width = laneX(format.lanes.length) - LANE_GAP + MARGIN;
  return { width, height: MARGIN + laneH + MARGIN, bands, cards, connectors: [] };
}

/** A lane holds its stack and one free slot to drop into; an empty board still shows room to work. */
function laneHeight(stacks: Element[][]): number {
  const tallest = Math.max(...stacks.map((stack) => stackHeight(stack)));
  return HEADER_H + LANE_PAD + Math.max(MIN_SLOTS * SLOT_H, tallest + SLOT_H);
}

function laneX(index: number): number {
  return MARGIN + index * (LANE_W + LANE_GAP);
}

/** The room a stack takes, each card as tall as its label. */
function stackHeight(stack: Element[]): number {
  return stack.reduce((sum, e) => sum + labelHeight(e.label) + STACK_GAP, 0);
}

/** The lane under a point and the card the drop would land before; `moving` is left out of the count. */
export function locateInColumns(board: Board, format: Format, x: number, y: number, moving?: string): Target {
  const index = format.lanes.findIndex((_, i) => x >= laneX(i) && x < laneX(i) + LANE_W);
  const lane = format.lanes[index];
  if (!lane || y < MARGIN) return { kind: "none" };
  const stack = board.elements.filter((e) => e.lane === lane.id && e.id !== moving);
  // The drop lands before the first card whose upper half is at or below the pointer.
  let top = STACK_TOP;
  for (const e of stack) {
    const h = labelHeight(e.label);
    if (y < top + h / 2) return { kind: "slot", lane: lane.id, before: e.id };
    top += h + STACK_GAP;
  }
  return { kind: "slot", lane: lane.id, before: undefined };
}
