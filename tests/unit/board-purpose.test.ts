/**
 * The question a board answers belongs to it: the workshop gives one, the
 * board may ask its own. A SWOT drawn on an impact / effort plan does not ask
 * "What do we do first?".
 */
import { describe, expect, test } from "bun:test";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { toHtml } from "../../src/domain/export/html.ts";
import { toMarkdown } from "../../src/domain/export/markdown.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { boardPurpose, findFormat } from "../../src/domain/formats.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { IMPACT_EFFORT, table } from "../support.ts";

const META = { exportedAt: "2026-11-20T10:00:00.000Z" };
const SWOT = "Où en est-on face au marché ?";
const asked = (board: { format: string; purpose?: string }, locale: "en" | "fr" = "en") =>
  boardPurpose(findFormat(board.format), board, locale);

describe("the question a board answers", () => {
  test('is its workshop\'s until `purpose "…"` asks its own; the same again records nothing; "" gives it back', () => {
    const t = table(IMPACT_EFFORT);
    expect(asked(t.board())).toBe("What do we do first, for what it brings and what it costs?");
    t.script(`purpose "${SWOT}"`);
    expect(t.events.at(-1)).toMatchObject({ event: "BoardPurposed", purpose: SWOT });
    expect(asked(t.board())).toBe(SWOT);
    expect(asked(t.board(), "fr")).toBe(SWOT);
    const seq = t.seq;
    t.script(`purpose "${SWOT}"`);
    expect(t.seq).toBe(seq);
    t.script('purpose ""');
    expect(asked(t.board(), "fr")).toBe("Que fait-on d'abord, pour ce que ça rapporte et ce que ça coûte ?");
  });

  test("the agent reads its own question on the board, and its change", () => {
    const t = table(IMPACT_EFFORT);
    expect(describeBoard(t.board())).not.toContain("question:");
    const mark = t.seq;
    t.script(`purpose "${SWOT}"`, "human");
    expect(describeBoard(t.board()).split("\n")[1]).toBe(`question: "${SWOT}"`);
    expect(describeChanges(t.events, mark).text).toContain(`~ board asks "${SWOT}"`);
  });

  test("exports say it; a model read back keeps it; undo gives the former back", () => {
    const t = table(IMPACT_EFFORT).script(`purpose "${SWOT}"`, "human");
    expect(toMarkdown(t.board(), META)).toContain(`> **Impact / Effort** — ${SWOT}`);
    expect(toHtml(t.board(), META)).toContain(`<strong>Impact / Effort</strong> — ${SWOT}`);
    const back = table();
    for (const command of fromModel(JSON.parse(JSON.stringify(toModel(t.board()))), "copy")) back.do(command);
    expect(asked(back.board())).toBe(SWOT);
    t.do({ kind: "undo", board: "priorites" }, "human");
    expect(asked(t.board())).toBe("What do we do first, for what it brings and what it costs?");
  });

  test("the history words it", () => {
    const t = table(IMPACT_EFFORT).script(`purpose "${SWOT}"`, "human");
    expect(describeEvent(t.events.at(-1) as never)).toBe(`You ask the board “${SWOT}”`);
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe(`Tu poses au tableau la question « ${SWOT} »`);
  });
});
