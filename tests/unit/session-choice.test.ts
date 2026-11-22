/**
 * Two Claude Code sessions on one project: each can be told apart by a name,
 * and the page shows the one the board in view is for, unless the reader
 * chose another.
 */
import { describe, expect, test } from "bun:test";
import { boardAction } from "../../src/cli/argv.ts";
import { describeSessions } from "../../src/domain/project-digest.ts";
import {
  hasSpoken,
  isOpen,
  STALE_SESSION_MS,
  sessionLabel,
  shownSession,
} from "../../src/domain/sessions.ts";
import { describeEvent } from "../../src/web/event-words.ts";
import { KANBAN, T0, table } from "../support.ts";

const label = (t: { ws: { sessions: Parameters<typeof sessionLabel>[0][] } }): string | undefined => {
  const first = t.ws.sessions[0];
  return first && sessionLabel(first);
};

const GQ = "810b7a97-ae8b-46d3-9c83-cf6e98e11eed";
const UI = "33236aaa-0000-4000-8000-000000000000";

/** Two running sessions: gq writes on the kanban, ui on a flow, and ui speaks last. */
function two() {
  const t = table(KANBAN);
  t.do({ kind: "session-start" }, "system", GQ);
  t.do({ kind: "session-start" }, "system", UI);
  t.do({ kind: "follow", boards: ["sprint"] }, "agent", GQ);
  t.do({ kind: "create-board", board: "parcours", title: "Parcours", format: "flow" }, "agent", UI);
  t.do({ kind: "follow", boards: ["parcours"] }, "agent", UI);
  t.do({ kind: "prompt", text: "on avance" }, "human", UI);
  return t;
}

describe("telling sessions apart", () => {
  test("a session is named by `session name`; unnamed, it goes by the start of its id", () => {
    const t = two();
    expect(label(t)).toBe("810b7a97");
    t.do({ kind: "name-session", name: "sideco-gq" }, "agent", GQ);
    expect(t.events.at(-1)).toMatchObject({ event: "SessionNamed", name: "sideco-gq", session: GQ });
    expect(label(t)).toBe("sideco-gq");
    const seq = t.seq;
    t.do({ kind: "name-session", name: "sideco-gq" }, "agent", GQ);
    expect(t.seq).toBe(seq);
    expect(() => t.do({ kind: "name-session", name: "x" }, "agent")).toThrow("needs a session");
  });

  test("the history words it, and the command line says it", () => {
    const t = two();
    t.do({ kind: "name-session", name: "sideco-gq" }, "agent", GQ);
    expect(describeEvent(t.events.at(-1) as never)).toBe("Claude names its session “sideco-gq”");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Claude nomme sa session « sideco-gq »");
    expect(boardAction(["session", "name", "sideco-gq"], undefined).command).toEqual({
      kind: "name-session",
      name: "sideco-gq",
    });
  });
});

describe("`sideco sessions`", () => {
  test("lists the sessions still open, latest first, with what each follows; the caller's is marked", () => {
    const t = two();
    t.do({ kind: "name-session", name: "sideco-gq" }, "agent", GQ);
    expect(describeSessions(t.ws, UI, Date.parse(T0))).toBe(
      ["sideco-gq (810b7a97)  idle  follows sprint", "33236aaa  thinking  follows parcours  ← you"].join(
        "\n",
      ),
    );
    t.do({ kind: "session-end" }, "system", GQ);
    expect(describeSessions(t.ws, undefined, Date.parse(T0))).toBe("33236aaa  thinking  follows parcours");
  });
});

describe("a session silent for half a day", () => {
  test("was killed rather than ended: it is no longer open, nor listed", () => {
    const t = two();
    const now = Date.parse(T0);
    const [gq] = t.ws.sessions;
    if (!gq) throw new Error("no session");
    expect(gq.lastAt).toBe(T0);
    expect(isOpen(gq, now + STALE_SESSION_MS - 1)).toBe(true);
    expect(isOpen(gq, now + STALE_SESSION_MS)).toBe(false);
    expect(describeSessions(t.ws, UI, now + STALE_SESSION_MS)).toBe("no session open");
    t.do({ kind: "session-end" }, "system", GQ);
    expect(isOpen(gq, now)).toBe(false);
  });
});

describe("a session nobody spoke to (T195)", () => {
  const SILENT = "08d6b510-0000-4000-8000-000000000000";

  test("is not offered, nor shown for want of a better one, until a prompt or a tool", () => {
    const t = two();
    t.do({ kind: "session-start" }, "system", SILENT);
    const silent = t.ws.sessions.find((s) => s.id === SILENT);
    if (!silent) throw new Error("no session");
    expect(hasSpoken(silent)).toBe(false);
    expect(shownSession(t.ws)?.id).toBe(UI);
    expect(shownSession(t.ws, undefined, SILENT)?.id).toBe(SILENT);
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "ls" }, "agent", SILENT);
    expect(hasSpoken(silent)).toBe(true);
    expect(shownSession(t.ws)?.id).toBe(SILENT);
  });

  test("alone on the project, it is still the one shown", () => {
    const t = table(KANBAN);
    t.do({ kind: "session-start" }, "system", SILENT);
    expect(shownSession(t.ws)?.id).toBe(SILENT);
  });
});

describe("the session shown", () => {
  test("is the one the board in view is for, not the last to speak", () => {
    const t = two();
    expect(shownSession(t.ws, "sprint")?.id).toBe(GQ);
    expect(shownSession(t.ws, "parcours")?.id).toBe(UI);
  });

  test("without a board, or on a board no running session is for, it is the last to speak", () => {
    const t = two();
    expect(shownSession(t.ws)?.id).toBe(UI);
    t.do({ kind: "session-end" }, "system", GQ);
    expect(shownSession(t.ws, "sprint")?.id).toBe(UI);
  });

  test("the reader's choice wins while that session exists; an unknown choice is ignored", () => {
    const t = two();
    expect(shownSession(t.ws, "sprint", UI)?.id).toBe(UI);
    expect(shownSession(t.ws, "sprint", "gone")?.id).toBe(GQ);
  });
});
