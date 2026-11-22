import { describe, expect, test } from "bun:test";
import type { Recorded } from "../../src/domain/events.ts";
import { forPage, RECENT_EVENTS, recentFrom } from "../../src/domain/opening.ts";
import { type Session, TURNS_SHOWN } from "../../src/domain/sessions.ts";
import { emptyWorkspace, replay } from "../../src/domain/workspace.ts";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const RECENTLY = "2026-11-21T11:59:00.000Z";
const LONG_AGO = "2026-11-19T12:00:00.000Z";

function session(id: string, deliveredUpTo: number, lastAt = RECENTLY): Session {
  return {
    id,
    startedAt: LONG_AGO,
    turns: [],
    todos: [],
    status: "idle",
    deliveredUpTo,
    lastSeq: 0,
    lastAt,
  };
}

const at = (seq: number, sessions: Session[] = []) => ({ ...emptyWorkspace(), seq, sessions });

describe("where a page's recent events start", () => {
  test("the last few hundred events, for the history the panel lists at once", () => {
    expect(recentFrom(at(10_000), NOW)).toBe(10_000 - RECENT_EVENTS);
  });

  test("the whole journal when it is shorter than that", () => {
    expect(recentFrom(at(120), NOW)).toBe(0);
  });

  test("earlier, so what an open session has not been told is all there", () => {
    expect(recentFrom(at(10_000, [session("s1", 4_000), session("s2", 9_900)]), NOW)).toBe(4_000);
  });

  test("a session told nothing yet, or silent for too long, does not reach back", () => {
    const sessions = [session("new", 0), session("gone", 1_000, LONG_AGO)];
    expect(recentFrom(at(10_000, sessions), NOW)).toBe(10_000 - RECENT_EVENTS);
  });
});

describe("the workspace a page opens on", () => {
  const prompt = (seq: number, text: string): Recorded => ({
    seq,
    ts: RECENTLY,
    actor: "agent",
    session: "s1",
    event: "PromptSubmitted",
    text,
  });
  const tool = (seq: number): Recorded => ({
    seq,
    ts: RECENTLY,
    actor: "agent",
    session: "s1",
    event: "ToolStarted",
    tool: "Bash",
    call: `c${seq}`,
    summary: "ls",
  });

  test("keeps the tools of the turns the session panel shows, and only the prompts of the others", () => {
    const turns = TURNS_SHOWN + 2;
    const events = Array.from({ length: turns }, (_, k) => [
      prompt(2 * k + 1, `p${k}`),
      tool(2 * k + 2),
    ]).flat();
    const ws = replay(events);
    const page = forPage(ws);
    const shown = page.sessions[0]?.turns ?? [];
    expect(shown.map((t) => t.prompt)).toEqual(ws.sessions[0]?.turns.map((t) => t.prompt) ?? []);
    expect(shown.map((t) => t.tools.length)).toEqual([0, 0, 1, 1, 1, 1]);
  });

  test("leaves the hub's own workspace as it was", () => {
    const ws = replay([
      prompt(1, "a"),
      tool(2),
      ...Array.from({ length: TURNS_SHOWN }, (_, k) => prompt(3 + k, "b")),
    ]);
    forPage(ws);
    expect(ws.sessions[0]?.turns[0]?.tools).toHaveLength(1);
  });
});
