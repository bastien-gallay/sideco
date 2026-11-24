/**
 * How many functions of each module of src/ go over each function limit of
 * docs/coding-standards.md, written as data so that a test can hold the code to
 * it: a count may come down, never go up. A module left out has none allowed.
 */

type Limit = "lines" | "complexity" | "nesting";

type Counts = Record<string, Partial<Record<Limit, number>>>;

const RULES: Record<string, Limit> = {
  "lint/complexity/noExcessiveLinesPerFunction": "lines",
  "lint/complexity/noExcessiveCognitiveComplexity": "complexity",
  "lint/nursery/noExcessiveNestedBlocks": "nesting",
};

const BROKEN_BY: Record<Limit, string> = {
  lines: "made longer",
  complexity: "made more complex",
  nesting: "nested deeper",
};

/** Counted on 2026-11-22; lower a count when a change brings a module under it. */
export const FUNCTION_LIMITS: Counts = {
  "src/cli/argv.ts": { lines: 2, complexity: 2 },
  "src/cli/hook.ts": { lines: 1, complexity: 1 },
  "src/cli/main.ts": { complexity: 1, lines: 1 },
  "src/domain/capture.ts": { complexity: 1 },
  "src/domain/commands.ts": { lines: 1 },
  "src/domain/decide.ts": { complexity: 1, lines: 1 },
  "src/domain/describe.ts": { lines: 1, complexity: 1, nesting: 1 },
  "src/domain/digest.ts": { lines: 2, complexity: 2, nesting: 4 },
  "src/domain/export/markdown.ts": { complexity: 1, lines: 1 },
  "src/domain/export/mermaid.ts": { complexity: 1 },
  "src/domain/export/model.ts": { complexity: 1, lines: 1 },
  "src/domain/find.ts": { complexity: 1 },
  "src/domain/layout/columns.ts": { lines: 1 },
  "src/domain/layout/connector-labels.ts": { complexity: 1 },
  "src/domain/layout/index.ts": { complexity: 1 },
  "src/domain/layout/scene.ts": { complexity: 1 },
  "src/domain/layout/timeline.ts": { lines: 1 },
  "src/domain/project-digest.ts": { complexity: 1 },
  "src/domain/reverse.ts": { complexity: 1 },
  "src/domain/session-decide.ts": { complexity: 1, lines: 1 },
  "src/domain/sessions.ts": { lines: 1 },
  "src/domain/undo.ts": { lines: 3, complexity: 1 },
  "src/domain/workspace.ts": { complexity: 1, lines: 1 },
  "src/server/http.ts": { complexity: 1 },
  "src/web/board-view.ts": { lines: 6, complexity: 10 },
  "src/web/event-words.ts": { complexity: 2, lines: 2 },
  "src/web/main.ts": { complexity: 1, lines: 2 },
  "src/web/markdown.ts": { complexity: 2 },
  "src/web/messages.ts": { lines: 2 },
  "src/web/notices.ts": { lines: 1 },
  "src/web/store.ts": { complexity: 1 },
  "src/web/view.ts": { complexity: 3, lines: 1 },
};

interface Report {
  diagnostics: { category?: string; location?: { path?: string | { file?: string } } }[];
}

/** The functions over each limit, per module, from biome's JSON report. */
export function countOver(report: Report): Counts {
  const counts: Counts = {};
  for (const diagnostic of report.diagnostics) {
    const limit = RULES[diagnostic.category ?? ""];
    const path = diagnostic.location?.path;
    const file = typeof path === "string" ? path : path?.file;
    if (!limit || !file) continue;
    const module = counts[file] ?? {};
    module[limit] = (module[limit] ?? 0) + 1;
    counts[file] = module;
  }
  return counts;
}

/** What differs from the counts allowed: a module over, or one under that should lower its count. */
export function drift(allowed: Counts, counts: Counts): string[] {
  const files = [...new Set([...Object.keys(allowed), ...Object.keys(counts)])].sort();
  return files.flatMap((file) =>
    (Object.values(RULES) as Limit[]).flatMap((limit) => {
      const most = allowed[file]?.[limit] ?? 0;
      const count = counts[file]?.[limit] ?? 0;
      if (count === most) return [];
      const has = `${file} has ${count} function${count === 1 ? "" : "s"} over the ${limit} limit, ${most} allowed`;
      return count > most
        ? [`${has}: split the one you ${BROKEN_BY[limit]}`]
        : [`${has}: lower it to ${count} in tests/function-limits.ts`];
    }),
  );
}
