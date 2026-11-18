import { describe, expect, test } from "bun:test";
import { agentStatus, describeEvent, handOverHint, pendingCount, recentTurns } from "../../src/web/view.ts";
import { KANBAN, ORDERING, type Table, table } from "../support.ts";

function withSession(script = ORDERING): Table {
  const t = table(script);
  t.do({ kind: "session-start", cwd: "/repo" }, "agent", "s1");
  return t;
}
const session = (t: Table): Table["ws"]["sessions"][number] | undefined => t.ws.sessions[0];

describe("agentStatus says what Claude is doing, in words", () => {
  test("no session linked yet", () => {
    expect(agentStatus(undefined, 0)).toEqual({ tone: "off", text: "Aucune session Claude Code reliée" });
  });

  test("at rest, thinking, running a tool, waiting in the terminal", () => {
    const t = withSession();
    expect(agentStatus(session(t), 0)).toEqual({ tone: "idle", text: "Claude est au repos" });
    t.do({ kind: "prompt", text: "go" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({ tone: "busy", text: "Claude réfléchit" });
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({ tone: "busy", text: "Claude exécute Bash bun test" });
    t.do({ kind: "notify", message: "Claude needs your permission to use Bash" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({
      tone: "waiting",
      text: "Claude t'attend dans le terminal : Claude needs your permission to use Bash",
    });
  });

  test("listening wins: an agent blocked on the board waits for the hand-over", () => {
    const t = withSession();
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "vico wait" }, "agent", "s1");
    expect(agentStatus(session(t), 1)).toEqual({
      tone: "listening",
      text: "Claude attend que tu lui passes la main",
    });
  });
});

test("an agent listening with no session linked (plain `vico wait`) is still shown as listening", () => {
  expect(agentStatus(undefined, 1)).toEqual({
    tone: "listening",
    text: "Claude attend que tu lui passes la main",
  });
});

describe("handOverHint says when Claude will see the changes", () => {
  test("at once when it listens", () => {
    expect(handOverHint("running", 1)).toBe("Claude reprend dès que tu lui passes la main.");
  });
  test("after its current action when it works", () => {
    expect(handOverHint("running", 0)).toBe(
      "Claude travaille : il lira tes changements après son action en cours.",
    );
    expect(handOverHint("thinking", 0)).toBe(
      "Claude travaille : il lira tes changements après son action en cours.",
    );
  });
  test("at the next terminal message when it rests or waits there", () => {
    expect(handOverHint("idle", 0)).toBe(
      "Claude est au repos : il lira tes changements à ton prochain message dans le terminal.",
    );
    expect(handOverHint("waiting", 0)).toBe(
      "Claude est au repos : il lira tes changements à ton prochain message dans le terminal.",
    );
    expect(handOverHint(undefined, 0)).toBe(
      "Aucune session reliée : Claude lira tes changements quand une session démarrera ici.",
    );
  });
});

describe("pendingCount is what Claude has not been told, net of back-and-forth", () => {
  test("counts the human's net changes after the session's cursor", () => {
    const t = withSession();
    expect(pendingCount(t.events, session(t))).toBe(0);
    t.script('rename E1 "Essai"\nrename E1 "Validée"\nrm H1', "human");
    expect(pendingCount(t.events, session(t))).toBe(2);
    t.do({ kind: "delivered", upTo: t.seq }, "system", "s1");
    expect(pendingCount(t.events, session(t))).toBe(0);
  });

  test("with no session, everything the human did is pending", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    expect(pendingCount(t.events, undefined)).toBe(1);
  });
});

describe("describeEvent words one journal line for the history", () => {
  const line = (t: Table, index = -1): string => {
    const event = t.events.at(index);
    if (!event) throw new Error("no event");
    return describeEvent(event);
  };

  test("board events name the element and the author", () => {
    const t = table(ORDERING);
    expect(line(t, 0)).toBe("Claude crée le tableau « Passage de commande »");
    expect(line(t, 3)).toBe("Claude ajoute E1 « Commande passée »");
    t.script('rename E1 "Validée"', "human");
    expect(line(t)).toBe("Tu renommes E1 en « Validée »");
    t.script("move E2 --col 3", "human");
    expect(line(t)).toBe("Tu déplaces E2");
    t.script("rm H1", "human");
    expect(line(t)).toBe("Tu supprimes H1");
    t.script("link E2 P1");
    expect(line(t)).toBe("Claude relie E2 → P1");
    t.script('focus E1 --why "ici"');
    expect(line(t)).toBe("Claude met le focus sur E1 : ici");
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    expect(line(t)).toBe("Tu notes sur P1 : Qui réserve ?");
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    expect(line(t)).toBe("Tu passes la main à Claude");
    t.script('pass "à toi"');
    expect(line(t)).toBe("Claude te passe la main : à toi");
  });

  test("a removed board is named by its title", () => {
    const t = table(ORDERING).script("board rm commande", "human");
    expect(line(t)).toBe("Tu supprimes le tableau « Passage de commande »");
  });

  test("session events tell the terminal's story", () => {
    const t = withSession();
    expect(line(t)).toBe("Session démarrée");
    t.do({ kind: "prompt", text: "Modélise la commande\nen détail" }, "agent", "s1");
    expect(line(t)).toBe("Prompt : Modélise la commande en détail");
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(line(t)).toBe("Claude lance Bash bun test");
    t.do({ kind: "tool-finish", call: "c1", ok: false }, "agent", "s1");
    expect(line(t)).toBe("Outil en échec");
    t.do({ kind: "turn-end" }, "agent", "s1");
    expect(line(t)).toBe("Claude a fini son tour");
    t.do({ kind: "delivered", upTo: 3 }, "system", "s1");
    expect(line(t)).toBe("Claude a lu tes changements");
  });

  test("every event of a real journal has a wording, short enough for one line", () => {
    const t = withSession(ORDERING)
      .script(KANBAN)
      .script(
        "move T3 --lane doing\ninsert-col 1 --board commande\nunlink C1 E1 --board commande\nresolve N1 --board commande".replace(
          "resolve N1 --board commande",
          "focus --board sprint",
        ),
        "human",
      );
    for (const event of t.events) {
      const text = describeEvent(event);
      expect(text).not.toBe("");
      expect(text.length).toBeLessThanOrEqual(90);
      expect(text).not.toContain("\n");
    }
  });
});

test("recentTurns keeps the last turns, oldest first, so the newest sits by the status", () => {
  const t = withSession();
  for (const text of ["un", "deux", "trois", "quatre"]) t.do({ kind: "prompt", text }, "agent", "s1");
  expect(recentTurns(session(t), 3).map((turn) => turn.prompt)).toEqual(["deux", "trois", "quatre"]);
  expect(recentTurns(undefined, 3)).toEqual([]);
});
