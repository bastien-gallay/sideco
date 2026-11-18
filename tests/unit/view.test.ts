import { describe, expect, test } from "bun:test";
import { LOCALES } from "../../src/domain/i18n.ts";
import { MESSAGES, pickLocale } from "../../src/web/messages.ts";
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
    expect(agentStatus(undefined, 0)).toEqual({ tone: "off", text: "No Claude Code session linked" });
  });

  test("at rest, thinking, running a tool, waiting in the terminal", () => {
    const t = withSession();
    expect(agentStatus(session(t), 0)).toEqual({ tone: "idle", text: "Claude is idle" });
    t.do({ kind: "prompt", text: "go" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({ tone: "busy", text: "Claude is thinking" });
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({ tone: "busy", text: "Claude is running Bash bun test" });
    t.do({ kind: "notify", message: "Claude needs your permission to use Bash" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({
      tone: "waiting",
      text: "Claude is waiting for you in the terminal: Claude needs your permission to use Bash",
    });
  });

  test("listening wins: an agent blocked on the board waits for the hand-over", () => {
    const t = withSession();
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "vico wait" }, "agent", "s1");
    expect(agentStatus(session(t), 1)).toEqual({
      tone: "listening",
      text: "Claude is waiting for you to hand over",
    });
  });
});

test("an agent listening with no session linked (plain `vico wait`) is still shown as listening", () => {
  expect(agentStatus(undefined, 1)).toEqual({
    tone: "listening",
    text: "Claude is waiting for you to hand over",
  });
});

describe("handOverHint says when Claude will see the changes", () => {
  test("at once when it listens", () => {
    expect(handOverHint("running", 1)).toBe("Claude resumes as soon as you hand over.");
  });
  test("after its current action when it works", () => {
    expect(handOverHint("running", 0)).toBe(
      "Claude is working: it will read your changes after its current action.",
    );
    expect(handOverHint("thinking", 0)).toBe(
      "Claude is working: it will read your changes after its current action.",
    );
  });
  test("at the next terminal message when it rests or waits there", () => {
    expect(handOverHint("idle", 0)).toBe(
      "Claude is idle: it will read your changes at your next message in the terminal.",
    );
    expect(handOverHint("waiting", 0)).toBe(
      "Claude is idle: it will read your changes at your next message in the terminal.",
    );
    expect(handOverHint(undefined, 0)).toBe(
      "No session linked: Claude will read your changes when a session starts here.",
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
    expect(line(t, 0)).toBe("Claude creates the board “Passage de commande”");
    expect(line(t, 3)).toBe("Claude adds E1 “Commande passée”");
    t.script('rename E1 "Validée"', "human");
    expect(line(t)).toBe("You rename E1 to “Validée”");
    t.script("move E2 --col 3", "human");
    expect(line(t)).toBe("You move E2");
    t.script("rm H1", "human");
    expect(line(t)).toBe("You remove H1");
    t.script("link E2 P1");
    expect(line(t)).toBe("Claude links E2 → P1");
    t.script('focus E1 --why "ici"');
    expect(line(t)).toBe("Claude puts the focus on E1: ici");
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    expect(line(t)).toBe("You note on P1: Qui réserve ?");
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    expect(line(t)).toBe("You hand over to Claude");
    t.script('pass "à toi"');
    expect(line(t)).toBe("Claude hands over to you: à toi");
  });

  test("a removed board is named by its title", () => {
    const t = table(ORDERING).script("board rm commande", "human");
    expect(line(t)).toBe("You remove the board “Passage de commande”");
  });

  test("session events tell the terminal's story", () => {
    const t = withSession();
    expect(line(t)).toBe("Session started");
    t.do({ kind: "prompt", text: "Modélise la commande\nen détail" }, "agent", "s1");
    expect(line(t)).toBe("Prompt: Modélise la commande en détail");
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(line(t)).toBe("Claude runs Bash bun test");
    t.do({ kind: "tool-finish", call: "c1", ok: false }, "agent", "s1");
    expect(line(t)).toBe("Tool failed");
    t.do({ kind: "turn-end" }, "agent", "s1");
    expect(line(t)).toBe("Claude ended its turn");
    t.do({ kind: "delivered", upTo: 3 }, "system", "s1");
    expect(line(t)).toBe("Claude read your changes");
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
      for (const locale of LOCALES) {
        const text = describeEvent(event, locale);
        expect(text).not.toBe("");
        expect(text.length).toBeLessThanOrEqual(90);
        expect(text).not.toContain("\n");
      }
    }
  });
});

test("recentTurns keeps the last turns, oldest first, so the newest sits by the status", () => {
  const t = withSession();
  for (const text of ["un", "deux", "trois", "quatre"]) t.do({ kind: "prompt", text }, "agent", "s1");
  expect(recentTurns(session(t), 3).map((turn) => turn.prompt)).toEqual(["deux", "trois", "quatre"]);
  expect(recentTurns(undefined, 3)).toEqual([]);
});

describe("in French, when the reader asks for it", () => {
  test("the status and the hand-over hint", () => {
    const t = withSession();
    expect(agentStatus(undefined, 0, "fr").text).toBe("Aucune session Claude Code reliée");
    expect(agentStatus(session(t), 0, "fr").text).toBe("Claude est au repos");
    expect(agentStatus(session(t), 1, "fr").text).toBe("Claude attend que tu lui passes la main");
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(agentStatus(session(t), 0, "fr").text).toBe("Claude exécute Bash bun test");
    expect(handOverHint("running", 0, "fr")).toBe(
      "Claude travaille : il lira tes changements après son action en cours.",
    );
  });

  test("the history lines", () => {
    const t = table(ORDERING);
    const line = (): string => describeEvent(t.events.at(-1) as never, "fr");
    expect(describeEvent(t.events[0] as never, "fr")).toBe("Claude crée le tableau « Passage de commande »");
    t.script('rename E1 "Validée"', "human");
    expect(line()).toBe("Tu renommes E1 en « Validée »");
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    expect(line()).toBe("Tu passes la main à Claude");
    t.script('pass "à toi"');
    expect(line()).toBe("Claude te passe la main : à toi");
  });
});

describe("the page's own words", () => {
  test("count in the reader's language", () => {
    expect(MESSAGES.en.pending(1)).toBe("1 change Claude has not read");
    expect(MESSAGES.en.pending(3)).toBe("3 changes Claude has not read");
    expect(MESSAGES.fr.pending(1)).toBe("1 changement que Claude n'a pas lu");
    expect(MESSAGES.fr.pending(3)).toBe("3 changements que Claude n'a pas lus");
    expect(MESSAGES.en.live(1)).toBe("Live · 1 event");
    expect(MESSAGES.fr.live(2)).toBe("En direct · 2 événements");
    expect(MESSAGES.en.handOver).toBe("Hand over to Claude");
    expect(MESSAGES.fr.handOver).toBe("Passer la main à Claude");
  });

  test("the language is the reader's choice, then the companion's, then English", () => {
    expect(pickLocale("fr", "en")).toBe("fr");
    expect(pickLocale("en", "fr")).toBe("en");
    expect(pickLocale(null, "fr")).toBe("fr");
    expect(pickLocale("klingon", "fr-FR")).toBe("fr");
    expect(pickLocale(null, "")).toBe("en");
    expect(pickLocale(undefined, undefined)).toBe("en");
  });
});
