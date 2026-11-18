import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replay } from "../../src/domain/workspace.ts";
import { Hub } from "../../src/server/hub.ts";
import { openJournal } from "../../src/server/journal.ts";
import { ORDERING, table } from "../support.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vico-journal-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lines = (file: string): unknown[] =>
  readFileSync(join(dir, file), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

function mixed(): ReturnType<typeof table> {
  const t = table();
  t.do({ kind: "session-start", cwd: "/repo" }, "agent", "s1");
  t.do({ kind: "prompt", text: "Modélise la commande" }, "agent", "s1");
  t.script(ORDERING);
  t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
  t.do({ kind: "rename", board: "commande", id: "E1", label: "Validée" }, "human");
  return t;
}

describe("the journal on disk", () => {
  test("design history and session trace go to separate files", () => {
    const t = mixed();
    openJournal(dir).append(t.events);
    const boards = lines("boards.jsonl") as { event: string }[];
    const sessions = lines("sessions.jsonl") as { event: string }[];
    expect(boards.length + sessions.length).toBe(t.events.length);
    expect(sessions.map((e) => e.event)).toEqual(["SessionStarted", "PromptSubmitted", "ToolStarted"]);
    expect(JSON.stringify(boards)).not.toContain("Modélise la commande");
    expect(JSON.stringify(boards)).not.toContain("bun test");
  });

  test("loading merges the two files back into one order", () => {
    const t = mixed();
    const journal = openJournal(dir);
    journal.append(t.events);
    expect(journal.load()).toEqual(JSON.parse(JSON.stringify(t.events)));
    expect(replay(journal.load())).toEqual(JSON.parse(JSON.stringify(t.ws)));
  });

  test("appending adds lines and never rewrites the ones before", () => {
    const t = mixed();
    const journal = openJournal(dir);
    journal.append(t.events.slice(0, 5));
    const first = readFileSync(join(dir, "boards.jsonl"), "utf8");
    journal.append(t.events.slice(5));
    expect(readFileSync(join(dir, "boards.jsonl"), "utf8").startsWith(first)).toBe(true);
    expect(journal.load()).toHaveLength(t.events.length);
  });

  test("an empty workspace has no files, and appending nothing creates none", () => {
    const journal = openJournal(join(dir, "fresh"));
    expect(journal.load()).toEqual([]);
    journal.append([]);
    expect(existsSync(join(dir, "fresh"))).toBe(false);
  });

  test("a line from a newer build is left out of the projection and stays in the file", () => {
    const journal = openJournal(dir);
    journal.append(table(ORDERING).events);
    const future = '{"seq":99,"ts":"t","actor":"agent","event":"BoardArchived","board":"commande"}\n';
    appendFileSync(join(dir, "boards.jsonl"), `${future}\n   \n42\n`);
    expect(journal.load().some((e) => e.seq === 99)).toBe(false);
    expect(readFileSync(join(dir, "boards.jsonl"), "utf8")).toContain("BoardArchived");
  });

  test("a damaged line stops the load and names the file and the line", () => {
    writeFileSync(
      join(dir, "boards.jsonl"),
      '{"seq":1,"ts":"t","actor":"agent","event":"BoardCreated","board":"b","title":"B","format":"flow"}\n{"seq":2,"ts"\n',
    );
    expect(() => openJournal(dir).load()).toThrow(`${join(dir, "boards.jsonl")}:2 is not valid JSON`);
  });

  test("a hub restarted on the same directory carries on from the last sequence number", () => {
    const first = new Hub(openJournal(dir));
    first.dispatch([{ kind: "create-board", board: "b", title: "B", format: "flow" }], { actor: "agent" });
    first.dispatch([{ kind: "prompt", text: "hello" }], { actor: "agent", session: "s1" });
    const second = new Hub(openJournal(dir));
    expect(second.workspace).toEqual(JSON.parse(JSON.stringify(first.workspace)));
    const done = second.dispatch([{ kind: "add", board: "b", type: "step", label: "A" }], { actor: "human" });
    expect(done.events[0]?.seq).toBe(3);
  });
});
