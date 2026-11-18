/**
 * The page. One screen: the board in the middle, what you can add on the left,
 * what Claude is doing on the right, time and the hand-over at the bottom.
 * Everything shown is a function of the journal; every gesture sends a command.
 */
import { type Command, slugify } from "../domain/commands.ts";
import { EXPORT_FORMATS, EXTENSION, type ExportFormat, exportBoard } from "../domain/export/index.ts";
import { toMermaid } from "../domain/export/mermaid.ts";
import { FORMATS, findFormat } from "../domain/formats.ts";
import { asLocale, LOCALES } from "../domain/i18n.ts";
import { SVG_STYLE } from "../domain/render/svg.ts";
import { findBoard, latestSession } from "../domain/workspace.ts";
import { mountBoard } from "./board-view.ts";
import { clock, h, type Props, region } from "./dom.ts";
import { chooseLocale, locale, t } from "./locale.ts";
import { MESSAGES } from "./messages.ts";
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
import {
  agentStatus,
  claudeWaits,
  type Discussion,
  describeEvent,
  discussions,
  handOverHint,
  handOverNotice,
  historyBoard,
  historyPlace,
  historyStep,
  historyStopAt,
  historyStops,
  pendingChanges,
  recentTurns,
  redoTarget,
  undoTarget,
  unreadOn,
  type Waiting,
} from "./view.ts";

const TURNS_SHOWN = 4;
const TOOLS_SHOWN = 8;
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
/** Claude waits for the human: said just before the zoom, whatever board is on screen. */
const waitsPill = h("div", { class: "waits", role: "status", "aria-live": "polite" });
const zoomLabel = h("span", { class: "zoom-label" }, "100 %");
const undoGroup = h("div", { class: "undo" });
const exportMenu = h("details", { class: "menu" });
const banner = h("div", { class: "banner", hidden: true });
const palette = h("section", { class: "palette", "aria-label": t.palette });
const notes = h("section", { class: "notes", "aria-label": t.notes });
const focusBar = h("div", { class: "focus-bar", hidden: true });
const canvas = h("div", { class: "canvas" });
const empty = h("div", { class: "empty", hidden: true });
const sessionPanel = h("aside", { class: "right", "aria-label": t.sessionPanel });
const historyLabel = h("output", { class: "history-label" });
const historyRange = h("input", {
  type: "range",
  min: 0,
  max: 0,
  value: 0,
  step: 1,
  "aria-label": t.history,
});
/** The reader asked the history for every event, not only the board's. Kept while the page is open. */
let wholeJournal = false;
const historyScope = h(
  "select",
  {
    "aria-label": t.historyScope,
    onchange: () => {
      wholeJournal = historyScope.value === "everything";
      changed();
    },
  },
  h("option", { value: "board" }, t.thisBoard),
  h("option", { value: "everything" }, t.everything),
);
/** What the bar says of the turn. Repainted apart from the message beside it. */
const turnSays = h("div", { class: "turn-says" });
/** Made once: a message being typed for Claude keeps its words and the keyboard through every repaint. */
const passMessage = h("input", {
  type: "text",
  placeholder: t.messagePlaceholder,
  "aria-label": t.messageForClaude,
  maxlength: 1000,
});
const passButton = h("button", { type: "submit", class: "primary" }, t.handOver);
/** The board the turn is handed over on: the one on screen. */
let passOn: string | undefined;
const turnBar = h(
  "div",
  { class: "turn" },
  turnSays,
  h(
    "form",
    {
      class: "pass",
      onsubmit: (event: Event) => {
        event.preventDefault();
        if (!passOn) return;
        void send({
          kind: "pass",
          board: passOn,
          to: "agent",
          message: passMessage.value.trim() || undefined,
        });
        passMessage.value = "";
        // The page cannot wake a terminal at rest: say what will make Claude read this.
        const notice = handOverNotice(latestSession(state.live)?.status, state.listening, locale);
        if (notice) say(notice);
      },
    },
    passMessage,
    passButton,
  ),
);
const toast = h("div", { class: "toast", role: "alert", hidden: true });
const dialog = h("dialog", { class: "sheet new-board" });
const removal = h("dialog", { class: "sheet remove-board" });

/** The reader's language: every language under its own name, so it is found whatever the page speaks. */
const languagePicker = h(
  "select",
  {
    class: "language",
    "aria-label": t.language,
    onchange: (event: Event) => {
      const next = asLocale((event.target as HTMLSelectElement).value);
      if (next) chooseLocale(next);
    },
  },
  ...LOCALES.map((l) => h("option", { value: l, lang: l, selected: l === locale }, MESSAGES[l].languageName)),
);

const view = mountBoard(canvas);

app.append(
  h(
    "header",
    { class: "top" },
    h("strong", { class: "brand" }, "Vico"),
    boardPicker,
    undoGroup,
    statusPill,
    waitsPill,
    h(
      "div",
      { class: "zoom" },
      h("button", { type: "button", "aria-label": t.zoomOut, onclick: () => zoom(-1) }, "−"),
      zoomLabel,
      h("button", { type: "button", "aria-label": t.zoomIn, onclick: () => zoom(1) }, "+"),
    ),
    exportMenu,
    languagePicker,
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
      h("button", { type: "button", "aria-label": t.previousEvent, onclick: () => step(-1) }, "◄"),
      historyRange,
      h("button", { type: "button", "aria-label": t.nextEvent, onclick: () => step(1) }, "►"),
      historyScope,
      historyLabel,
    ),
    turnBar,
  ),
  toast,
  dialog,
  removal,
);

/** The board the history follows: none when the reader asked for everything, or no board is there. */
function historyFollows(): string | undefined {
  return wholeJournal ? undefined : historyBoard(state.events, state.boardId, currentBoard()?.id);
}

function historyStopsShown(): number[] {
  return historyStops(state.events, historyFollows());
}

historyRange.addEventListener("input", () =>
  travelTo(historyStopAt(historyStopsShown(), Number(historyRange.value))),
);

function step(by: -1 | 1): void {
  travelTo(historyStep(historyStopsShown(), state.cursor, by));
}

function zoom(by: -1 | 1): void {
  zoomLabel.textContent = `${Math.round(view.zoomBy(by) * 100)} %`;
}

// ── Regions: each repaints only when its own model changes ───────────────────

interface BoardPickerModel {
  boards: { id: string; title: string }[];
  current: string | undefined;
  live: boolean;
}

const paintBoardPicker = region(boardPicker, (m: BoardPickerModel) => {
  const shown = m.boards.find((b) => b.id === m.current);
  return [
    m.boards.length > 0 &&
      h(
        "select",
        {
          "aria-label": t.boardShown,
          onchange: (event: Event) => openBoard((event.target as HTMLSelectElement).value),
        },
        ...m.boards.map((b) => h("option", { value: b.id, selected: b.id === m.current }, b.title)),
      ),
    h("button", { type: "button", class: "quiet", onclick: () => openNewBoard() }, t.newBoardButton),
    shown &&
      h(
        "button",
        {
          type: "button",
          class: "quiet remove-board",
          title: t.removeBoard(shown.title),
          "aria-label": t.removeBoard(shown.title),
          disabled: !m.live,
          onclick: () => askToRemove(shown.id),
        },
        t.remove,
      ),
  ];
});

/** As the reader's keyboard writes them: ⌘ on a Mac, Ctrl elsewhere. */
const SHORTCUTS = /Mac|iPhone|iPad/.test(navigator.platform)
  ? { undo: "⌘Z", redo: "⇧⌘Z" }
  : { undo: "Ctrl+Z", redo: locale === "fr" ? "Ctrl+Maj+Z" : "Ctrl+Shift+Z" };

const paintUndo = region(undoGroup, (m: { undo: boolean; redo: boolean }) => [
  h(
    "button",
    {
      type: "button",
      title: t.undo(SHORTCUTS.undo),
      "aria-label": t.undo(SHORTCUTS.undo),
      disabled: !m.undo,
      onclick: () => void undo(),
    },
    t.undoAction,
  ),
  h(
    "button",
    {
      type: "button",
      title: t.redo(SHORTCUTS.redo),
      "aria-label": t.redo(SHORTCUTS.redo),
      disabled: !m.redo,
      onclick: () => void redo(),
    },
    t.redoAction,
  ),
]);

const paintStatus = region(statusPill, (m: { tone: string; text: string; connected: boolean }) => [
  h("span", { class: `dot tone-${m.connected ? m.tone : "off"}`, "aria-hidden": "true" }),
  h("span", { class: "status-text" }, m.connected ? m.text : t.disconnected),
]);

const paintWaits = region(waitsPill, (m: { waiting: Waiting | undefined; current: string | undefined }) => {
  const w = m.waiting;
  if (!w) return [];
  const here = w.board === m.current;
  return [
    h(
      "button",
      {
        type: "button",
        class: "quiet",
        "data-board": w.board,
        title: w.message,
        // Pressed, it leads to the board and says why: Claude's words, wherever the reader was.
        onclick: () => {
          if (!here) openBoard(w.board);
          say(w.message ? `${t.theirTurn}${t.colon} ${w.message}` : t.theirTurn);
        },
      },
      h("span", { class: "waits-dot", "aria-hidden": "true" }),
      here ? t.claudeWaits : t.claudeWaitsOn(w.title),
      w.others > 0 && h("span", { class: "waits-more" }, ` +${w.others}`),
    ),
  ];
});

const paintExport = region(exportMenu, (m: { board: string | undefined }) => [
  h("summary", {}, t.export),
  h(
    "div",
    { class: "menu-items" },
    ...EXPORT_FORMATS.map((format) =>
      h(
        "button",
        { type: "button", disabled: !m.board, onclick: () => exportAs(format) },
        t.exportAs[format],
      ),
    ),
    h("button", { type: "button", disabled: !m.board, onclick: () => void copyMermaid() }, t.copyMermaid),
    h("p", { class: "menu-note" }, t.publishAll),
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
      ? t.howTimeline
      : format.layout === "columns"
        ? t.howColumns
        : m.from
          ? t.howGraphFrom(m.from)
          : t.howGraph;
  return [
    h("h2", {}, format.name[locale]),
    h("p", { class: "purpose" }, format.purpose[locale]),
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
              title: t.add(type.label[locale]),
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
              h("span", { class: "type-label" }, type.label[locale]),
              h("span", { class: "type-hint" }, type.hint[locale]),
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
  /** The selected card: its discussions stand out. */
  selected: string | null;
  threads: Discussion[];
  /** The discussions that carry a note Claude has not read. */
  unread: string[];
}

/** A field for a few words that may run over several lines: Enter sends them, Shift+Enter breaks the line. */
function wordsField(props: Props, words: string, oninput: (words: string) => void): HTMLTextAreaElement {
  const field = h("textarea", {
    class: "words",
    rows: 1,
    maxlength: 1000,
    ...props,
    oninput: () => oninput(field.value),
  });
  field.value = words;
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    field.form?.requestSubmit();
  });
  return field;
}

/** Replies being typed, per discussion: they survive a repaint, such as Claude answering meanwhile. */
const drafts = new Map<string, string>();
const draftKey = (board: string, thread: string): string => `${board}/${thread}`;

const paintThreads = region(notes, (m: NotesModel) => {
  if (!m.board) return [];
  const boardId = m.board;
  const key = draftKey(boardId, "new");
  const input = wordsField(
    { name: "note", placeholder: t.notePlaceholder, "aria-label": t.newNote },
    drafts.get(key) ?? "",
    (words) => drafts.set(key, words),
  );
  const add = (event: Event): void => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) void send({ kind: "note", board: boardId, text });
    input.value = "";
    drafts.delete(key);
  };
  return [
    h("h2", {}, m.threads.length > 0 ? t.openNotes(m.threads.length) : t.notes),
    h("ul", { class: "note-list" }, ...m.threads.map((thread) => threadItem(boardId, thread, m))),
    m.live &&
      h(
        "form",
        { class: "note-form", onsubmit: add },
        input,
        h("button", { type: "submit", class: "quiet" }, t.addNote),
      ),
  ];
});

function threadItem(boardId: string, thread: Discussion, m: NotesModel): HTMLElement {
  const on = thread.on;
  const key = draftKey(boardId, thread.id);
  const field = wordsField(
    { name: `reply-${thread.id}`, placeholder: t.replyPlaceholder, "aria-label": t.replyTo(thread.id) },
    drafts.get(key) ?? "",
    (words) => {
      drafts.set(key, words);
      offer();
    },
  );
  const closing = h("button", { type: "button", class: "quiet thread-resolve" });
  /** The closing button says what it will do with the words in the field. */
  const offer = (): void => {
    closing.textContent = field.value.trim() ? t.replyAndResolve : t.resolve;
  };
  offer();
  /** The answer being typed, taken out of the field: said once, by whoever asks for it. */
  const typed = (): Command[] => {
    const text = field.value.trim();
    field.value = "";
    drafts.delete(key);
    return text ? [{ kind: "reply", board: boardId, to: thread.id, text }] : [];
  };
  const reply = (event: Event): void => {
    event.preventDefault();
    const saying = typed();
    if (saying.length > 0) void send(...saying);
  };
  // Closing with an answer still in the field says it first: nothing typed is lost.
  closing.onclick = () => void send(...typed(), { kind: "resolve", board: boardId, id: thread.id });
  return h(
    "li",
    {
      class: on && on.id === m.selected ? "thread is-current" : "thread",
      "data-thread": thread.id,
      onmouseenter: () => view.point(on?.id),
      onmouseleave: () => view.point(undefined),
      onfocusin: () => view.point(on?.id),
      onfocusout: () => view.point(undefined),
    },
    h(
      "button",
      {
        type: "button",
        class: "thread-on",
        disabled: on?.label === undefined,
        title: on?.label === undefined ? undefined : t.showCard(on.id),
        onclick: () => select(on?.id),
      },
      on ? (on.label === undefined ? t.cardGone(on.id) : `${on.id} · ${on.label}`) : t.wholeBoard,
    ),
    h(
      "ol",
      { class: "thread-notes" },
      ...thread.notes.map((note) =>
        h(
          "li",
          { class: `by-${note.by}`, "data-note": note.id },
          h("span", { class: "thread-author" }, t.author[note.by]),
          h("span", { class: "thread-id" }, note.id),
          h("p", {}, note.text),
        ),
      ),
    ),
    m.unread.includes(thread.id) && h("p", { class: "thread-unread" }, t.unread),
    m.live &&
      h(
        "form",
        { class: "thread-reply", onsubmit: reply },
        field,
        h("button", { type: "submit", class: "quiet" }, t.reply),
      ),
    h(
      "div",
      { class: "thread-foot" },
      h("span", { class: `thread-waits waits-${thread.waits}` }, t.waits[thread.waits]),
      m.live && closing,
    ),
  );
}

/** Repaints the discussions without taking the keyboard from a reply being typed. */
function paintNotes(model: NotesModel): void {
  const active = document.activeElement;
  const typing = active instanceof HTMLTextAreaElement && notes.contains(active) ? active : undefined;
  paintThreads(model);
  if (!typing || typing.isConnected) return;
  const again = notes.querySelector<HTMLTextAreaElement>(`textarea[name="${typing.name}"]`);
  if (!again) return;
  again.value = typing.value;
  again.focus();
  again.setSelectionRange(typing.selectionStart, typing.selectionEnd);
}

/** Brings the selected card's first discussion into view, once per selection. */
let shownFor: string | null = null;
function revealThreads(selected: string | null): void {
  if (selected === shownFor) return;
  shownFor = selected;
  notes.querySelector(".thread.is-current")?.scrollIntoView({ block: "nearest" });
}

const paintFocus = region(
  focusBar,
  (m: { ids: string[]; reason?: string; live: boolean; board?: string }) => [
    h("span", {}, h("strong", {}, t.focus(m.ids.join(", "))), m.reason ? ` — ${m.reason}` : ""),
    m.live && m.board
      ? h(
          "button",
          {
            type: "button",
            class: "quiet",
            onclick: () => void send({ kind: "focus", board: m.board ?? "", ids: [] }),
          },
          t.clearFocus,
        )
      : null,
  ],
);

const paintEmpty = region(empty, (m: { live: boolean }) => [
  h("h1", {}, t.emptyTitle),
  h("p", {}, t.emptyHint),
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
    h("span", { class: "format-name" }, format?.name[locale] ?? id),
    h("span", { class: "format-purpose" }, format?.purpose[locale] ?? ""),
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
  h("h2", {}, t.session),
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

interface TurnModel {
  board: string | undefined;
  live: boolean;
  pending: number;
  hint: string;
  theirs: string | undefined;
}

const paintTurnSays = region(turnSays, (m: TurnModel) => {
  const count = m.pending === 0 ? t.upToDate : t.pending(m.pending);
  return [
    m.theirs !== undefined &&
      h("p", { class: "theirs" }, h("strong", {}, t.theirTurn), m.theirs ? `${t.colon} ${m.theirs}` : ""),
    h("p", { class: "pending" }, h("strong", {}, count), ` · ${m.hint}`),
  ];
});

function paintTurn(m: TurnModel): void {
  paintTurnSays(m);
  passOn = m.board;
  passMessage.disabled = passButton.disabled = !m.live || !m.board;
}

interface HistoryModel {
  /** Where the slider's handle sits, and how far it goes. */
  at: number;
  max: number;
  live: boolean;
  label: string;
  /** The history follows a board; otherwise it steps through every event. */
  board: boolean;
  /** False when the reader wants a board and none is there to follow. */
  choice: boolean;
}

/** Not a region: the slider stays the same element, so a drag on it goes on through a repaint. */
function paintHistory(m: HistoryModel): void {
  historyRange.max = String(m.max);
  if (document.activeElement !== historyRange || m.live) historyRange.value = String(m.at);
  historyLabel.textContent = m.label;
  historyScope.value = m.board ? "board" : "everything";
  historyScope.disabled = !m.choice;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function select(id: string | undefined): void {
  if (!id) return;
  state.selected = id;
  changed();
  view.reveal(id);
}

function exportAs(format: ExportFormat): void {
  const board = currentBoard();
  if (!board) return;
  const text = exportBoard(board, format, { exportedAt: new Date().toISOString(), locale });
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
    await navigator.clipboard.writeText(toMermaid(board, locale));
    say(t.mermaidCopied);
  } catch {
    say(t.clipboardRefused);
  }
  exportMenu.open = false;
}

/**
 * Takes back the human's latest gesture: on the board shown, or the removal of a
 * board if that came after. Claude's gestures are never theirs to undo.
 */
async function undo(): Promise<void> {
  const board = isLive() ? undoTarget(state.live, state.boardId ?? undefined) : undefined;
  if (board) await send({ kind: "undo", board });
}

async function redo(): Promise<void> {
  const board = isLive() ? redoTarget(state.live, state.boardId ?? undefined) : undefined;
  if (board) await send({ kind: "redo", board });
}

/** A text being typed has its own undo, and a question asked in a dialog comes first. */
function typing(target: EventTarget | null): boolean {
  if (document.querySelector("dialog[open]")) return true;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || typing(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "z") void (event.shiftKey ? redo() : undo());
  else if (key === "y" && !event.shiftKey) void redo();
  else return;
  event.preventDefault();
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Says one thing, briefly. With an `offer`, it stays longer: there is something to press. */
function say(text: string, offer?: { label: string; run: () => void }): void {
  const hide = (): void => {
    toast.hidden = true;
    state.error = null;
  };
  toast.replaceChildren(text);
  if (offer) {
    const take = (): void => {
      hide();
      offer.run();
    };
    toast.append(h("button", { type: "button", onclick: take }, offer.label));
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, offer ? 10000 : 5000);
}

/** The build this page is, as the companion signed it into the document. */
const BUILD = document.querySelector<HTMLMetaElement>('meta[name="vico-build"]')?.content;
const RELOADED_FOR = "vico.reloadedFor";
/** The served build this page has offered to reload for: it says so once. */
let offered: string | null = null;

/**
 * True while a reload would lose words: a reply kept as a draft, a field with
 * text in it, a question being asked.
 */
function holdsWords(): boolean {
  if (document.querySelector("dialog[open]")) return true;
  if ([...drafts.values()].some((text) => text !== "")) return true;
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[type="text"], textarea',
  );
  return [...fields].some((field) => field.value !== "" && field.checkVisibility());
}

/**
 * Notes, across the reload, that this tab reloads by itself for `served`. False when
 * it already did, or cannot keep the note: one reload per build served, never a loop.
 */
function firstReloadFor(served: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === served) return false;
    sessionStorage.setItem(RELOADED_FOR, served);
    return true;
  } catch {
    return false;
  }
}

/** The page is the one served: the next update gets a reload of its own. */
function forgetReload(): void {
  try {
    sessionStorage.removeItem(RELOADED_FOR);
  } catch {
    // Nothing could be kept, so nothing is left behind.
  }
}

/**
 * The companion came back serving another page than this one: Vico was updated.
 * The tab reloads to become that page as soon as no words would be lost. Until
 * then, or when a reload already failed to bring it, it says so once, and
 * reloading is the reader's to choose.
 */
function meet(served: string | null): void {
  if (served === null) return;
  if (served === BUILD) forgetReload();
  else if (!holdsWords() && firstReloadFor(served)) location.reload();
  else if (offered !== served) {
    offered = served;
    say(t.updated, { label: t.reload, run: () => location.reload() });
  }
}

function openNewBoard(formatId = "event-storming"): void {
  const title = h("input", {
    type: "text",
    name: "title",
    required: true,
    maxlength: 120,
    placeholder: t.titleExample,
    "aria-label": t.boardTitle,
  });
  const choices = FORMATS.map((format) =>
    h(
      "label",
      { class: "format choice" },
      h("input", { type: "radio", name: "format", value: format.id, checked: format.id === formatId }),
      h("span", { class: "format-name" }, format.name[locale]),
      h("span", { class: "format-purpose" }, format.purpose[locale]),
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
      h("h2", {}, t.newBoard),
      h("label", { class: "field" }, t.title, title),
      h("fieldset", {}, h("legend", {}, t.workshop), ...choices),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "quiet", onclick: () => dialog.close() }, t.cancel),
        h("button", { type: "submit", class: "primary" }, t.create),
      ),
    ),
  );
  dialog.showModal();
  title.focus();
}

/**
 * Removing a board takes it from Claude too, so the page asks first, and the
 * answer that keeps the board has the focus. Once removed, undoing is offered at once.
 */
function askToRemove(id: string): void {
  const board = findBoard(state.live, id);
  if (!board || !isLive()) return;
  const keep = h("button", { type: "button", class: "quiet", onclick: () => removal.close() }, t.cancel);
  const remove = async (): Promise<void> => {
    const done = await send({ kind: "remove-board", board: id });
    removal.close();
    if (done) say(t.boardRemoved(board.title), { label: t.undoAction, run: () => void undo() });
  };
  removal.replaceChildren(
    h("h2", {}, t.removeBoardQuestion(board.title)),
    h("p", {}, t.removeBoardConsequence(board.elements.length)),
    h(
      "div",
      { class: "actions" },
      keep,
      h("button", { type: "button", class: "danger", onclick: () => void remove() }, t.remove),
    ),
  );
  removal.showModal();
  keep.focus();
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
  const pending = pendingChanges(state.events, liveSession);
  // The marks tell about now: a board shown as it was carries none.
  const unread = live && board ? unreadOn(pending, board.id) : { cards: [], threads: [] };

  paintBoardPicker({
    boards: ws.boards.map((b) => ({ id: b.id, title: b.title })),
    current: board?.id,
    live,
  });
  paintStatus({ ...agentStatus(session, live ? state.listening : 0, locale), connected: state.connected });
  paintExport({ board: board?.id });
  paintWaits({ waiting: live ? claudeWaits(ws) : undefined, current: board?.id });
  const mine = live ? (state.boardId ?? undefined) : undefined;
  paintUndo({
    undo: live && undoTarget(state.live, mine) !== undefined,
    redo: live && redoTarget(state.live, mine) !== undefined,
  });
  paintPalette({
    format: board?.format,
    live,
    from: board && findFormat(board.format)?.layout === "graph" ? state.selected : null,
  });
  paintNotes({
    board: board?.id,
    live,
    selected: state.selected,
    threads: board ? discussions(board) : [],
    unread: unread.threads,
  });
  revealThreads(state.selected);

  focusBar.hidden = !board?.focus;
  if (board?.focus) paintFocus({ ids: board.focus.ids, reason: board.focus.reason, live, board: board.id });

  canvas.hidden = !board;
  empty.hidden = Boolean(board);
  if (!board) paintEmpty({ live });
  view.paint(board, unread.cards);

  paintSession({
    status: agentStatus(session, live ? state.listening : 0, locale),
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

  const followed = historyFollows() !== undefined;
  const stops = historyStopsShown();
  const place = historyPlace(stops, state.cursor);
  const latest = state.events.find((e) => e.seq === place.seq);
  paintHistory({
    at: place.index,
    max: stops.length - 1,
    live,
    label: live
      ? t.live(place.of)
      : place.at === 0
        ? t.beforeFirst
        : `${place.at} / ${place.of}${latest ? ` · ${clock(latest.ts)} · ${describeEvent(latest, locale)}` : ""}`,
    board: followed,
    choice: wholeJournal || followed,
  });

  banner.hidden = live;
  if (!live && banner.childElementCount === 0) {
    banner.append(
      h("span", {}, t.past),
      h("button", { type: "button", class: "primary", onclick: () => travelTo(null) }, t.backToLive),
    );
  }

  const turn = board ? findBoard(state.live, board.id)?.turn : undefined;
  paintTurn({
    board: board?.id,
    live,
    pending: pending.count,
    hint: handOverHint(liveSession?.status, state.listening, locale),
    theirs: turn?.to === "human" ? (turn.message ?? "") : undefined,
  });

  if (state.error) say(state.error);
  if (state.notice) {
    say(state.notice);
    state.notice = null;
  }
  meet(state.served);
  document.title = board ? `${board.title} · Vico` : "Vico";
}

start(render);
render();
