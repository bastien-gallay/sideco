/**
 * What the journal sends a page: every fact, but of the tools each session ran,
 * only those of the turns its panel shows. Four fifths of a journal are tools.
 */
import { describe, expect, test } from "bun:test";
import type { Recorded } from "../../src/domain/events.ts";
import { forThePage, TURNS_SHOWN } from "../../src/domain/sessions.ts";
import { Hub } from "../../src/server/hub.ts";
import { memoryJournal } from "../../src/server/journal.ts";
import { ORDERING, T0, table } from "../support.ts";

/** Six turns of session s1, one tool each, and a board between the third and the fourth. */
function sixTurns(): ReturnType<typeof table> {
  const t = table();
  t.do({ kind: "session-start", cwd: "/repo" }, "agent", "s1");
  for (const n of [1, 2, 3, 4, 5, 6]) {
    t.do({ kind: "prompt", text: `turn ${n}` }, "agent", "s1");
    t.do({ kind: "tool-start", call: `c${n}`, tool: "Bash", summary: `step ${n}` }, "agent", "s1");
    t.do({ kind: "tool-finish", call: `c${n}`, ok: true }, "agent", "s1");
    if (n === 3) t.script(ORDERING);
  }
  return t;
}

const tools = (events: readonly Recorded[]): string[] =>
  events.flatMap((e) => (e.event === "ToolStarted" ? [e.summary] : []));

describe("the events a page is sent", () => {
  test("the panel shows four turns", () => {
    expect(TURNS_SHOWN).toBe(4);
  });

  test("of the tools, only those of each session's last four turns", () => {
    const t = sixTurns();
    const sent = t.events.filter(forThePage(t.ws));
    expect(tools(sent)).toEqual(["step 3", "step 4", "step 5", "step 6"]);
    expect(sent.filter((e) => e.event === "ToolFinished")).toHaveLength(4);
  });

  test("everything else, whatever its age", () => {
    const t = sixTurns();
    const sent = t.events.filter(forThePage(t.ws));
    const others = (events: readonly Recorded[]) =>
      events.filter((e) => e.event !== "ToolStarted" && e.event !== "ToolFinished");
    expect(others(sent)).toEqual(others(t.events));
  });

  test("a session with fewer turns than the panel shows keeps all its tools", () => {
    const t = table();
    t.do({ kind: "prompt", text: "only turn" }, "agent", "s2");
    t.do({ kind: "tool-start", call: "c1", tool: "Read", summary: "README.md" }, "agent", "s2");
    expect(t.events.filter(forThePage(t.ws))).toEqual(t.events);
  });

  test("the hub streams the trimmed journal to a page, from any point", () => {
    const t = sixTurns();
    const hub = new Hub(memoryJournal(t.events), () => new Date(T0));
    expect(tools(hub.pageEventsAfter(0))).toEqual(["step 3", "step 4", "step 5", "step 6"]);
    const fromTurnFive = t.events.find((e) => e.event === "PromptSubmitted" && e.text === "turn 5")?.seq ?? 0;
    expect(tools(hub.pageEventsAfter(fromTurnFive))).toEqual(["step 5", "step 6"]);
    expect(hub.eventsAfter(0)).toEqual(t.events);
  });
});
