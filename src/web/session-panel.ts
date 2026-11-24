/**
 * What Claude's session does, in the right panel: its status, its tasks, and
 * each turn with the tools it ran. Out of main.ts (T171).
 */
import type { Status } from "./agent-status.ts";
import { h, region } from "./dom.ts";
import { t } from "./locale.ts";

/** It scrolls on its own, to its latest step. */
export const sessionPanel = h("section", {
  class: "session",
  id: "tab-session-panel",
  role: "tabpanel",
  "aria-labelledby": "tab-session",
});

interface SessionModel {
  status: Status;
  todos: { text: string; status: string }[];
  turns: {
    at: string;
    prompt: string;
    hidden: number;
    tools: { tool: string; summary: string; status: string }[];
  }[];
}

const TOOL_MARK: Record<string, string> = { ok: "✓", failed: "✗", running: "…" };
const TODO_MARK: Record<string, string> = { completed: "☑", in_progress: "◐", pending: "☐" };

export const paintSession = region(sessionPanel, (m: SessionModel) => [
  h(
    "p",
    { class: `session-status tone-${m.status.tone}`, title: m.status.title },
    m.status.text,
    m.status.title && h("span", { class: "said-only" }, ` ${m.status.title}`),
  ),
  m.todos.length > 0 &&
    h(
      "ul",
      { class: "todos" },
      ...m.todos.map((todo) =>
        h(
          "li",
          { class: `todo-${todo.status}` },
          h("span", { "aria-hidden": "true" }, TODO_MARK[todo.status] ?? "☐"),
          ` ${todo.text}`,
        ),
      ),
    ),
  h(
    "ol",
    { class: "turns" },
    ...m.turns.map((turn) =>
      h(
        "li",
        {},
        h("p", { class: "prompt" }, h("time", {}, turn.at), ` ${turn.prompt || t.turnInProgress}`),
        h(
          "ul",
          { class: "tools" },
          turn.hidden > 0 && h("li", { class: "more" }, t.earlierSteps(turn.hidden)),
          ...turn.tools.map((tool) =>
            h(
              "li",
              { class: `tool-${tool.status}` },
              h("span", { class: "mark", "aria-label": tool.status }, TOOL_MARK[tool.status] ?? ""),
              h("b", {}, tool.tool),
              ` ${tool.summary}`,
            ),
          ),
        ),
      ),
    ),
  ),
  m.turns.length === 0 && h("p", { class: "hint" }, t.sessionHint),
]);
