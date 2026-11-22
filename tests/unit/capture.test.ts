import { describe, expect, test } from "bun:test";
import { captureCommands, captureDiagrams, parseFlowchart } from "../../src/domain/capture.ts";
import { describeBoard } from "../../src/domain/digest.ts";
import { toMermaid } from "../../src/domain/export/mermaid.ts";
import { FLOW, Table, table } from "../support.ts";

const REPLY = `
Voici le parcours :

\`\`\`mermaid
flowchart TD
  A[Recevoir la commande] --> B{En stock ?}
  B -->|oui| C([Expédier])
  B -- non --> D[Commander<br/>au fournisseur]
  D -. à réception .-> B
  %% un commentaire
  classDef x fill:#fff
\`\`\`

Et un autre bloc qui n'est pas un flowchart :

\`\`\`mermaid
sequenceDiagram
  A->>B: hello
\`\`\`

\`\`\`ts
const notMermaid = "flowchart TD";
\`\`\`
`;

describe("reading a reply", () => {
  const diagrams = captureDiagrams(REPLY);

  test("only the flowcharts are lifted", () => {
    expect(diagrams).toHaveLength(1);
  });

  test("nodes keep their label and their shape becomes a type", () => {
    expect(diagrams[0]?.nodes).toEqual([
      { key: "A", label: "Recevoir la commande", type: "step" },
      { key: "B", label: "En stock ?", type: "decision" },
      { key: "C", label: "Expédier", type: "outcome" },
      { key: "D", label: "Commander au fournisseur", type: "step" },
    ]);
  });

  test("arrows keep their label, in all three spellings", () => {
    expect(diagrams[0]?.edges).toEqual([
      { src: "A", dst: "B", label: undefined },
      { src: "B", dst: "C", label: "oui" },
      { src: "B", dst: "D", label: "non" },
      { src: "D", dst: "B", label: "à réception" },
    ]);
  });
});

describe("parseFlowchart", () => {
  test("a chain on one line and statements separated by semicolons", () => {
    const d = parseFlowchart("graph LR\n  A --> B --> C; C --> A");
    expect(d?.nodes.map((n) => n.key)).toEqual(["A", "B", "C"]);
    expect(d?.edges.map((e) => `${e.src}>${e.dst}`)).toEqual(["A>B", "B>C", "C>A"]);
  });

  test("a node defined after it was first mentioned gets its label", () => {
    const d = parseFlowchart('flowchart TD\n  A --> B\n  B["Second, with a "quote""]\n  A("Premier")');
    expect(d?.nodes).toEqual([
      { key: "A", label: "Premier", type: "step" },
      { key: "B", label: 'Second, with a "quote"', type: "step" },
    ]);
  });

  test("subgraphs and styling lines are skipped, their nodes kept", () => {
    const d = parseFlowchart(
      "flowchart TD\n  subgraph one [Un]\n    A --> B\n  end\n  style A fill:#f00\n  click A href x",
    );
    expect(d?.nodes.map((n) => n.key)).toEqual(["A", "B"]);
  });

  test("what is not a flowchart, or is empty, or is huge, is not captured", () => {
    expect(parseFlowchart("pie\n  title x")).toBeUndefined();
    expect(parseFlowchart("flowchart TD")).toBeUndefined();
    expect(parseFlowchart("")).toBeUndefined();
    const huge = `flowchart TD\n${Array.from({ length: 61 }, (_, i) => `  N${i}[n]`).join("\n")}`;
    expect(parseFlowchart(huge)).toBeUndefined();
  });

  test("the same source has the same hash; another source another one", () => {
    const a = parseFlowchart("flowchart TD\n  A --> B");
    expect(parseFlowchart("  flowchart TD\n  A --> B\n")?.hash).toBe(a?.hash ?? "");
    expect(parseFlowchart("flowchart TD\n  A --> C")?.hash).not.toBe(a?.hash);
    expect(a?.hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("captureCommands", () => {
  const diagram = captureDiagrams(REPLY)[0];
  if (!diagram) throw new Error("the reply has a diagram");
  const play = (): Table => {
    const t = new Table();
    for (const command of captureCommands(diagram, "Capture")) t.do(command);
    return t;
  };

  test("build an editable Flux board named after the diagram", () => {
    const board = play().board();
    expect(board).toMatchObject({ id: `capture-${diagram.hash}`, format: "flow", title: "Capture" });
    expect(describeBoard(board).split("\n").slice(1)).toEqual([
      "elements",
      '  F1 step "Recevoir la commande"',
      '  D1 decision "En stock ?"',
      '  O1 outcome "Expédier"',
      '  F2 step "Commander au fournisseur"',
      "links",
      "  F1 -> D1",
      '  D1 -> O1 "oui"',
      '  D1 -> F2 "non"',
      '  F2 -> D1 "à réception"',
    ]);
  });

  test("a capture takes the next ids of the project, never one another board holds", () => {
    const t = table(FLOW);
    for (const command of captureCommands(diagram, "Capture")) t.do(command);
    expect(t.board().elements.map((e) => e.id)).toEqual(["F4", "D2", "O2", "F5"]);
    expect(t.board().edges.map((e) => `${e.src}->${e.dst}`)).toEqual([
      "F4->D2",
      "D2->O2",
      "D2->F5",
      "F5->D2",
    ]);
  });

  test("capturing the same diagram twice is refused as a whole", () => {
    const t = play();
    expect(() => {
      for (const command of captureCommands(diagram, "Capture")) t.do(command);
    }).toThrow("already exists");
  });
});

test("a board exported to Mermaid and captured back has the same elements and links", () => {
  const original = table(FLOW).board();
  const diagram = parseFlowchart(toMermaid(original));
  expect(diagram?.nodes.map((n) => `${n.key}:${n.type}:${n.label}`)).toEqual(
    original.elements.map((e) => `${e.id}:${e.type}:${e.label}`),
  );
  expect(diagram?.edges).toEqual(original.edges.map((e) => ({ src: e.src, dst: e.dst, label: e.label })));
});
