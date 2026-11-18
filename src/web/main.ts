/**
 * The page. One screen: the board in the middle, what you can add on the left,
 * what Claude is doing on the right, time and the hand-over at the bottom.
 * Everything shown is a function of the journal; every gesture sends a command.
 */
import { slugify } from "../domain/commands.ts";
import { EXPORT_FORMATS, EXTENSION, type ExportFormat, exportBoard } from "../domain/export/index.ts";
import { toMermaid } from "../domain/export/mermaid.ts";
import { FORMATS, findFormat } from "../domain/formats.ts";
import { SVG_STYLE } from "../domain/render/svg.ts";
import { findBoard, latestSession } from "../domain/workspace.ts";
import { mountBoard } from "./board-view.ts";
import { clock, h, region } from "./dom.ts";
import {
  changed,
  currentBoard,
  currentSession,
  isLive,
  openBoard,
  send,
  shown,
  start,
  state,
  travelTo,
} from "./store.ts";
import { agentStatus, describeEvent, handOverHint, pendingCount, recentTurns } from "./view.ts";

const TURNS_SHOWN = 4;
const TOOLS_SHOWN = 8;
const EXPORT_LABELS: Record<ExportFormat, string> = {
  md: "Markdown (note de conception)",
  html: "Page HTML autonome",
  svg: "Image SVG",
  mermaid: "Diagramme Mermaid",
  json: "Modèle JSON (réimportable)",
};
const MIME: Record<ExportFormat, string> = {
  md: "text/markdown",
  html: "text/html",
  svg: "image/svg+xml",
  mermaid: "text/plain",
  json: "application/json",
};

const app = document.getElementById("app");
if (!app) throw new Error("the page has no #app");
document.head.prepend(h("style", {}, SVG_STYLE));

// ── Shell, built once ────────────────────────────────────────────────────────

const boardPicker = h("div", { class: "board-picker" });
const statusPill = h("div", { class: "status", role: "status", "aria-live": "polite" });
const zoomLabel = h("span", { class: "zoom-label" }, "100 %");
const exportMenu = h("details", { class: "menu" });
const banner = h("div", { class: "banner", hidden: true });
const palette = h("section", { class: "palette", "aria-label": "Éléments à ajouter" });
const notes = h("section", { class: "notes", "aria-label": "Notes" });
const focusBar = h("div", { class: "focus-bar", hidden: true });
const canvas = h("div", { class: "canvas" });
const empty = h("div", { class: "empty", hidden: true });
const sessionPanel = h("aside", { class: "right", "aria-label": "Session Claude Code" });
const historyLabel = h("output", { class: "history-label" });
const historyRange = h("input", {
  type: "range",
  min: 0,
  max: 0,
  value: 0,
  step: 1,
  "aria-label": "Historique du tableau",
});
const turnBar = h("div", { class: "turn" });
const toast = h("div", { class: "toast", role: "alert", hidden: true });
const dialog = h("dialog", { class: "new-board" });

const view = mountBoard(canvas);

app.append(
  h(
    "header",
    { class: "top" },
    h("strong", { class: "brand" }, "Vico"),
    boardPicker,
    statusPill,
    h(
      "div",
      { class: "zoom" },
      h("button", { type: "button", "aria-label": "Dézoomer", onclick: () => zoom(-1) }, "−"),
      zoomLabel,
      h("button", { type: "button", "aria-label": "Zoomer", onclick: () => zoom(1) }, "+"),
    ),
    exportMenu,
  ),
  banner,
  h(
    "main",
    { class: "work" },
    h("aside", { class: "left" }, palette, notes),
    h("section", { class: "stage" }, focusBar, canvas, empty),
    sessionPanel,
  ),
  h(
    "footer",
    { class: "bottom" },
    h(
      "div",
      { class: "history" },
      h("button", { type: "button", "aria-label": "Événement précédent", onclick: () => step(-1) }, "◄"),
      historyRange,
      h("button", { type: "button", "aria-label": "Événement suivant", onclick: () => step(1) }, "►"),
      historyLabel,
    ),
    turnBar,
  ),
  toast,
  dialog,
);

historyRange.addEventListener("input", () => travelTo(Number(historyRange.value)));

function step(by: -1 | 1): void {
  travelTo((state.cursor ?? state.live.seq) + by);
}

function zoom(by: -1 | 1): void {
  zoomLabel.textContent = `${Math.round(view.zoomBy(by) * 100)} %`;
}

// ── Regions: each repaints only when its own model changes ───────────────────

const paintBoardPicker = region(
  boardPicker,
  (m: { boards: { id: string; title: string }[]; current: string | undefined }) => [
    m.boards.length > 0 &&
      h(
        "select",
        {
          "aria-label": "Tableau affiché",
          onchange: (event: Event) => openBoard((event.target as HTMLSelectElement).value),
        },
        ...m.boards.map((b) => h("option", { value: b.id, selected: b.id === m.current }, b.title)),
      ),
    h("button", { type: "button", class: "quiet", onclick: () => openNewBoard() }, "+ Tableau"),
  ],
);

const paintStatus = region(statusPill, (m: { tone: string; text: string; connected: boolean }) => [
  h("span", { class: `dot tone-${m.connected ? m.tone : "off"}`, "aria-hidden": "true" }),
  h("span", { class: "status-text" }, m.connected ? m.text : "Compagnon déconnecté, reconnexion…"),
]);

const paintExport = region(exportMenu, (m: { board: string | undefined }) => [
  h("summary", {}, "Exporter"),
  h(
    "div",
    { class: "menu-items" },
    ...EXPORT_FORMATS.map((format) =>
      h(
        "button",
        { type: "button", disabled: !m.board, onclick: () => exportAs(format) },
        EXPORT_LABELS[format],
      ),
    ),
    h(
      "button",
      { type: "button", disabled: !m.board, onclick: () => void copyMermaid() },
      "Copier le Mermaid",
    ),
    h("p", { class: "menu-note" }, "Tout publier d'un coup : vico publish"),
  ),
]);

interface PaletteModel {
  format: string | undefined;
  live: boolean;
  from: string | null;
}

const paintPalette = region(palette, (m: PaletteModel) => {
  const format = m.format ? findFormat(m.format) : undefined;
  if (!format) return [];
  const how =
    format.layout === "timeline"
      ? "Clique un type pour l'ajouter à la suite, ou double-clique dans une case."
      : format.layout === "columns"
        ? "Clique un type, ou double-clique dans une colonne. Glisse pour déplacer."
        : m.from
          ? `Le nouvel élément sera relié à ${m.from}.`
          : "Sélectionne un élément pour que le suivant lui soit relié.";
  return [
    h("h2", {}, format.name),
    h("p", { class: "purpose" }, format.purpose),
    h(
      "ul",
      { class: "types" },
      ...format.types.map((type) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              class: "type",
              disabled: !m.live,
              title: `Ajouter : ${type.label}`,
              onclick: () => view.beginAdd(type.id),
            },
            h(
              "span",
              { class: `swatch shape-${type.shape}`, style: `background:${type.fill};color:${type.ink}` },
              type.prefix,
            ),
            h(
              "span",
              { class: "type-text" },
              h("span", { class: "type-label" }, type.label),
              h("span", { class: "type-hint" }, type.hint),
            ),
          ),
        ),
      ),
    ),
    h("p", { class: "how" }, how),
  ];
});

interface NotesModel {
  board: string | undefined;
  live: boolean;
  notes: { id: string; text: string; target?: string; by: string }[];
}

const paintNotes = region(notes, (m: NotesModel) => {
  if (!m.board) return [];
  const boardId = m.board;
  const input = h("input", {
    type: "text",
    name: "note",
    placeholder: "Une question, une remarque…",
    "aria-label": "Nouvelle note",
    maxlength: 1000,
  });
  const add = (event: Event): void => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) void send({ kind: "note", board: boardId, text });
    input.value = "";
  };
  return [
    h("h2", {}, m.notes.length > 0 ? `Notes ouvertes (${m.notes.length})` : "Notes"),
    h(
      "ul",
      { class: "note-list" },
      ...m.notes.map((note) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              class: "note-target",
              disabled: !note.target,
              onclick: () => select(note.target),
            },
            `${note.id}${note.target ? ` sur ${note.target}` : ""} · ${note.by === "agent" ? "Claude" : "toi"}`,
          ),
          h("p", {}, note.text),
          m.live &&
            h(
              "button",
              {
                type: "button",
                class: "quiet",
                onclick: () => void send({ kind: "resolve", board: boardId, id: note.id }),
              },
              "Résoudre",
            ),
        ),
      ),
    ),
    m.live &&
      h(
        "form",
        { class: "note-form", onsubmit: add },
        input,
        h("button", { type: "submit", class: "quiet" }, "Noter"),
      ),
  ];
});

const paintFocus = region(
  focusBar,
  (m: { ids: string[]; reason?: string; live: boolean; board?: string }) => [
    h("span", {}, h("strong", {}, `Focus : ${m.ids.join(", ")}`), m.reason ? ` — ${m.reason}` : ""),
    m.live && m.board
      ? h(
          "button",
          {
            type: "button",
            class: "quiet",
            onclick: () => void send({ kind: "focus", board: m.board ?? "", ids: [] }),
          },
          "Lever le focus",
        )
      : null,
  ],
);

const paintEmpty = region(empty, (m: { live: boolean }) => [
  h("h1", {}, "Que veux-tu modéliser ?"),
  h(
    "p",
    {},
    "Choisis un atelier, ou demande-le à Claude dans le terminal : il écrira ici pendant qu'il travaille.",
  ),
  h(
    "div",
    { class: "formats" },
    ...FORMATS.map((format) => formatCard(format.id, () => openNewBoard(format.id), !m.live)),
  ),
]);

function formatCard(id: string, onPick: () => void, disabled = false): HTMLElement {
  const format = findFormat(id);
  return h(
    "button",
    { type: "button", class: "format", disabled, onclick: onPick },
    h("span", { class: "format-name" }, format?.name ?? id),
    h("span", { class: "format-purpose" }, format?.purpose ?? ""),
    h(
      "span",
      { class: "format-swatches", "aria-hidden": "true" },
      ...(format?.types ?? []).map((t) => h("span", { style: `background:${t.fill}` })),
    ),
  );
}

interface SessionModel {
  status: { tone: string; text: string };
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

const paintSession = region(sessionPanel, (m: SessionModel) => [
  h("h2", {}, "Session"),
  h("p", { class: `session-status tone-${m.status.tone}` }, m.status.text),
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
        h("p", { class: "prompt" }, h("time", {}, turn.at), ` ${turn.prompt || "(tour en cours)"}`),
        h(
          "ul",
          { class: "tools" },
          turn.hidden > 0 && h("li", { class: "more" }, `… ${turn.hidden} étapes avant`),
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
  m.turns.length === 0 &&
    h(
      "p",
      { class: "hint" },
      "Les étapes de Claude apparaîtront ici dès qu'une session Claude Code tournera dans ce projet.",
    ),
]);

interface TurnModel {
  board: string | undefined;
  live: boolean;
  pending: number;
  hint: string;
  theirs: string | undefined;
}

const paintTurn = region(turnBar, (m: TurnModel) => {
  const message = h("input", {
    type: "text",
    placeholder: "Un mot pour Claude (facultatif)",
    "aria-label": "Message pour Claude",
    maxlength: 1000,
    disabled: !m.live || !m.board,
  });
  const pass = (event: Event): void => {
    event.preventDefault();
    if (m.board)
      void send({ kind: "pass", board: m.board, to: "agent", message: message.value.trim() || undefined });
  };
  const count =
    m.pending === 0
      ? "Claude est à jour"
      : `${m.pending} changement${m.pending > 1 ? "s" : ""} que Claude n'a pas lu${m.pending > 1 ? "s" : ""}`;
  return [
    m.theirs !== undefined &&
      h(
        "p",
        { class: "theirs" },
        h("strong", {}, "Claude te passe la main"),
        m.theirs ? ` : ${m.theirs}` : "",
      ),
    h("p", { class: "pending" }, h("strong", {}, count), ` · ${m.hint}`),
    h(
      "form",
      { class: "pass", onsubmit: pass },
      message,
      h(
        "button",
        { type: "submit", class: "primary", disabled: !m.live || !m.board },
        "Passer la main à Claude",
      ),
    ),
  ];
});

// ── Actions ──────────────────────────────────────────────────────────────────

function select(id: string | undefined): void {
  if (!id) return;
  state.selected = id;
  changed();
}

function exportAs(format: ExportFormat): void {
  const board = currentBoard();
  if (!board) return;
  const text = exportBoard(board, format, { exportedAt: new Date().toISOString() });
  const url = URL.createObjectURL(new Blob([text], { type: MIME[format] }));
  const link = h("a", { href: url, download: `${board.id}.${EXTENSION[format]}` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  exportMenu.open = false;
}

async function copyMermaid(): Promise<void> {
  const board = currentBoard();
  if (!board) return;
  try {
    await navigator.clipboard.writeText(toMermaid(board));
    say("Mermaid copié dans le presse-papiers.");
  } catch {
    say("Le navigateur a refusé l'accès au presse-papiers ; utilise l'export Mermaid.");
  }
  exportMenu.open = false;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function say(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    state.error = null;
  }, 5000);
}

function openNewBoard(formatId = "event-storming"): void {
  const title = h("input", {
    type: "text",
    name: "title",
    required: true,
    maxlength: 120,
    placeholder: "Passage de commande",
    "aria-label": "Titre du tableau",
  });
  const choices = FORMATS.map((format) =>
    h(
      "label",
      { class: "format choice" },
      h("input", { type: "radio", name: "format", value: format.id, checked: format.id === formatId }),
      h("span", { class: "format-name" }, format.name),
      h("span", { class: "format-purpose" }, format.purpose),
    ),
  );
  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    const format = new FormData(event.target as HTMLFormElement).get("format");
    const name = title.value.trim();
    if (!name || typeof format !== "string") return;
    const id = freeId(slugify(name));
    const done = await send({ kind: "create-board", board: id, title: name, format });
    if (!done) return;
    dialog.close();
    openBoard(id);
  };
  dialog.replaceChildren(
    h(
      "form",
      { onsubmit: (event: Event) => void create(event) },
      h("h2", {}, "Nouveau tableau"),
      h("label", { class: "field" }, "Titre", title),
      h("fieldset", {}, h("legend", {}, "Atelier"), ...choices),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "quiet", onclick: () => dialog.close() }, "Annuler"),
        h("button", { type: "submit", class: "primary" }, "Créer"),
      ),
    ),
  );
  dialog.showModal();
  title.focus();
}

/** A board id not in use yet: the slug, or the slug with the first free number. */
function freeId(slug: string): string {
  if (!findBoard(state.live, slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug.slice(0, 36)}-${n}`;
    if (!findBoard(state.live, candidate)) return candidate;
  }
}

// ── The paint ────────────────────────────────────────────────────────────────

function render(): void {
  const ws = shown();
  const board = currentBoard();
  const session = currentSession();
  const live = isLive();
  const liveSession = latestSession(state.live);
  const max = state.live.seq;

  paintBoardPicker({ boards: ws.boards.map((b) => ({ id: b.id, title: b.title })), current: board?.id });
  paintStatus({ ...agentStatus(session, live ? state.listening : 0), connected: state.connected });
  paintExport({ board: board?.id });
  paintPalette({
    format: board?.format,
    live,
    from: board && findFormat(board.format)?.layout === "graph" ? state.selected : null,
  });
  paintNotes({
    board: board?.id,
    live,
    notes: (board?.notes ?? [])
      .filter((n) => !n.resolved)
      .map((n) => ({ id: n.id, text: n.text, target: n.target, by: n.by })),
  });

  focusBar.hidden = !board?.focus;
  if (board?.focus) paintFocus({ ids: board.focus.ids, reason: board.focus.reason, live, board: board.id });

  canvas.hidden = !board;
  empty.hidden = Boolean(board);
  if (!board) paintEmpty({ live });
  view.paint(board);

  paintSession({
    status: agentStatus(session, live ? state.listening : 0),
    todos: (session?.todos ?? []).map((t) => ({ text: t.text, status: t.status })),
    turns: recentTurns(session, TURNS_SHOWN).map((turn) => ({
      at: clock(turn.startedAt),
      prompt: turn.prompt,
      hidden: Math.max(0, turn.tools.length - TOOLS_SHOWN),
      tools: turn.tools
        .slice(-TOOLS_SHOWN)
        .map((t) => ({ tool: t.tool, summary: t.summary, status: t.status })),
    })),
  });
  sessionPanel.scrollTop = sessionPanel.scrollHeight;

  historyRange.max = String(max);
  if (document.activeElement !== historyRange || live) historyRange.value = String(state.cursor ?? max);
  const at = state.cursor === null ? undefined : state.events.find((e) => e.seq === state.cursor);
  historyLabel.textContent = live
    ? `En direct · ${max} événement${max > 1 ? "s" : ""}`
    : state.cursor === 0
      ? "Avant le premier événement"
      : `${state.cursor} / ${max}${at ? ` · ${clock(at.ts)} · ${describeEvent(at)}` : ""}`;

  banner.hidden = live;
  if (!live && banner.childElementCount === 0) {
    banner.append(
      h("span", {}, "Tu regardes le passé : le tableau est en lecture seule."),
      h("button", { type: "button", class: "primary", onclick: () => travelTo(null) }, "Revenir au direct"),
    );
  }

  const turn = board ? findBoard(state.live, board.id)?.turn : undefined;
  paintTurn({
    board: board?.id,
    live,
    pending: pendingCount(state.events, liveSession),
    hint: handOverHint(liveSession?.status, state.listening),
    theirs: turn?.to === "human" ? (turn.message ?? "") : undefined,
  });

  if (state.error) say(state.error);
  if (state.notice) {
    say(state.notice);
    state.notice = null;
  }
  document.title = board ? `${board.title} · Vico` : "Vico";
}

start(render);
render();
