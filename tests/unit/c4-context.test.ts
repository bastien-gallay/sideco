/**
 * C4, level 1: who uses the system, and what it depends on. Persons, the
 * system, the systems outside it, and labelled links, drawn top-down on the
 * graph layout of a flow, and exported in Mermaid's own C4 notation.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard } from "../../src/domain/digest.ts";
import { toMermaid } from "../../src/domain/export/mermaid.ts";
import { findFormat } from "../../src/domain/formats.ts";
import { along, labelBox } from "../../src/domain/layout/connector-labels.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { connectorMarkup } from "../../src/domain/render/svg.ts";
import { table } from "../support.ts";

const SHOP = `
board new "Boutique" --format c4-context --id boutique
add person "Client"
detail P1 "Achète en ligne"
add system "Boutique" --from P1 --edge "passe commande"
detail Y1 "Catalogue, panier, paiement"
add external "Stripe" --from Y1 --edge "encaisse via"
add external "Brevo" --from Y1 --edge "envoie les mails via"
`;

describe("a C4 system context", () => {
  test("has persons, the system and external systems, on the graph layout", () => {
    const format = findFormat("c4-context");
    expect(format?.layout).toBe("graph");
    expect(format?.types.map((t) => [t.id, t.prefix])).toEqual([
      ["person", "P"],
      ["system", "Y"],
      ["external", "X"],
    ]);
    expect(
      table(SHOP)
        .board()
        .elements.map((e) => e.id),
    ).toEqual(["P1", "Y1", "X1", "X2"]);
  });

  test("ranks the person above the system, and the system above what it depends on", () => {
    const cards = layoutBoard(table(SHOP).board()).cards;
    const y = (id: string): number => cards.find((c) => c.id === id)?.y ?? Number.NaN;
    expect(y("P1")).toBeLessThan(y("Y1"));
    expect(y("Y1")).toBeLessThan(y("X1"));
    expect(y("X1")).toBe(y("X2"));
  });

  test("exports to Mermaid's C4 notation: the detail is the description, links say what they do", () => {
    expect(toMermaid(table(SHOP).board())).toBe(
      [
        "C4Context",
        "  title Boutique",
        '  Person(P1, "Client", "Achète en ligne")',
        '  System(Y1, "Boutique", "Catalogue, panier, paiement")',
        '  System_Ext(X1, "Stripe")',
        '  System_Ext(X2, "Brevo")',
        '  Rel(P1, Y1, "passe commande")',
        '  Rel(Y1, X1, "encaisse via")',
        '  Rel(Y1, X2, "envoie les mails via")',
      ].join("\n"),
    );
  });

  test("a quote in a name does not end the Mermaid string; a link without a label still relates", () => {
    const t = table(SHOP).script('add external "Le \\"vieux\\" ERP"\nlink P1 X3');
    const out = toMermaid(t.board());
    expect(out).toContain(`System_Ext(X3, "Le 'vieux' ERP")`);
    expect(out).toContain('Rel(P1, X3, "")');
  });

  test("the agent reads the elements and the links as on a flow", () => {
    const said = describeBoard(table(SHOP).board());
    expect(said).toContain('P1 person "Client"');
    expect(said).toContain('Y1 -> X1 "encaisse via"');
  });
});

/** c4-system as it stood on 2026-11-22, when its links were found tangled (T203). */
const SYSTEM = `
board new "C4 System" --format c4-context --id sys
add person "Développeur"
detail P1 "Modélise avec Claude : décrit dans le terminal, dessine et corrige dans la page, passe la main."
add person "Coéquipier"
detail P2 "Partage les tableaux par git : le journal est versionné avec le code. Pas encore de synchronisation en direct (S87, S88)."
add system "Sideco"
detail Y1 "Compagnon local d'un projet : journal d'événements (.sideco/boards.jsonl), serveur hub, page web, CLI et hooks."
add external "Claude Code"
detail X1 "La session de l'agent dans le terminal. Charge le plugin sideco : skill, hooks, commande bin/sideco."
add external "Navigateur"
detail X2 "Affiche la page du compagnon (127.0.0.1) et reçoit le direct ; sideco url l'ouvre."
add external "Dépôt git"
detail X3 "Porte le dossier .sideco/ avec le code : historique, branches, partage."
add external "Documentation"
detail X4 "README, PR, wiki : là où vont les exports markdown, mermaid, html, svg."
link P1 X1 "travaille avec, dans le terminal"
link P1 X2 "dessine et lit les tableaux"
link X2 Y1 "page et direct (HTTP, flux)"
link X1 Y1 "lit et écrit par la CLI ; hooks de session et de passage de main"
link Y1 X1 "remet les changements de l'utilisateur au prompt suivant"
link Y1 X3 "journal .sideco/ versionné"
link P2 X3 "pull / push du journal"
link Y1 X4 "exporte md, mermaid, html, svg"
`;

type Stretch = readonly [number, number, number, number];

/** The straight stretches of a path of M, H and V. */
function stretches(d: string): Stretch[] {
  const tokens = d.match(/[MHV]|-?\d*\.?\d+/g) ?? [];
  const out: Stretch[] = [];
  let [x, y, k] = [0, 0, 0];
  while (k < tokens.length) {
    const cmd = tokens[k++];
    const n = Number(tokens[k++]);
    if (cmd === "M") {
      x = n;
      y = Number(tokens[k++]);
    } else if (cmd === "H") {
      out.push([x, y, n, y]);
      x = n;
    } else if (cmd === "V") {
      out.push([x, y, x, n]);
      y = n;
    }
  }
  return out;
}

const span = (a: number, b: number): readonly [number, number] => [Math.min(a, b), Math.max(a, b)];

describe("the links of a C4 context (T203)", () => {
  const scene = layoutBoard(table(SYSTEM).board(), "fr");

  test("no link runs under a card it does not join", () => {
    const under = scene.connectors.flatMap((c) =>
      scene.cards
        .filter((k) => k.id !== c.src && k.id !== c.dst)
        .filter((k) =>
          stretches(c.d).some(([x1, y1, x2, y2]) => {
            const [left, right] = span(x1, x2);
            const [top, bottom] = span(y1, y2);
            return left < k.x + k.w && right > k.x && top < k.y + k.h && bottom > k.y;
          }),
        )
        .map((k) => `${c.src}->${c.dst} under ${k.id}`),
    );
    expect(under).toEqual([]);
  });

  test("two links that share no end never run along the same line", () => {
    const shared: string[] = [];
    for (const [i, a] of scene.connectors.entries())
      for (const b of scene.connectors.slice(i + 1)) {
        if (a.src === b.src || a.dst === b.dst) continue;
        for (const p of stretches(a.d))
          for (const q of stretches(b.d)) {
            const level = p[1] === p[3] && q[1] === q[3] && p[1] === q[1];
            const upright = p[0] === p[2] && q[0] === q[2] && p[0] === q[0];
            const [pa, pb] = level ? span(p[0], p[2]) : span(p[1], p[3]);
            const [qa, qb] = level ? span(q[0], q[2]) : span(q[1], q[3]);
            if ((level || upright) && Math.min(pb, qb) - Math.max(pa, qa) > 0)
              shared.push(`${a.src}->${a.dst} on ${b.src}->${b.dst}`);
          }
      }
    expect(shared).toEqual([]);
  });

  test("every name is written, and none over another link's line", () => {
    const named = scene.connectors.filter((c) => c.label);
    expect(named.filter((c) => c.unwritten).map((c) => c.label)).toEqual([]);
    const over = named.flatMap((c) => {
      const box = labelBox(c.label ?? "", c.labelX, c.labelY);
      return scene.connectors
        .filter((o) => o !== c)
        .filter((o) =>
          along(o.d).some(([x, y]) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h),
        )
        .map((o) => `${c.src}->${c.dst} over ${o.src}->${o.dst}`);
    });
    expect(over).toEqual([]);
  });

  test("a long name takes two lines of about 28 characters at most; the link says it whole on hover", () => {
    const long = scene.connectors.find((c) => c.src === "X1" && c.dst === "Y1");
    if (!long) throw new Error("no link X1 -> Y1");
    const markup = connectorMarkup(long);
    const lines = [...markup.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1] ?? "");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(28);
    expect(lines[1]).toEndWith("…");
    expect(markup).toContain(
      "<title>lit et écrit par la CLI ; hooks de session et de passage de main</title>",
    );
  });
});
