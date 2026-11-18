import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeBoard } from "../../src/domain/digest.ts";
import { toHtml, toIndexHtml } from "../../src/domain/export/html.ts";
import { EXPORT_FORMATS, exportBoard } from "../../src/domain/export/index.ts";
import { toMarkdown } from "../../src/domain/export/markdown.ts";
import { toMermaid } from "../../src/domain/export/mermaid.ts";
import { fromModel, toModel } from "../../src/domain/export/model.ts";
import { FLOW, KANBAN, ORDERING, Table, table } from "../support.ts";

const META = { exportedAt: "2026-11-17T10:00:00.000Z" };

/** Rebuilds a board from its model file on a fresh table. */
function reimport(model: unknown, id = "copy"): Table {
  const t = new Table();
  for (const command of fromModel(model, id)) t.do(command);
  return t;
}

const body = (t: Table): string => describeBoard(t.board()).split("\n").slice(1).join("\n");

describe("mermaid", () => {
  test("a graph becomes a top-down flowchart with the shapes of its types", () => {
    expect(toMermaid(table(FLOW).board()).split("\n")).toEqual([
      "flowchart TD",
      '  S1["Recevoir la commande"]',
      '  D1{"En stock ?"}',
      '  S2["Expédier"]',
      '  S3["Commander au fournisseur"]',
      '  O1(["Livrée"])',
      "  S1 --> D1",
      '  D1 -->|"oui"| S2',
      '  D1 -->|"non"| S3',
      "  S2 --> O1",
      '  S3 -->|"à réception"| D1',
      "  classDef step fill:#E8EEF4,color:#1F2328,stroke:#00000033",
      "  class S1,S2,S3 step",
      "  classDef decision fill:#FFD23F,color:#1F2328,stroke:#00000033",
      "  class D1 decision",
      "  classDef outcome fill:#6FCF97,color:#1F2328,stroke:#00000033",
      "  class O1 outcome",
    ]);
  });

  test("a timeline becomes one subgraph per step, and says what it drops", () => {
    const text = toMermaid(table(ORDERING).board());
    expect(text.startsWith("%% lossy: the order of stickies inside a step is not kept\nflowchart LR")).toBe(
      true,
    );
    expect(text).toContain(
      '  subgraph step2["2"]\n    direction TB\n    P1["Quand commande passée, réserver le stock"]',
    );
    expect(text).toContain("  C1 --> E1");
  });

  test("a kanban keeps its lanes; links are declared lost", () => {
    const text = toMermaid(table(KANBAN).script("link B1 T2").board());
    expect(text.split("\n").slice(0, 4)).toEqual([
      "%% lossy: links between cards are not kept",
      "kanban",
      "  todo[À faire]",
      "    T3[T3 Tester de bout en bout]",
    ]);
  });

  test("quotes and brackets in labels cannot break the diagram", () => {
    const flow = toMermaid(
      table('board new "X" --format flow --id x\nadd step "Dire \\"oui\\" [vite]"').board(),
    );
    expect(flow).toContain('S1["Dire #quot;oui#quot; [vite]"]');
    const kanban = toMermaid(
      table('board new "X" --format kanban --id x\nadd task "Fix [bug] (urgent)"').board(),
    );
    expect(kanban).toContain("T1[T1 Fix bug urgent]");
  });
});

describe("model file", () => {
  test.each([
    ["timeline", ORDERING],
    ["columns", KANBAN],
    ["graph", FLOW],
  ])("a %s board survives the round trip", (_layout, script) => {
    const original = table(script).script(
      `detail ${script === ORDERING ? "E1" : script === KANBAN ? "T1" : "S1"} "Un détail"`,
    );
    const copy = reimport(JSON.parse(JSON.stringify(toModel(original.board()))));
    expect(body(copy)).toBe(body(original));
    expect(copy.board().title).toBe(original.board().title);
  });

  test("the order of cards in a lane survives the round trip: it is the priority", () => {
    const original = table(KANBAN).script(
      "move T4 --lane todo --before T3\nmove T1 --lane doing --before T2",
    );
    const copy = reimport(toModel(original.board()));
    expect(body(copy)).toBe(body(original));
  });

  test("columns count from 0 in the file, as in faceto, and from 1 on the board", () => {
    const model = toModel(table(ORDERING).board());
    expect(model.elements.find((e) => e.id === "E1")?.col).toBe(0);
    expect(
      reimport(model)
        .board()
        .elements.find((e) => e.id === "E1")?.col,
    ).toBe(1);
  });

  test("a faceto model loads as it is", () => {
    const sample: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "fixtures", "faceto.sample.model.json"), "utf8"),
    );
    const elements = (sample as { elements: { id: string }[] }).elements;
    const edges = (sample as { edges: unknown[] }).edges;
    const board = reimport(sample, "faceto").board();
    expect(board.format).toBe("event-storming");
    expect(board.elements.map((e) => e.id).sort()).toEqual(elements.map((e) => e.id).sort());
    expect(board.edges).toHaveLength(edges.length);
  });

  test("edges may be pairs; `external` reads as `system`; unknown fields are ignored", () => {
    const board = reimport({
      title: "Mini",
      phases: ["ignored"],
      elements: [
        { id: "G1", type: "external", label: "Banque", col: 0, links: ["ignored"] },
        { id: "E1", type: "event", label: "Payé", col: 1, resolved: true },
      ],
      edges: [["G1", "E1"]],
    }).board();
    expect(board.elements.map((e) => `${e.id}:${e.type}:${e.col}`)).toEqual(["G1:system:1", "E1:event:2"]);
    expect(board.edges).toMatchObject([{ src: "G1", dst: "E1" }]);
  });

  test("a malformed file is refused with the place of the fault", () => {
    expect(() => fromModel([], "x")).toThrow("a model file is a JSON object");
    expect(() => fromModel({ elements: [{ type: "event" }] }, "x")).toThrow(
      "elements[0] needs a `type` and a `label`",
    );
    expect(() => fromModel({ elements: [], edges: ["E1"] }, "x")).toThrow(
      "an edge is [src, dst] or {src, dst, label}",
    );
  });
});

describe("markdown", () => {
  const t = table(ORDERING).script('detail P1 "Règle | n°4"');
  t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
  t.do({ kind: "note", board: "commande", text: "Vu", target: "E1" }, "human");
  t.script("resolve N2");
  const md = toMarkdown(t.board(), META);

  test("is a design note: title, workshop, diagram, source, tables, open questions", () => {
    expect(md.startsWith("# Passage de commande\n\n> **Event Storming** — ")).toBe(true);
    expect(md).toContain("```mermaid\n%% lossy");
    expect(md).toContain(`Source : journal Vico, tableau \`commande\`, seq ${t.seq}, exporté le 2026-11-17.`);
    expect(md).toContain("| Id | Type | Libellé | Étape | Détail | Par |");
    expect(md).toContain("| E1 | Événement | Commande passée | 1 |  | agent |");
    expect(md).toContain("## Liens\n\n| De | Vers | Libellé |");
    expect(md).toContain("## Questions ouvertes\n\n- ❓ N1 (sur P1), humain : Qui réserve ?");
    expect(md).toContain("## Notes résolues\n\n- ✅ N2 (sur E1), humain : Vu");
  });

  test("a pipe in a cell cannot break the table", () => {
    expect(md).toContain("Règle \\| n°4");
  });

  test("ends with exactly one newline and has no trailing spaces, so linters stay quiet", () => {
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
    expect(md).not.toMatch(/\n{3,}/);
  });

  test("a kanban names its lanes by their label", () => {
    expect(toMarkdown(table(KANBAN).board(), META)).toContain(
      "| T2 | Tâche | Brancher les hooks | En cours |  | agent |",
    );
  });
});

describe("html", () => {
  test("a board page is self-contained: inline SVG, no script, no outside request", () => {
    const html = toHtml(table(ORDERING).board(), META);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg");
    expect(html).toContain("<title>Passage de commande</title>");
    expect(html).not.toMatch(/<script|src="http|href="http/);
  });

  test("the index links every board in every format", () => {
    const html = toIndexHtml(
      "Tableaux",
      [{ id: "commande", title: "Passage <de> commande", format: "event-storming", elements: 7 }],
      META,
    );
    for (const ext of ["html", "md", "svg", "model.json"]) expect(html).toContain(`href="commande.${ext}"`);
    expect(html).toContain("Passage &lt;de&gt; commande");
  });
});

test("every export format produces text that ends with a newline", () => {
  const board = table(FLOW).board();
  for (const format of EXPORT_FORMATS) expect(exportBoard(board, format, META).endsWith("\n")).toBe(true);
});

test("elements without an id get one above the ids the file names, whatever their order", () => {
  const board = reimport({
    title: "Sans ids",
    elements: [
      { type: "event", label: "Sans id, en premier", col: 0 },
      { id: "E1", type: "event", label: "Nommé", col: 1 },
      { type: "event", label: "Sans id, en dernier", col: 2 },
    ],
    edges: [],
  }).board();
  expect(board.elements.map((e) => `${e.id}:${e.col}`)).toEqual(["E2:1", "E1:2", "E3:3"]);
});
