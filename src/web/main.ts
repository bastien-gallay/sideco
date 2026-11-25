/**
 * The page. One screen: the board in the middle, what you can add on the left,
 * what Claude is doing on the right, time and the hand-over at the bottom.
 * Everything shown is a function of the journal; every gesture sends a command.
 */
import type { Command } from "../domain/commands.ts";
import { EXPORT_FORMATS, type ExportFormat } from "../domain/export/index.ts";
import { findFormat, planAxis } from "../domain/formats.ts";
import { formerly, WORDS } from "../domain/i18n.ts";
import { SVG_STYLE } from "../domain/render/svg.ts";
import { readerOf, shownSession, TURNS_SHOWN } from "../domain/sessions.ts";
import { type Board, findBoard } from "../domain/workspace.ts";
import { arrived, keepChosen } from "./address.ts";
import { type Status, shownStatus } from "./agent-status.ts";
import { mountBoard } from "./board-view.ts";
import {
  askToRemove,
  boardPicker,
  boardTiles,
  brand,
  home,
  newBoardSheet,
  openNewBoard,
  paintBoardPicker,
  paintHome,
  removeSheet,
} from "./boards.ts";
import { cardFacts, kindSaid } from "./card-facts.ts";
import {
  type LabelsModel,
  labelSection,
  onLabelsLeft,
  projectLabels,
  refocusLabelField,
  refocusLabels,
  typingLabel,
} from "./card-labels.ts";
import { linkSection } from "./card-links.ts";
import { chosenBar, paintChosen } from "./chosen-more.ts";
import { clock, h, region } from "./dom.ts";
import { describeEvent, sessionName } from "./event-words.ts";
import { copiedMermaid, downloadBoard } from "./export-out.ts";
import { mountFind } from "./find-bar.ts";
import { focusBar, focusButton, focusShown, paintFocusBar, pointAtChosen } from "./focus-bar.ts";
import { keysSheet, openKeys } from "./keys-sheet.ts";
import { filterBar, mountLabelFilter, paintLabelFilter } from "./label-filter.ts";
import { paintUnseen } from "./lane-unseen.ts";
import { mountLinkHint } from "./link-hint.ts";
import { type LinkRow, linkRows } from "./link-rows.ts";
import { languagePicker, locale, t } from "./locale.ts";
import { markdownNodes } from "./markdown.ts";
import { messageField, wordsField } from "./message-field.ts";
import { mountNotices, type Offer } from "./notices.ts";
import { mountPageKeys } from "./page-keys.ts";
import { type PaletteModel, paletteContent } from "./palette.ts";
import { meetUpdates } from "./reload.ts";
import { paintSession, sessionPanel } from "./session-panel.ts";
import {
  choosable,
  onSessionChosen,
  paintSessionPicker,
  sessionChoices,
  sessionPicker,
} from "./session-picker.ts";
import {
  caughtUpYet,
  changed,
  currentBoard,
  currentSession,
  heldSince,
  isLive,
  journal,
  journalFor,
  onRenumbered,
  openBoard,
  send,
  settled,
  shown,
  start,
  state,
  travelTo,
} from "./store.ts";
import { fitTabsIn, TABS, type Tab, tabIcon, tabKeys, tabName } from "./tabs.ts";
import { askBeforeUndo, lastGesture } from "./undo-ask.ts";
import {
  agentStatus,
  claudeWaits,
  type Discussion,
  discussions,
  handOverHint,
  handOverNotice,
  historyBoard,
  historyPlace,
  historyStep,
  historyStops,
  keptLines,
  mentions,
  pendingChanges,
  recentTurns,
  redoTarget,
  resolvedDiscussions,
  sinceLastVisit,
  tabTitle,
  undoTarget,
  unreadOn,
  type Waiting,
  waitsNotice,
} from "./view.ts";

const TOOLS_SHOWN = 8;

const app = document.getElementById("app");
if (!app) throw new Error("the page has no #app");
document.head.prepend(h("style", {}, SVG_STYLE));

// ── Shell, built once ────────────────────────────────────────────────────────

const statusPill = h("div", { class: "status", role: "status", "aria-live": "polite" });
/** Claude waits for the human: said just before the zoom, whatever board is on screen. */
const waitsPill = h("div", { class: "waits", role: "status", "aria-live": "polite" });
/** Says the zoom, and fits the whole board when pressed: on a large board, the way to see all of it. */
const zoomLabel = h(
  "button",
  { type: "button", class: "zoom-label", title: t.fitHint, "aria-label": t.fitHint, onclick: () => fit() },
  "100 %",
);
const undoGroup = h("div", { class: "undo" });
/** What is done to the board as a whole: a new one, an export, its removal. Out of the way, one click off. */
const boardMenu = h("details", { class: "menu board-menu" });
const banner = h("div", { class: "banner", hidden: true });
const palette = h("section", { class: "palette", "aria-label": t.palette });
/** The discussions of the board, a tab of the right panel: open ones first, resolved ones folded under. */
const notes = h("section", {
  class: "notes",
  id: "tab-notes-panel",
  role: "tabpanel",
  "aria-labelledby": "tab-notes",
  hidden: true,
});
/** What Claude changed on the board while the reader was away: said once, over the board, until they have seen it. */
const visitBar = h("div", { class: "visit-bar", role: "status", hidden: true });
const canvas = h("div", { class: "canvas" });
/** The card chosen on the board, as it reads in full: shown while a card is chosen, folded on demand. */
const cardPanel = h("section", {
  class: "card-panel",
  id: "tab-detail-panel",
  role: "tabpanel",
  "aria-labelledby": "tab-detail",
  hidden: true,
});

// ── The right panel's tabs: what Claude's session does, and the chosen card ───

/** What the page said on its own; an error is said until resolved, or dismissed. */
const notices = mountNotices(() => {
  state.error = null;
});
const { spoken, say, speak } = notices;
let tab: Tab = "session";
/** The tab the reader was on before Detail opened for a card: given back when the card is left. */
let tabBack: Tab | undefined;
/** The card the Detail tab was last opened for: a new choice opens it again, a repaint does not. */
let detailFor: string | null = null;

/** On the Notes tab: how many discussions are open; marked when one waits for the reader's answer. */
const notesCount = h("span", { class: "tab-count", hidden: true });
const tabButtons: Record<Tab, HTMLButtonElement> = Object.fromEntries(
  TABS.map((id) => [
    id,
    h(
      "button",
      {
        type: "button",
        role: "tab",
        class: "tab",
        id: `tab-${id}`,
        "aria-label": id === "notices" ? tabName(id) : undefined,
        "aria-controls": `tab-${id}-panel`,
        onclick: () => chooseTab(id),
      },
      tabIcon(id),
      h("span", { class: "tab-label" }, tabName(id)),
      id === "notes" && notesCount,
      id === "notices" && notices.count,
    ),
  ]),
) as Record<Tab, HTMLButtonElement>;
const tabList = h(
  "div",
  { class: "tabs", role: "tablist", "aria-label": t.sidePanel },
  ...TABS.map((id) => tabButtons[id]),
);

/** A tab chosen opens the panel too: from the rail, it is the way back in. */
function chooseTab(id: Tab, focus = false): void {
  if (tabButtons[id].getAttribute("aria-disabled") === "true") return;
  tab = id;
  tabBack = undefined;
  if (isFolded("right")) toggleFold("right");
  paintTabs();
  if (focus) tabButtons[id].focus();
}

/** Opens the Detail tab, keeping the one it replaces to give it back. */
function openDetailTab(): void {
  if (tab !== "detail") tabBack = tab;
  tab = "detail";
}

function paintTabs(): void {
  const can: Record<Tab, boolean> = {
    session: true,
    notes: true,
    history: true,
    notices: true,
    detail: !cardPanel.dataset.empty,
  };
  // The card left, the reader gets back the tab they were on before its detail.
  if (!can[tab]) {
    tab = tabBack ?? "session";
    tabBack = undefined;
  }
  for (const id of TABS) {
    const button = tabButtons[id];
    const chosen = id === tab;
    button.setAttribute("aria-selected", String(chosen));
    button.tabIndex = chosen ? 0 : -1;
    if (can[id]) button.removeAttribute("aria-disabled");
    else button.setAttribute("aria-disabled", "true");
    if (id !== "notes") button.title = can[id] ? tabName(id) : t.detailTabEmpty;
  }
  fitTabs();
  sessionPanel.hidden = tab !== "session";
  notes.hidden = tab !== "notes";
  historyPanel.hidden = tab !== "history";
  notices.panel.hidden = tab !== "notices";
  cardPanel.hidden = tab !== "detail";
  notices.paint();
}

const fitTabs = (): void => fitTabsIn(tabList, isFolded("right"));
new ResizeObserver(() => fitTabs()).observe(tabList);

tabKeys(
  tabList,
  tabButtons,
  () => tab,
  (next) => chooseTab(next, true),
);
const historyLabel = h("output", { class: "history-label" });
/** The events, newest first: a click shows the board as that event left it. Repainted on its own. */
const historyList = h("ol", { class: "history-list", "aria-label": t.history });
/** The reader asked the history for every event, not only the board's. Kept while the page is open. */
let wholeJournal = false;
const historyScope = h(
  "select",
  {
    name: "history-scope",
    "aria-label": t.historyScope,
    onchange: () => {
      wholeJournal = historyScope.value === "everything";
      changed();
    },
  },
  h("option", { value: "board" }, t.thisBoard),
  h("option", { value: "everything" }, t.everything),
);
/** The board's history, a tab of the right panel: where it stands, how far it reaches, and its events. */
const historyPanel = h(
  "section",
  {
    class: "history-panel",
    id: "tab-history-panel",
    role: "tabpanel",
    "aria-labelledby": "tab-history",
    hidden: true,
  },
  h(
    "div",
    { class: "history" },
    h(
      "button",
      { type: "button", "aria-label": t.previousEvent, title: t.previousEvent, onclick: () => step(-1) },
      "◄",
    ),
    h(
      "button",
      { type: "button", "aria-label": t.nextEvent, title: t.nextEvent, onclick: () => step(1) },
      "►",
    ),
    historyScope,
    historyLabel,
  ),
  historyList,
);
/** How many of the latest events the list shows; "Earlier" shows more. */
const HISTORY_PAGE = 200;
let historyShown = HISTORY_PAGE;

// In the list, ↑ goes to a newer moment, ↓ to an older one, and the keyboard follows.
historyList.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  step(event.key === "ArrowUp" ? 1 : -1);
  keepHistoryFocus = true;
});
/** The list is repainted under the keyboard: it goes back to the moment shown. */
let keepHistoryFocus = false;

/** What the bar says of the turn. Repainted apart from the message beside it. */
const turnSays = h("div", { class: "turn-says" });
/** Made once: a message being typed for Claude keeps its words and the keyboard through every repaint. */
const passMessage = messageField(t.messagePlaceholder, t.messageForClaude);
/** With a choice of sessions, the one the turn goes to, said on the button itself (S337). */
const passName = h("span", { class: "pass-name", hidden: true });
const passButton = h("button", { type: "submit", class: "primary" }, t.handOver, passName);
/** The board the turn is handed over on: the one on screen. */
let passOn: string | undefined;
/** ⌘↵ in a field of the Notes tab: once its words are saved, the turn goes to Claude with them (T208). */
function handOverAfter(): void {
  const before = state.gestures;
  void settled().then(() => state.gestures > before && passButton.form?.requestSubmit(passButton));
}
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
        // The turn goes to the session the page tells about: the one chosen at the top, else the board's.
        const to = shownSession(state.live, passOn, state.sessionId ?? undefined);
        void send({
          kind: "pass",
          board: passOn,
          to: "agent",
          message: passMessage.value.trim() || undefined,
          ...(to ? { target: to.id } : {}),
        });
        passMessage.value = "";
        // The page cannot wake a terminal at rest: say what will make Claude read this.
        const notice = handOverNotice(to?.status, state.listening, locale);
        if (notice) say(notice);
      },
    },
    passMessage,
    passButton,
  ),
);
/** The first stop of the keyboard: straight to the board, past the header and the palette. */
const skip = h(
  "a",
  {
    class: "skip",
    href: "#board",
    onclick: (event: Event) => {
      event.preventDefault();
      // No card yet: to what adds one, a kind of card on a board; on the home page, the first board, else a workshop.
      const to =
        canvas.querySelector<SVGGElement>('g.card[tabindex="0"]') ??
        palette.querySelector<HTMLButtonElement>("button.type:not(:disabled)") ??
        home.querySelector<HTMLButtonElement>(".board-tile, button.format:not(:disabled)");
      to?.focus();
    },
  },
  t.skipToBoard,
);

/** The card chosen, its Detail tab opened, and the panel with it if it was folded. */
function showDetail(id: string): void {
  // Not by chooseTab: the Detail tab is quiet until the repaint learns of the card.
  state.selected = id;
  openDetailTab();
  if (isFolded("right")) toggleFold("right");
  render();
}

const view = mountBoard(canvas, {
  removed: (said) => say(said, undoOffer()),
  announce: speak,
  notice: (text) => say(text),
  editDetail: (id) => editDetail(id, "card"),
  showNotes: (id) => showNotes(id),
  showDetail,
  editLabels: (id) => {
    showDetail(id);
    refocusLabelField();
  },
});
// Escape in the field that adds a label, empty: the keyboard goes back to the card.
onLabelsLeft((id) => id && view.focus(id));

/** The search over the cards of every board: `/` or Ctrl+K opens it. */
const find = mountFind({ view, open: openBoard });

// ── Side panels, folded into rails ───────────────────────────────────────────

type Side = "left" | "right";
const FOLDED = "sideco.folded";
/** Under this width, both panels fold of themselves: the board keeps the room. */
const NARROW = window.matchMedia("(max-width: 1100px)");

/** What the reader folded, kept by this browser. The page works the same without it. */
const chosenFolds: Record<Side, boolean> = (() => {
  try {
    const kept = JSON.parse(localStorage.getItem(FOLDED) ?? "{}") as Partial<Record<Side, boolean>>;
    return { left: kept.left === true, right: kept.right === true };
  } catch {
    return { left: false, right: false };
  }
})();
/** A narrow window folds both; what the reader then unfolds holds until the window changes again. */
let narrowFolds: Record<Side, boolean> | undefined = NARROW.matches ? { left: true, right: true } : undefined;
/** The right panel was unfolded by a card chosen in a narrow window: it folds back when the card is left. */
let unfoldedForCard = false;

const foldButton = (side: Side): HTMLButtonElement =>
  h("button", {
    type: "button",
    class: "fold quiet",
    "aria-controls": `panel-${side}`,
    onclick: () => toggleFold(side),
  }) as HTMLButtonElement;
const folds: Record<Side, HTMLButtonElement> = { left: foldButton("left"), right: foldButton("right") };

function isFolded(side: Side): boolean {
  return (narrowFolds ?? chosenFolds)[side];
}

function toggleFold(side: Side): void {
  if (side === "right") unfoldedForCard = false;
  if (narrowFolds) narrowFolds[side] = !narrowFolds[side];
  else {
    chosenFolds[side] = !chosenFolds[side];
    try {
      localStorage.setItem(FOLDED, JSON.stringify(chosenFolds));
    } catch {
      // Kept for this page only.
    }
  }
  paintFolds();
}

function paintFolds(): void {
  const work = app?.querySelector(".work");
  for (const side of ["left", "right"] as const) {
    const folded = isFolded(side);
    work?.classList.toggle(`fold-${side}`, folded);
    const button = folds[side];
    button.setAttribute("aria-expanded", String(!folded));
    const label = folded ? t.showPanel[side] : t.hidePanel[side];
    button.setAttribute("aria-label", label);
    button.title = `${label} (${side === "left" ? "<" : ">"})`;
    // The arrow points where the panel goes.
    button.textContent = (side === "left") === folded ? "›" : "‹";
  }
  fitTabs();
}

NARROW.addEventListener("change", () => {
  unfoldedForCard = false;
  narrowFolds = NARROW.matches ? { left: true, right: true } : undefined;
  paintFolds();
});

app.append(
  skip,
  h(
    "header",
    { class: "top" },
    // Three groups: the board, then what Claude is doing, then the view of it.
    h("div", { class: "top-board" }, brand, boardPicker, boardMenu),
    h("div", { class: "top-claude" }, sessionPicker, statusPill, waitsPill),
    h(
      "div",
      { class: "top-view" },
      undoGroup,
      h(
        "div",
        { class: "zoom" },
        h("button", { type: "button", "aria-label": t.zoomOut, onclick: () => zoom(-1) }, "−"),
        zoomLabel,
        h("button", { type: "button", "aria-label": t.zoomIn, onclick: () => zoom(1) }, "+"),
      ),
      languagePicker,
    ),
  ),
  banner,
  h(
    "main",
    { class: "work" },
    h("aside", { class: "left", id: "panel-left" }, folds.left, palette),
    h("section", { class: "stage" }, visitBar, focusBar, chosenBar, filterBar, find.bar, canvas, home),
    h(
      "aside",
      { class: "right", id: "panel-right" },
      folds.right,
      tabList,
      sessionPanel,
      notes,
      historyPanel,
      notices.panel,
      cardPanel,
    ),
  ),
  h("footer", { class: "bottom" }, turnBar),
  notices.bottom,
  newBoardSheet,
  removeSheet,
  keysSheet,
  spoken,
);

paintFolds();

/** The board the history follows: none when the reader asked for everything, or no board is there. */
function historyFollows(): string | undefined {
  return wholeJournal ? undefined : historyBoard(state.events, state.boardId, currentBoard()?.id);
}

function historyStopsShown(): number[] {
  return historyStops(journal(historyPanel.hidden ? state.live.seq : 0), historyFollows());
}

function step(by: -1 | 1): void {
  travelTo(historyStep(historyStopsShown(), state.cursor, by));
}

// A menu open closes as a menu does: on a click elsewhere, or on Escape, which gives its button the keyboard back.
// The card chosen is let go on the stage beside the drawing and on the bare header or footer; panels and controls work on it.
const BARE = ".canvas, header.top, footer.bottom";
const KEEPS =
  ".sideco-board, .card-tools, .card-editor, button, a, input, textarea, select, summary, label, [tabindex]";
document.addEventListener("click", (event) => {
  if (boardMenu.open && !boardMenu.contains(event.target as Node)) boardMenu.open = false;
  const target = event.target as Element;
  if (target.closest(BARE) && !target.closest(KEEPS)) view.letGo();
});
boardMenu.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !boardMenu.open) return;
  event.stopPropagation();
  boardMenu.open = false;
  boardMenu.querySelector("summary")?.focus();
});

function zoom(by: -1 | 1): void {
  zoomLabel.textContent = `${Math.round(view.zoomBy(by) * 100)} %`;
}

function fit(): void {
  zoomLabel.textContent = `${Math.round(view.fit() * 100)} %`;
}

// ── Regions: each repaints only when its own model changes ───────────────────

/** As the reader's keyboard writes them: ⌘ on a Mac, Ctrl elsewhere. */
const SHORTCUTS = /Mac|iPhone|iPad/.test(navigator.platform)
  ? { undo: "⌘Z", redo: "⇧⌘Z", send: "⌘↵" }
  : {
      undo: "Ctrl+Z",
      redo: locale === "fr" ? "Ctrl+Maj+Z" : "Ctrl+Shift+Z",
      send: locale === "fr" ? "Ctrl+Entrée" : "Ctrl+Enter",
    };

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

const paintStatus = region(statusPill, (m: Status) => [
  h("span", { class: `dot tone-${m.tone}`, "aria-hidden": "true" }),
  // What the words leave out is in the tooltip for a pointer, and said after them to who cannot rest one.
  h(
    "span",
    { class: "status-text", title: m.title ?? m.text },
    m.text,
    m.title && h("span", { class: "said-only" }, ` ${m.title}`),
  ),
]);

interface Waits {
  waiting: Waiting | undefined;
  current: string | undefined;
  listening: number;
}

const paintWaits = region(waitsPill, (m: Waits) => {
  const w = m.waiting;
  const here = w?.board === m.current;
  const notice = w && waitsNotice(w, here, m.listening, locale);
  if (!w || !notice) return [];
  return [
    h(
      "button",
      {
        type: "button",
        class: notice.blocked ? "quiet is-blocked" : "quiet",
        "data-board": w.board,
        title: w.message,
        // Pressed, it leads to the board and says why: Claude's words, wherever the reader was.
        onclick: () => {
          if (!here) openBoard(w.board);
          say(w.message ? `${t.theirTurn}${t.colon} ${w.message}` : t.theirTurn);
        },
      },
      h("span", { class: "waits-dot", "aria-hidden": "true" }),
      notice.text,
      w.others > 0 && h("span", { class: "waits-more" }, ` +${w.others}`),
    ),
  ];
});

interface BoardMenuModel {
  board: { id: string; title: string } | undefined;
  live: boolean;
}

const paintBoardMenu = region(boardMenu, (m: BoardMenuModel) => [
  h("summary", { title: t.boardMenu, "aria-label": t.boardMenu }, "⋯"),
  h(
    "div",
    { class: "menu-items" },
    h(
      "button",
      {
        type: "button",
        onclick: () => {
          boardMenu.open = false;
          openNewBoard();
        },
      },
      t.newBoardItem,
    ),
    h("p", { class: "menu-heading" }, t.export),
    ...EXPORT_FORMATS.map((format) =>
      h(
        "button",
        { type: "button", disabled: !m.board, onclick: () => exportAs(format) },
        t.exportAs[format],
      ),
    ),
    h("button", { type: "button", disabled: !m.board, onclick: () => void copyMermaid() }, t.copyMermaid),
    h("p", { class: "menu-note" }, t.publishAll),
    m.board &&
      h(
        "button",
        {
          type: "button",
          class: "remove-board",
          title: t.removeBoard(m.board.title),
          disabled: !m.live,
          onclick: () => {
            const id = m.board?.id;
            boardMenu.open = false;
            if (id) askToRemove(id, (title) => say(t.boardRemoved(title), undoOffer()));
          },
        },
        t.removeBoardItem,
      ),
  ),
]);

/** A plan's axes as the board shows them, renamed or the workshop's: the keys say them by these names. */
function axesNamed(board: Board | undefined): { x: string; y: string } | undefined {
  const format = board ? findFormat(board.format) : undefined;
  const x = format && board ? planAxis(format, board, "x", locale) : undefined;
  const y = format && board ? planAxis(format, board, "y", locale) : undefined;
  return x && y ? { x: x.label.toLowerCase(), y: y.label.toLowerCase() } : undefined;
}

/** A plan's axes as the board names them, when it names one of them itself; otherwise undefined. */
function ownAxes(board: Board | undefined): { x: string; y: string } | undefined {
  const format = board ? findFormat(board.format) : undefined;
  if (!board || !format?.grid || !(board.axes?.x || board.axes?.y)) return undefined;
  const x = planAxis(format, board, "x", locale);
  const y = planAxis(format, board, "y", locale);
  return x && y ? { x: x.label, y: y.label } : undefined;
}

const paintPalette = region(palette, (m: PaletteModel) =>
  paletteContent(m, {
    add: (type) => view.beginAdd(type),
    keys: () => openKeys(currentBoard(), axesNamed(currentBoard())),
    snap: (on) => view.snap(on),
  }),
);

interface NotesModel {
  board: string | undefined;
  live: boolean;
  /** The selected card: its discussions stand out. */
  selected: string | null;
  threads: Discussion[];
  /** Closed, kept within reach: what was decided stays readable. */
  resolved: Discussion[];
  /** The discussions that carry a note Claude has not read. */
  unread: string[];
}

/** The resolved discussions are open to read while the reader keeps them so: a repaint does not fold them back. */
let resolvedOpen = false;

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
    handOverAfter,
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
    m.resolved.length > 0 &&
      h(
        "details",
        {
          class: "resolved",
          open: resolvedOpen,
          ontoggle: (event: Event) => {
            resolvedOpen = (event.target as HTMLDetailsElement).open;
          },
        },
        h("summary", {}, t.resolvedNotes(m.resolved.length)),
        h(
          "ul",
          { class: "note-list" },
          ...m.resolved.map((thread) => threadItem(boardId, thread, { ...m, live: false }, true)),
        ),
      ),
  ];
});

function threadItem(boardId: string, thread: Discussion, m: NotesModel, resolved = false): HTMLElement {
  const on = thread.on;
  const key = draftKey(boardId, thread.id);
  const field = wordsField(
    { name: `reply-${thread.id}`, placeholder: t.replyPlaceholder, "aria-label": t.replyTo(thread.id) },
    drafts.get(key) ?? "",
    (words) => {
      drafts.set(key, words);
      offer();
    },
    handOverAfter,
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
  // Answering a note shows its card, as its title does: the keyboard stays in the answer.
  field.addEventListener("focus", () => {
    if (on?.label !== undefined && state.selected !== on.id) selectFromNotes(on.id);
  });
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
      // A resolved discussion is named apart: what speaks of an open one never lands on a closed one.
      [resolved ? "data-resolved" : "data-thread"]: thread.id,
      "data-on": on?.id,
      id: `thread-${thread.id}`,
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
        onclick: () => selectFromNotes(on?.id),
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
    !resolved &&
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

/** Opens the Notes tab, the panel too when folded; given a card, its first discussion is brought into view. */
function showNotes(card?: string): void {
  tab = "notes";
  // The card being chosen by the same click keeps the reader here, not in its detail.
  if (card) detailFor = card;
  if (isFolded("right")) toggleFold("right");
  render();
  if (!card) return;
  const item = [...notes.querySelectorAll<HTMLElement>(".thread[data-thread]")].find(
    (thread) => thread.dataset.on === card,
  );
  item?.scrollIntoView({ block: "nearest" });
}

/**
 * The Notes tab, said: how many discussions are open, and a mark while one waits for the reader.
 * A note Claude adds, that waits for them, opens the tab on its own, unless the reader is writing
 * elsewhere. The discussions already waiting when the board is first shown do not.
 */
let waitingSeen: { board: string; notes: Set<string> } | undefined;
function paintNotesTab(board: string | undefined, threads: Discussion[], live: boolean): void {
  const yours = threads.filter((thread) => thread.waits === "you");
  notesCount.hidden = threads.length === 0;
  notesCount.textContent = String(threads.length);
  notesCount.classList.toggle("is-yours", yours.length > 0);
  tabButtons.notes.title = t.notesTab(threads.length, yours.length);
  tabButtons.notes.setAttribute("aria-label", t.notesTab(threads.length, yours.length));
  const latest = yours.map((thread) => thread.notes.at(-1)?.id ?? thread.id);
  if (!board || !live || !caughtUpYet()) return;
  if (waitingSeen?.board !== board) {
    waitingSeen = { board, notes: new Set(latest) };
    return;
  }
  const arrived = latest.filter((id) => !waitingSeen?.notes.has(id));
  for (const id of latest) waitingSeen.notes.add(id);
  if (arrived.length === 0 || tab === "notes" || writingElsewhere()) return;
  tab = "notes";
  tabBack = undefined;
  if (isFolded("right")) toggleFold("right");
  // Opened without being asked: said, so a screen reader is not left on a panel that changed.
  speak(t.notesOpened);
}

/** The reader writes outside the notes: a detail, a card's name, a message to Claude. */
function writingElsewhere(): boolean {
  const active = document.activeElement;
  const typing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
  return (typing && !notes.contains(active)) || detailEdit !== undefined;
}

/** Brings the selected card's first discussion into view, once per selection. */
let shownFor: string | null = null;
function revealThreads(selected: string | null): void {
  if (selected === shownFor) return;
  shownFor = selected;
  notes.querySelector(".thread.is-current")?.scrollIntoView({ block: "nearest" });
}

interface CardPanelModel extends LabelsModel {
  /** The ids it went by, renumbered since: "formerly T1". */
  former: string | undefined;
  label: string;
  type: string | undefined;
  /** Who added it, who changed it last and when, and whether it is done (S311). */
  facts: string;
  /** None while it is being written: the field holds the words then. */
  detail: string | undefined;
  editing: boolean;
  saving: boolean;
  /** The card's open discussions: said under its detail, a click away in the Notes tab. */
  notes: number;
  /** Pointed at, by Claude or by the reader (S334). */
  inFocus: boolean;
  /** Its links, each way, for the keyboard (S310). */
  links: LinkRow[];
}

/** The detail being written in the panel: its card, and where the keyboard was when it was asked for. */
let detailEdit: { id: string; from: "card" | "panel" } | undefined;
// A card given a new id keeps the words being written on it, and the keyboard (T224).
onRenumbered((r) => {
  if (r.board === state.boardId && detailEdit?.id === r.id) detailEdit = { ...detailEdit, id: r.to };
  if (r.board === state.boardId) view.renamed(r.id, r.to);
});
/** Made once: the words being written keep their place and the keyboard through every repaint. */
const detailField = h("textarea", {
  name: "detail",
  class: "card-panel-editor",
  rows: 3,
  "aria-describedby": "detail-keys",
});
const fitDetailField = (): void => {
  detailField.style.height = "auto";
  detailField.style.height = `${detailField.scrollHeight + 2}px`;
};
detailField.addEventListener("input", fitDetailField);
detailField.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeDetail();
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void saveDetail();
  }
});
let detailSaving = false;

const paintCardPanel = region(cardPanel, (m: CardPanelModel) => [
  h("h2", {}, t.cardPanelOf(m.id)),
  m.former && h("p", { class: "hint card-panel-former" }, m.former),
  h("p", { class: "card-panel-name" }, m.label),
  m.type !== undefined && h("p", { class: "hint" }, m.type),
  m.facts && h("p", { class: "hint card-panel-facts" }, m.facts),
  m.notes > 0 &&
    h(
      "button",
      { type: "button", class: "quiet card-panel-notes", onclick: () => showNotes(m.id) },
      tabIcon("notes"),
      t.cardNotes(m.notes),
    ),
  labelSection(m, speak),
  m.live && !m.editing && focusButton(m.id, m.inFocus),
  ...(m.editing
    ? [
        detailField,
        h("p", { class: "hint card-panel-keys", id: "detail-keys" }, t.detailKeys),
        h(
          "div",
          { class: "card-panel-actions" },
          h(
            "button",
            { type: "button", class: "primary", disabled: m.saving, onclick: () => void saveDetail() },
            t.saveDetail,
          ),
          h("button", { type: "button", disabled: m.saving, onclick: () => closeDetail() }, t.cancel),
        ),
      ]
    : [
        m.detail
          ? h("div", { class: "card-panel-detail" }, ...markdownNodes(m.detail))
          : h("p", { class: "hint card-panel-detail" }, t.noDetail),
        m.live &&
          h(
            "button",
            { type: "button", class: "edit-detail", onclick: () => editDetail(m.id, "panel") },
            m.detail ? t.editDetail : t.addDetail,
          ),
      ]),
  linkSection(m.links, m.live, WORDS[locale].links),
]);

/** Opens the card's detail for writing, in the panel: the words from their first line, the keyboard in them. */
function editDetail(id: string, from: "card" | "panel"): void {
  const element = currentBoard()?.elements.find((e) => e.id === id);
  if (!element || !isLive()) return;
  if (detailEdit?.id !== id) detailField.value = element.detail ?? "";
  detailEdit = { id, from };
  detailField.setAttribute("aria-label", t.detailOf(id));
  // Written in the Detail tab: it is opened, and the panel with it if it was folded.
  openDetailTab();
  if (isFolded("right")) toggleFold("right");
  render();
  fitDetailField();
  detailField.focus();
  detailField.setSelectionRange(0, 0);
  detailField.scrollTop = 0;
}

/** Leaves the detail as it was, and gives the keyboard back where it was taken from. */
function closeDetail(): void {
  const edit = detailEdit;
  detailEdit = undefined;
  render();
  if (!edit) return;
  if (edit.from === "panel") cardPanel.querySelector<HTMLButtonElement>("button.edit-detail")?.focus();
  else view.focus(edit.id);
}

/** Keeps the words written: nothing is sent when they say what the card already says. */
async function saveDetail(): Promise<void> {
  const edit = detailEdit;
  const board = currentBoard();
  const element = board?.elements.find((e) => e.id === edit?.id);
  if (!edit || !board || !element || detailSaving) return;
  const detail = keptLines(detailField.value);
  if (detail === (element.detail ?? "")) {
    closeDetail();
    return;
  }
  detailSaving = true;
  render();
  const done = await send({ kind: "annotate", board: board.id, id: edit.id, detail });
  detailSaving = false;
  if (done === undefined) {
    // Refused or not sent: the words stay, to be saved again or cancelled.
    render();
    detailField.focus();
    return;
  }
  closeDetail();
  speak(t.detailSaved(edit.id));
}

interface TurnModel {
  board: string | undefined;
  live: boolean;
  pending: number;
  hint: string;
  theirs: string | undefined;
  /** The session a hand-over would go to, by its name; none when no session runs. */
  to: string | undefined;
  /** Several sessions run: the one the turn goes to is worth saying on the button, not only in its tooltip. */
  several: boolean;
  /** The ids on the board shown, of cards and of notes: those Claude's words can lead to. */
  known: string[];
}

const paintTurnSays = region(turnSays, (m: TurnModel) => {
  const count = m.pending === 0 ? t.upToDate : t.pending(m.pending);
  return [
    m.theirs !== undefined &&
      h(
        "p",
        // Cut at two lines on the page; the pointer reads the rest.
        { class: "theirs", title: m.theirs || undefined },
        h("strong", {}, t.theirTurn),
        m.theirs ? `${t.colon} ` : "",
        ...linked(m.theirs, m.known),
      ),
    // When Claude has read everything, when it will read is beside the point.
    h("p", { class: "pending" }, h("strong", {}, count), m.pending > 0 ? ` · ${m.hint}` : ""),
  ];
});

/** Claude's words, with each card or discussion they name made a link to it. */
function linked(text: string, known: string[]): (string | HTMLElement)[] {
  return mentions(text, new Set(known)).map((piece) =>
    typeof piece === "string"
      ? piece
      : h("button", { type: "button", class: "mention", onclick: () => goTo(piece.id) }, piece.id),
  );
}

/** Leads to what an id names: a card is selected on the board, a discussion opened in the notes. */
function goTo(id: string): void {
  const board = currentBoard();
  if (!board) return;
  if (board.elements.some((e) => e.id === id)) {
    select(id);
    view.focus(id);
    return;
  }
  const thread = board.notes.find((n) => n.id === id);
  const opening = thread?.thread ?? thread?.id;
  if (!opening) return;
  if (board.notes.find((n) => n.id === opening)?.resolved) {
    resolvedOpen = true;
    notes.querySelector<HTMLDetailsElement>("details.resolved")?.setAttribute("open", "");
  }
  showNotes();
  const item = document.getElementById(`thread-${opening}`);
  item?.scrollIntoView({ block: "nearest" });
  item?.classList.add("is-called");
  setTimeout(() => item?.classList.remove("is-called"), 2400);
}

function paintTurn(m: TurnModel): void {
  paintTurnSays(m);
  passOn = m.board;
  passMessage.disabled = passButton.disabled = !m.live || !m.board;
  const to = m.to !== undefined ? ` · ${t.handOverTo} ${m.to}` : "";
  passButton.title = `${t.withKey(t.handOver, SHORTCUTS.send)}${to}`;
  passName.textContent = m.several && m.to !== undefined ? ` · ${m.to}` : "";
  passName.hidden = passName.textContent === "";
}

interface HistoryModel {
  live: boolean;
  label: string;
  /** The history follows a board; otherwise it steps through every event. */
  board: boolean;
  /** False when the reader wants a board and none is there to follow. */
  choice: boolean;
}

function paintHistory(m: HistoryModel): void {
  historyLabel.textContent = m.label;
  historyScope.value = m.board ? "board" : "everything";
  historyScope.disabled = !m.choice;
}

// ── What changed while the reader was away ───────────────────────────────────

/** Where the journal stood the last time each board was on screen in this browser. */
const SEEN = "sideco.seen";

function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeSeen(board: string, seq: number): void {
  try {
    const seen = readSeen();
    if (seen[board] === seq) return;
    seen[board] = seq;
    localStorage.setItem(SEEN, JSON.stringify(seen));
  } catch {
    // Without storage, every visit is a first one: nothing is marked.
  }
}

/** The visit under way: the board, the reader's last look before it, their return, and what changed between. */
let visit: { board: string; since: number; until: number; count: number; cards: string[] } | undefined;

/** A board comes on screen: what Claude did there since it was last seen is measured once, for this visit. */
function arrive(board: string, latest: number): void {
  const since = readSeen()[board];
  const found =
    since !== undefined && since < latest ? sinceLastVisit(state.events, board, since, latest) : undefined;
  visitAt = -1;
  visit = {
    board,
    since: since ?? latest,
    until: latest,
    count: found?.count ?? 0,
    cards: found?.cards ?? [],
  };
}

function seeVisit(): void {
  if (visit) visit = { ...visit, count: 0, cards: [] };
  render();
}

/** The changed card the bar went to last: the next press goes on to the one after. */
let visitAt = -1;
function nextChanged(): void {
  const cards = visit?.cards ?? [];
  if (cards.length === 0) return;
  visitAt = (visitAt + 1) % cards.length;
  const id = cards[visitAt];
  if (id === undefined) return;
  select(id);
  view.focus(id);
}

const paintVisit = region(visitBar, (m: { count: number; cards: number }) =>
  m.count === 0
    ? []
    : [
        h("span", {}, t.sinceVisit(m.count)),
        h(
          "span",
          { class: "visit-actions" },
          m.cards > 0 &&
            h("button", { type: "button", class: "quiet", onclick: nextChanged }, t.nextChanged(m.cards)),
          h(
            "button",
            {
              type: "button",
              class: "quiet",
              onclick: () => {
                tab = "history";
                if (isFolded("right")) toggleFold("right");
                render();
              },
            },
            t.seeInHistory,
          ),
          h("button", { type: "button", onclick: seeVisit }, t.gotIt),
        ),
      ],
);

interface HistoryListModel {
  live: boolean;
  /** The moment shown, or null when live. */
  current: number | null;
  more: number;
  moments: { seq: number; to: number | null; at: string; by: string; text: string; missed: boolean }[];
}

const paintHistoryList = region(historyList, (m: HistoryListModel) => {
  const shown = (seq: number, k: number): boolean => (m.current === null ? k === 0 : seq === m.current);
  const items = m.moments.map((moment, k) =>
    h(
      "li",
      {},
      h(
        "button",
        {
          type: "button",
          class: `moment by-${moment.by || "none"}${moment.missed ? " moment-missed" : ""}`,
          "aria-current": shown(moment.seq, k) ? "step" : undefined,
          "aria-description": moment.missed ? t.changedSinceVisit : undefined,
          onclick: () => travelTo(moment.to),
        },
        k === 0 && h("span", { class: "moment-live" }, m.live ? t.liveNow : t.backToLive),
        moment.at && h("time", {}, moment.at),
        h("span", { class: "moment-text" }, moment.text),
      ),
    ),
  );
  return [
    ...items,
    m.more > 0 &&
      h(
        "li",
        {},
        h(
          "button",
          {
            type: "button",
            class: "quiet history-more",
            onclick: () => {
              historyShown += HISTORY_PAGE;
              changed();
            },
          },
          t.earlier(m.more),
        ),
      ),
  ];
});

// ── Actions ──────────────────────────────────────────────────────────────────

function select(id: string | undefined): void {
  if (!id) return;
  state.selected = id;
  changed();
  view.reveal(id);
}

/** A card chosen from its discussion: shown on the board, and the reader stays in the Notes tab. */
function selectFromNotes(id: string | undefined): void {
  if (!id) return;
  detailFor = id;
  select(id);
}

function exportAs(format: ExportFormat): void {
  const board = currentBoard();
  if (!board) return;
  downloadBoard(board, format);
  boardMenu.open = false;
}

async function copyMermaid(): Promise<void> {
  const board = currentBoard();
  if (!board) return;
  say((await copiedMermaid(board)) ? t.mermaidCopied : t.clipboardRefused);
  boardMenu.open = false;
}

/**
 * Takes back the human's latest gesture: on the board shown, or the removal of a
 * board if that came after; one Claude changed since, once asked (B8). Never Claude's own.
 */
async function undo(ifChanged?: "overwrite"): Promise<void> {
  const board = isLive() ? undoTarget(state.live, state.boardId ?? undefined) : undefined;
  if (!board) return;
  // Said once taken back: who does not see the board change hears what came back.
  const gesture = lastGesture(board);
  if (gesture?.blocked && !ifChanged) return askBeforeUndo(board, gesture, () => void undo("overwrite"));
  const event = gesture && state.events.find((e) => e.seq === gesture.seq);
  if (await send({ kind: "undo", board, ifChanged }))
    speak(t.undone(event ? describeEvent(event, locale) : board));
}

/** Undo, offered beside what was just done: it holds until the reader's next gesture, which Undo would take back instead. */
function undoOffer(): Offer {
  const at = state.gestures;
  return { label: t.undoAction, run: () => void undo(), holds: () => state.gestures === at };
}

async function redo(): Promise<void> {
  const board = isLive() ? redoTarget(state.live, state.boardId ?? undefined) : undefined;
  if (board && (await send({ kind: "redo", board }))) speak(t.redone);
}

// The keys of the whole page: what each one does here, which key asks for it in page-keys.ts.
mountPageKeys({
  find: () => {
    if (shown().boards.length === 0) return false;
    find.open();
    return true;
  },
  keys: () => openKeys(currentBoard(), axesNamed(currentBoard())),
  focus: pointAtChosen,
  fold: toggleFold,
  undo: () => void undo(),
  redo: () => void redo(),
  send: () => {
    if (passButton.disabled) return false;
    passButton.form?.requestSubmit(passButton);
    return true;
  },
});

/** Meets each build the companion serves: a reload when no words would be lost, else an offer. */
const meet = meetUpdates(say, () => [...drafts.values()].some((text) => text !== ""));

// ── The paint ────────────────────────────────────────────────────────────────

function render(): void {
  keepChosen(currentBoard()?.id);
  const ws = shown();
  const board = currentBoard();
  const session = currentSession();
  const live = isLive();
  // What Claude would be told, for the session the page tells about: the one chosen, else the board's.
  const liveSession = shownSession(state.live, board?.id, state.sessionId ?? undefined);
  const pending = pendingChanges(journalFor(liveSession), liveSession);
  // The marks tell about now: a board shown as it was carries none. They are
  // measured against the session the board is for, not the last one to speak.
  const unread =
    live && board
      ? unreadOn(
          pendingChanges(journalFor(readerOf(state.live, board.id)), readerOf(state.live, board.id)),
          board.id,
        )
      : { cards: [], threads: [] };

  paintBoardPicker({
    boards: ws.boards.map((b) => ({ id: b.id, title: b.title })),
    current: board?.id,
    live,
  });
  paintSessionPicker(sessionChoices(ws.sessions, session));
  paintStatus(shownStatus(agentStatus(session, live ? state.listening : 0, locale), state, locale));
  paintBoardMenu({ board: board && { id: board.id, title: board.title }, live });
  paintWaits({ waiting: live ? claudeWaits(ws) : undefined, current: board?.id, listening: state.listening });
  const mine = live ? (state.boardId ?? undefined) : undefined;
  paintUndo({
    undo: live && undoTarget(state.live, mine) !== undefined,
    redo: live && redoTarget(state.live, mine) !== undefined,
  });
  paintPalette({
    format: board?.format,
    purpose: board?.purpose,
    axes: ownAxes(board),
    live,
    from: board && findFormat(board.format)?.layout === "graph" ? state.selected : null,
    snap: board && findFormat(board.format)?.layout === "graph" ? board.byHand === true : undefined,
  });
  paintNotes({
    board: board?.id,
    live,
    selected: state.selected,
    threads: board ? discussions(board) : [],
    resolved: board ? resolvedDiscussions(board) : [],
    unread: unread.threads,
  });
  revealThreads(state.selected);
  paintNotesTab(board?.id, board ? discussions(board) : [], live);

  paintFocusBar(board, live, speak);

  canvas.hidden = !board;
  home.hidden = Boolean(board);
  if (!board) paintHome({ boards: boardTiles(ws, live ? claudeWaits(ws)?.board : undefined), live });
  // The board's visit: measured on arrival; the last look moves on while the board is on screen.
  const newest = state.live.seq;
  if (live && board && newest > 0 && caughtUpYet() && heldSince(readSeen()[board.id] ?? newest)) {
    if (visit?.board !== board.id) arrive(board.id, newest);
    if (document.visibilityState === "visible") writeSeen(board.id, newest);
  }
  const away = live && board && visit?.board === board.id ? visit : undefined;
  paintVisit({ count: away?.count ?? 0, cards: away?.cards.length ?? 0 });
  visitBar.hidden = !away?.count;
  view.paint(focusShown(board), unread.cards, away?.cards ?? []);
  paintChosen(canvas, speak);
  paintUnseen(canvas, board);
  paintLabelFilter(board, canvas);
  const landing = arrived(board?.id);
  if (landing) requestAnimationFrame(() => view.focus(landing, true));

  // The card whose detail is being written stays in the panel until it is saved or left.
  if (detailEdit && !board?.elements.some((e) => e.id === detailEdit?.id)) {
    const words = detailField.value.trim();
    if (words) say(t.wordsOrphaned(detailEdit.id, words));
    detailEdit = undefined;
  }
  const editing = live && detailEdit !== undefined;
  const chosen = board?.elements.find((e) => e.id === (editing ? detailEdit?.id : state.selected));
  // A card newly chosen shows its detail when the reader was only watching the session;
  // reading the notes or the history, they stay there. While it stays chosen, the tab is theirs.
  if (chosen && chosen.id !== detailFor && tab === "session") {
    openDetailTab();
    // Folded only because the window is narrow: the detail is shown, until the card is left.
    if (narrowFolds?.right) {
      narrowFolds.right = false;
      unfoldedForCard = true;
      paintFolds();
    }
  }
  if (!chosen && unfoldedForCard && narrowFolds) {
    narrowFolds.right = true;
    unfoldedForCard = false;
    paintFolds();
  }
  detailFor = chosen?.id ?? null;
  if (chosen) delete cardPanel.dataset.empty;
  else cardPanel.dataset.empty = "true";
  cardPanel.classList.toggle("is-editing", editing);
  if (board && chosen) {
    const typing = document.activeElement === detailField;
    const labelling = typingLabel();
    paintCardPanel({
      id: chosen.id,
      former: formerly(chosen.formerIds, locale),
      label: chosen.label,
      type: kindSaid(board, chosen.id, locale),
      facts: cardFacts(board, chosen.id, state.events, locale),
      detail: editing ? undefined : chosen.detail,
      live,
      editing,
      saving: detailSaving,
      notes: discussions(board).filter((thread) => thread.on?.id === chosen.id).length,
      labels: chosen.labels ?? [],
      known: projectLabels(),
      colours: shown().colours ?? {},
      inFocus: board.focus?.ids.includes(chosen.id) ?? false,
      links: linkRows(board, chosen.id),
    });
    if (typing && document.activeElement !== detailField) detailField.focus();
    if (labelling) refocusLabelField();
    refocusLabels(cardPanel, chosen.id, chosen.labels ?? []);
  }

  paintTabs();
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
    live,
    // Cut off from the companion, the page is not live: it says so here too, where "Live" would be.
    label: !state.connected
      ? t.disconnected
      : live
        ? t.live(place.of)
        : place.at === 0
          ? t.beforeFirst
          : `${place.at} / ${place.of}${latest ? ` · ${clock(latest.ts)} · ${describeEvent(latest, locale, state.live)}` : ""}`,
    board: followed,
    choice: wholeJournal || followed,
  });

  paintHistoryList({
    live,
    current: live ? null : (place.seq ?? 0),
    more: Math.max(0, stops.length - historyShown),
    moments: stops
      .slice(-historyShown)
      .reverse()
      .map((seq, k) => {
        const e = seq > 0 ? state.events.find((ev) => ev.seq === seq) : undefined;
        return {
          seq,
          // The newest stop is the present: choosing it is going back to live.
          to: k === 0 ? null : seq,
          at: e ? clock(e.ts) : "",
          by: e?.actor ?? "",
          text: e ? describeEvent(e, locale, state.live) : t.beforeFirst,
          // Claude's, while the reader was away and not yet seen: the list marks them too.
          missed:
            visit !== undefined &&
            visit.count > 0 &&
            e?.actor === "agent" &&
            seq > visit.since &&
            seq <= visit.until,
        };
      }),
  });

  // The moment shown stays in sight in the list, and keeps the keyboard when it had it.
  const current = historyList.querySelector<HTMLButtonElement>('[aria-current="step"]');
  if (!historyPanel.hidden && !live) current?.scrollIntoView({ block: "nearest" });
  if (keepHistoryFocus) {
    keepHistoryFocus = false;
    current?.focus();
  }

  banner.hidden = live;
  if (!live && banner.childElementCount === 0) {
    banner.append(
      h("span", {}, t.past),
      h("button", { type: "button", class: "primary", onclick: () => travelTo(null) }, t.backToLive),
    );
  }

  const turn = board ? findBoard(state.live, board.id)?.turn : undefined;
  // The button names the session the turn goes to: the one the page tells about.
  const addressed = live && board ? liveSession : undefined;
  paintTurn({
    board: board?.id,
    live,
    pending: pending.count,
    hint: handOverHint(liveSession?.status, state.listening, locale),
    theirs: turn?.to === "human" ? (turn.message ?? "") : undefined,
    to: addressed ? sessionName(addressed) : undefined,
    several: state.live.sessions.filter((s) => choosable(s, Date.now())).length > 1,
    known: board ? [...board.elements.map((e) => e.id), ...board.notes.map((n) => n.id)] : [],
  });

  notices.showError(state.error);
  notices.paint();
  if (state.notice) {
    say(state.notice);
    state.notice = null;
  }
  meet(state.served);
  // The tab says that Claude waits too: the reader may be looking at another one.
  const waiting = isLive() ? claudeWaits(state.live) : undefined;
  document.title = tabTitle(
    waiting && waitsNotice(waiting, waiting.board === board?.id, state.listening, locale),
    board?.title,
  );
}

onSessionChosen(render);
mountLabelFilter(canvas, { changed: render, speak });
mountLinkHint(canvas, speak);
start(render);
render();
