import { describe, expect, test } from "bun:test";
import { latestSession, replay } from "../../src/domain/workspace.ts";
import { KANBAN, ORDERING, table } from "../support.ts";

test("replaying the journal gives the same workspace as living through it", () => {
  const t = table(ORDERING).script("move E2 --col 3\nrm H1\nfocus E1").script(KANBAN);
  expect(replay(t.events)).toEqual(t.ws);
});

test("a prefix of the journal is the workspace at that moment", () => {
  const t = table(ORDERING);
  const past = replay(t.events.filter((e) => e.seq <= 3));
  expect(past.seq).toBe(3);
  expect(past.boards[0]?.elements.map((e) => e.id)).toEqual(["X1", "C1"]);
});

test("an element remembers who added it and when it last changed", () => {
  const t = table(ORDERING);
  t.do({ kind: "rename", board: "commande", id: "E1", label: "Commande validée" }, "human");
  const e1 = t.board().elements.find((e) => e.id === "E1");
  expect(e1).toMatchObject({ by: "agent", label: "Commande validée", addedSeq: 4, changedSeq: t.seq });
});

test("an event for a board that does not exist is ignored, not fatal", () => {
  const ws = replay([{ seq: 1, ts: "t", actor: "agent", event: "ElementRemoved", board: "ghost", id: "E1" }]);
  expect(ws).toEqual({ boards: [], removed: [], sessions: [], seq: 1 });
});

describe("the agent's status follows the session events", () => {
  const session = (): ReturnType<typeof table> => {
    const t = table();
    t.do({ kind: "session-start", cwd: "/repo" }, "agent", "s1");
    return t;
  };

  test("idle → thinking → running → thinking → idle", () => {
    const t = session();
    const status = (): string | undefined => t.ws.sessions[0]?.status;
    expect(status()).toBe("idle");
    t.do({ kind: "prompt", text: "Modélise la commande" }, "agent", "s1");
    expect(status()).toBe("thinking");
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(t.ws.sessions[0]).toMatchObject({ status: "running", statusDetail: "Bash bun test" });
    t.do({ kind: "tool-finish", call: "c1", ok: false }, "agent", "s1");
    expect(status()).toBe("thinking");
    expect(t.ws.sessions[0]?.turns[0]?.tools[0]?.status).toBe("failed");
    t.do({ kind: "turn-end" }, "agent", "s1");
    expect(status()).toBe("idle");
    expect(t.ws.sessions[0]?.turns[0]?.ended).toBe(true);
  });

  test("a notification means the agent waits for the human", () => {
    const t = session();
    t.do({ kind: "notify", message: "Claude needs your permission to use Bash" }, "agent", "s1");
    expect(t.ws.sessions[0]).toMatchObject({
      status: "waiting",
      statusDetail: "Claude needs your permission to use Bash",
    });
  });

  test("a tool with no prompt before it opens a turn of its own", () => {
    const t = session();
    t.do({ kind: "tool-start", call: "c1", tool: "Read", summary: "README.md" }, "agent", "s1");
    expect(t.ws.sessions[0]?.turns).toHaveLength(1);
    expect(t.ws.sessions[0]?.turns[0]).toMatchObject({ prompt: "", ended: false });
  });

  test("a tool still running when the turn ends is closed", () => {
    const t = session();
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "sleep" }, "agent", "s1");
    t.do({ kind: "turn-end" }, "agent", "s1");
    expect(t.ws.sessions[0]?.turns[0]?.tools[0]?.status).toBe("ok");
  });

  test("a session that ends is no longer one to hand over to, until it is resumed", () => {
    const t = session();
    t.do({ kind: "prompt", text: "go" }, "agent", "s1");
    t.do({ kind: "session-end" }, "agent", "s1");
    expect(t.ws.sessions[0]?.status).toBe("ended");
    expect(t.ws.sessions[0]?.turns[0]?.ended).toBe(true);
    t.do({ kind: "session-start", cwd: "/repo" }, "agent", "s1");
    expect(t.ws.sessions[0]?.status).toBe("idle");
  });

  test("the latest session is the one that acted last", () => {
    const t = session();
    t.do({ kind: "session-start" }, "agent", "s2");
    t.do({ kind: "prompt", text: "encore" }, "agent", "s1");
    expect(latestSession(t.ws)?.id).toBe("s1");
  });

  test("the delivery cursor only moves forward", () => {
    const t = session();
    t.do({ kind: "delivered", upTo: 12 }, "system", "s1");
    t.do({ kind: "delivered", upTo: 5 }, "system", "s1");
    expect(t.ws.sessions[0]?.deliveredUpTo).toBe(12);
  });
});
