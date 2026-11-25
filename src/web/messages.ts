/**
 * Everything the page says, in each language. No DOM here: the wording is data,
 * tested like any other rule. A text that takes a value is a function of it.
 */
import type { Actor } from "../domain/events.ts";
import type { ExportFormat } from "../domain/export/index.ts";
import { asLocale, DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";

export interface Messages {
  /** The language's own name, as its speakers write it. */
  languageName: string;
  language: string;

  // The agent, in the status pill and the session panel.
  noSession: string;
  idle: string;
  thinking: string;
  running: (what: string | undefined) => string;
  waitingInTerminal: (tool?: string) => string;
  listening: string;
  disconnected: string;
  /** A save still waiting for the companion's answer. */
  saving: string;
  /** A save the companion did not answer in time, or could not be reached for. */
  noAnswer: string;
  unreachable: string;

  // When the agent will read the human's changes.
  hintListening: string;
  hintNoSession: string;
  hintWorking: string;
  hintIdle: string;
  handedOverNoSession: string;
  handedOverWorking: string;
  handedOverIdle: string;

  // The header.
  boardShown: string;
  /** The picker of the Claude Code session the page tells about, when more than one is open. */
  sessionShown: string;
  newBoardButton: string;
  showPanel: Record<"left" | "right", string>;
  hidePanel: Record<"left" | "right", string>;
  boardMenu: string;
  newBoardItem: string;
  removeBoardItem: string;
  zoomOut: string;
  zoomIn: string;
  /** The tooltip of Undo and of Redo; `keys` is the shortcut as the reader's keyboard writes it. */
  undo: (keys: string) => string;
  redo: (keys: string) => string;
  /** The words on the two buttons; the first also offers to take a board removal back. */
  undoAction: string;
  redoAction: string;
  export: string;
  exportAs: Record<ExportFormat, string>;
  copyMermaid: string;
  publishAll: string;
  mermaidCopied: string;
  clipboardRefused: string;

  // The palette.
  palette: string;
  add: (type: string) => string;
  /** The "+" on the edge between two steps of a timeline. */
  insertColumn: string;
  addLane: string;
  removeLane: (name: string) => string;
  laneHeading: (name: string, count: number) => string;
  laneKeys: string;
  laneMovedTo: (name: string, position: number, of: number) => string;
  laneNotEmpty: (name: string) => string;
  laneRemoved: (name: string) => string;
  removeStep: (col: number) => string;
  stepRemoved: (col: number) => string;
  howGraphFrom: (id: string) => string;
  /** The placeholder of a new card: its type, then what that type is for. */
  newCard: (type: string, hint: string) => string;

  // Notes and focus.
  notes: string;
  openNotes: (count: number) => string;
  wholeBoard: string;
  cardGone: (id: string) => string;
  author: Record<Actor, string>;
  waits: Record<"you" | "claude", string>;
  replyTo: (id: string) => string;
  showCard: (id: string) => string;
  replyPlaceholder: string;
  reply: string;
  notePlaceholder: string;
  newNote: string;
  addNote: string;
  resolve: string;
  replyAndResolve: string;
  focus: (ids: string) => string;
  clearFocus: string;

  // The first screen and the new-board dialog.
  emptyTitle: string;
  emptyHint: string;
  newBoard: string;
  title: string;
  boardTitle: string;
  titleExample: string;
  workshop: string;
  cancel: string;
  create: string;

  // Removing the board on screen.
  removeBoard: (title: string) => string;
  removeBoardQuestion: (title: string) => string;
  /** What leaves and what stays, said before the board is removed. */
  removeBoardConsequence: (elements: number) => string;

  // The session panel.
  sessionPanel: string;
  session: string;
  turnInProgress: string;
  earlierSteps: (count: number) => string;
  sessionHint: string;
  /** The panel that shows the card chosen on the board, and what it says of it. */
  cardPanel: string;
  cardPanelOf: (id: string) => string;
  sidePanel: string;
  tabs: Record<"session" | "notes" | "history" | "detail", string>;
  /** The Notes tab says how many discussions are open, and how many wait for the reader. */
  notesTab: (open: number, yours: number) => string;
  /** Said when a note Claude wrote opens the Notes tab on its own. */
  notesOpened: string;
  /** In the detail: the card's open discussions, a click away in the Notes tab. */
  cardNotes: (count: number) => string;
  /** A card's labels, in its name for a screen reader. */
  labelledWith: (labels: string) => string;
  /** The labels of the chosen card, in the Detail tab: their heading, the field that adds one, the button that takes one off. */
  labelsHeading: string;
  addLabel: string;
  removeLabel: (label: string) => string;
  labelsAdded: (labels: string) => string;
  labelRemoved: (label: string) => string;
  liveNow: string;
  earlier: (more: number) => string;
  detailTabEmpty: string;
  noDetail: string;
  editDetail: string;
  addDetail: string;
  saveDetail: string;
  /** Under the detail being written: its keys (as the reader's keyboard writes them), and its markdown. */
  detailKeys: (key: string) => string;
  detailSaved: (id: string) => string;

  // The hand-over.
  messageForClaude: string;
  messagePlaceholder: string;
  upToDate: string;
  pending: (count: number) => string;
  /** On a card or a discussion that carries a change Claude has not read. */
  unread: string;
  /** What Claude changed on the board shown while the reader was away; a card it changed, for the ear. */
  sinceVisit: (count: number) => string;
  seeInHistory: string;
  /** Goes to the changed cards one by one; says how many there are. */
  nextChanged: (cards: number) => string;
  gotIt: string;
  changedSinceVisit: string;
  /** Said in a card's name for a screen reader: what its ≡ and its badge show. */
  hasDetail: string;
  openNotesOn: (count: number) => string;
  theirTurn: string;
  claudeWaits: string;
  claudeWaitsOn: (title: string) => string;
  claudeBlocked: string;
  claudeBlockedOn: (title: string) => string;
  handOver: string;
  /** Beside the button: the session the turn goes to. */
  handOverTo: string;

  // The history.
  history: string;
  previousEvent: string;
  nextEvent: string;
  historyScope: string;
  thisBoard: string;
  everything: string;
  live: (events: number) => string;
  beforeFirst: string;
  past: string;
  backToLive: string;

  // A card's actions.
  cardLabel: string;
  laneName: string;
  /** The editor on what a lane stands for, under its name; emptied, the workshop's words come back. */
  laneHintName: string;
  /** Shown in a lane's heading under the pointer, where a subtitle would go. */
  addLaneHint: string;
  /** The editors on an axis of a plan: its name, and the words at either end. */
  axisName: string;
  axisLow: string;
  axisHigh: string;
  axisKey: (word: string) => string;
  axisEndKey: (bound: "low" | "high", word: string) => string;
  axisKeys: string;
  wordsOrphaned: (id: string, words: string) => string;
  rename: string;
  detail: string;
  link: string;
  /** On a card's toolbar: marks what it stands for as done, and takes the mark off. */
  done: string;
  notDone: string;
  noteForClaude: string;
  /** The card toolbar's ⋯: the actions taken less often. */
  moreActions: string;
  remove: string;
  noteOnPlaceholder: (id: string) => string;
  linkBetween: (src: string, dst: string) => string;
  removeLink: string;
  /** Said once the handle's wire is released: the link made or removed, or no card under it. */
  wired: (link: string | undefined, cut: boolean) => string;
  nameLink: string;
  linkName: string;
  linkNameOf: (src: string, dst: string) => string;

  // News the agent made while the human looked elsewhere.
  agentRemovedBoard: (title: string) => string;
  agentCreatedBoard: (title: string) => string;
  agentRestoredBoard: (title: string) => string;
  /** Said to the reader who just removed a board, beside the offer to undo. */
  boardRemoved: (title: string) => string;

  /** Said in a tab left open across an update of Sideco, when reloading it would lose words; and the offer. */
  updated: string;
  reload: string;

  /** Between a label and what follows it: French puts a space before the colon. */
  colon: string;

  // Reading and writing a card from the keyboard.
  /** The name of the editor, by what it edits. */
  detailOf: (id: string) => string;
  noteOn: (id: string) => string;
  /** How a text of several lines is saved, and left. */
  saveLines: string;
  /** An action with the key that does it too. */
  withKey: (action: string, key: string) => string;
  cardRemoved: (id: string) => string;
  /** The board, as a screen reader names it. */
  boardCards: (title: string) => string;
  /** Where a card is on a timeline, and what is said once it moved somewhere. */
  step: (n: number) => string;
  /** Where a card sits on a timeline, for the ear: its step, its row, and its rank when it shares the cell. */
  cell: (step: number, row: string, rank?: [at: number, of: number]) => string;
  /** A card's links, read to who cannot see the arrows: each end as `id label`, a branch name in brackets. */
  leadsTo: (ends: string) => string;
  comesFrom: (ends: string) => string;
  /** A gesture taken back, or done again, said to who does not see the board change. */
  undone: (what: string) => string;
  redone: string;
  moved: (id: string, place: string) => string;
  skipToBoard: string;

  // Finding one's way on a large board.
  find: string;
  findPlaceholder: string;
  findCount: (at: number, of: number) => string;
  findNone: string;
  findInLabels: string;
  findInDetail: string;
  findInNote: (id: string) => string;
  findMore: (n: number) => string;
  fit: string;
  fitHint: string;
  resolvedNotes: (count: number) => string;
  shortcuts: string;
  /** Each shortcut of the page: the keys, then what they do. */
  /** The keys of the page, as they work on a board laid out this way. */
  /** `doneLast`: done is the last lane, not a mark. `axes`: a plan's axes, by the names the board gives them. */
  shortcutList: (
    how: SheetKind,
    doneLast: boolean,
    axes?: { x: string; y: string },
  ) => [keys: string, does: string][];
  /** What the mouse does there that no key says. */
  mouseList: (how: SheetKind) => [gesture: string, does: string][];
  withTheMouse: string;
  /** The legend of the marks a card wears, in the sheet of keys. */
  onACard: string;
  marks: Record<CardMark, string>;
  /** The switch of a diagram: its cards stay where they are put, or their links place them (S344). */
  snap: { name: string; tip: string };
  close: string;
}

/** The marks a card can wear, each told in the sheet of keys. */
export type CardMark = "detail" | "done" | "notes" | "unread" | "changed";

/** How a board is laid out, as far as its keys and gestures go. */
export type SheetKind = "timeline" | "lanes" | "kanban" | "grid" | "graph";

const plural = (count: number): string => (count > 1 ? "s" : "");

const en: Messages = {
  languageName: "English",
  language: "Language",

  noSession: "No Claude Code session linked",
  idle: "Claude is idle",
  thinking: "Claude is thinking",
  running: (what) => `Claude is running ${what ?? "a tool"}`,
  waitingInTerminal: (tool) => `Claude is waiting for you in the terminal${tool ? ` to allow ${tool}` : ""}`,
  listening: "Claude is waiting for you to send",
  disconnected: "Companion disconnected, reconnecting…",
  saving: "Saving…",
  noAnswer: "The companion did not answer: nothing was saved.",
  unreachable: "The companion is out of reach: nothing was saved.",

  hintListening: "Claude reads them as soon as you send.",
  hintNoSession: "No Claude session here yet: they will be read when one starts.",
  hintWorking: "Claude will read them after its current action.",
  hintIdle: "Claude will read them at your next message in the terminal.",
  handedOverNoSession: "Sent. No Claude session here yet: it will be read when one starts.",
  handedOverWorking: "Sent. Claude will read it after its current action.",
  handedOverIdle: "Sent. Claude is not listening: it will read it at your next message in the terminal.",

  boardShown: "Board shown",
  sessionShown: "Claude session shown",
  newBoardButton: "+ Board",
  showPanel: { left: "Show the palette", right: "Show the side panel" },
  hidePanel: { left: "Fold the palette", right: "Fold the side panel" },
  boardMenu: "Board: new, export, remove",
  newBoardItem: "New board…",
  removeBoardItem: "Remove this board…",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  undo: (keys) => `Undo your last change (${keys})`,
  redo: (keys) => `Redo (${keys})`,
  undoAction: "Undo",
  redoAction: "Redo",
  export: "Export",
  exportAs: {
    md: "Markdown (design note)",
    html: "Standalone HTML page",
    svg: "SVG image",
    mermaid: "Mermaid diagram",
    json: "JSON model (can be imported back)",
  },
  copyMermaid: "Copy the Mermaid",
  publishAll: "Publish everything at once: sideco publish",
  mermaidCopied: "Mermaid copied to the clipboard.",
  clipboardRefused: "The browser refused access to the clipboard; use the Mermaid export.",

  palette: "Cards to add",
  add: (type) => `Add: ${type}`,
  insertColumn: "Insert a column here",
  addLane: "Add a column here",
  removeLane: (name) => `Remove the column ${name}`,
  laneHeading: (name, count) => `Column ${name}, ${count} card${count === 1 ? "" : "s"}`,
  laneKeys:
    "Enter: rename · Shift + Enter: subtitle · Shift and an arrow: move · Delete: remove if empty · + or Alt and an arrow: add a column",
  laneMovedTo: (name, position, of) => `Column ${name} moved: ${position} of ${of}.`,
  laneNotEmpty: (name) => `Column ${name} still has cards: move or remove them first.`,
  laneRemoved: (name) => `Column ${name} removed.`,
  removeStep: (col) => `Remove step ${col}`,
  stepRemoved: (col) => `Step ${col} removed.`,
  howGraphFrom: (id) => `The new card will be linked to ${id}.`,
  newCard: (type, hint) => `${type}: ${hint.toLowerCase()}`,

  notes: "Notes",
  openNotes: (count) => `Open notes (${count})`,
  wholeBoard: "Whole board",
  cardGone: (id) => `${id} (removed)`,
  author: { human: "You", agent: "Claude", system: "Sideco" },
  waits: { you: "Awaits your answer", claude: "Awaits Claude" },
  replyTo: (id) => `Reply to ${id}`,
  showCard: (id) => `Show ${id} on the board`,
  replyPlaceholder: "Reply…",
  reply: "Reply",
  notePlaceholder: "A question, a remark…",
  newNote: "New note",
  addNote: "Add note",
  resolve: "Resolve",
  replyAndResolve: "Reply and resolve",
  focus: (ids) => `Focus: ${ids}`,
  clearFocus: "Clear the focus",

  emptyTitle: "What do you want to model?",
  emptyHint: "Pick a workshop, or ask Claude in the terminal: it will write here while it works.",
  newBoard: "New board",
  title: "Title",
  boardTitle: "Board title",
  titleExample: "Order checkout",
  workshop: "Workshop",
  cancel: "Cancel",
  create: "Create",

  removeBoard: (title) => `Remove the board “${title}”`,
  removeBoardQuestion: (title) => `Remove the board “${title}”?`,
  removeBoardConsequence: (elements) =>
    `${elements === 0 ? "It is empty." : `It holds ${elements} card${plural(elements)}.`} It leaves the page, for you and for Claude. Undo brings it back.`,

  sessionPanel: "Claude Code session",
  session: "Session",
  turnInProgress: "(turn in progress)",
  earlierSteps: (count) => `… ${count} earlier step${plural(count)}`,
  sessionHint: "Claude's steps will appear here as soon as a Claude Code session runs in this project.",
  cardPanel: "Chosen card",
  cardPanelOf: (id) => `Card ${id}`,
  sidePanel: "Side panel",
  tabs: { session: "Session", notes: "Notes", history: "History", detail: "Detail" },
  notesOpened: "Claude wrote a note that waits for you: the Notes tab is open.",
  notesTab: (open, yours) =>
    yours > 0
      ? `Notes: ${open} open, ${yours} awaiting your answer`
      : open > 0
        ? `Notes: ${open} open`
        : "Notes",
  cardNotes: (count) => (count === 1 ? "1 open note on this card" : `${count} open notes on this card`),
  labelledWith: (labels) => `labels ${labels}`,
  labelsHeading: "Labels",
  addLabel: "Add a label: type:bug, @name… (Enter)",
  removeLabel: (label) => `Remove the label ${label}`,
  labelsAdded: (labels) => `Labels added: ${labels}`,
  labelRemoved: (label) => `Label ${label} removed`,
  liveNow: "● Live",
  earlier: (more) => `Earlier… (${more} more)`,
  detailTabEmpty: "Detail: choose a card on the board",
  noDetail: "No detail yet.",
  editDetail: "Edit the detail",
  addDetail: "Add a detail",
  saveDetail: "Save",
  detailKeys: (key) =>
    `${key} saves, Esc cancels. Markdown: **bold**, *italic*, \`code\`, - lists, [words](https://…)`,
  detailSaved: (id) => `Detail of ${id} saved`,

  messageForClaude: "Message for Claude",
  messagePlaceholder: "A word for Claude (optional)",
  upToDate: "Claude is up to date",
  pending: (count) => `${count} change${plural(count)} not read yet`,
  unread: "Not read by Claude yet",
  sinceVisit: (count) => `Since your last visit, Claude made ${count} change${plural(count)} here.`,
  seeInHistory: "See them in History",
  nextChanged: (cards) => `Next changed card (${cards})`,
  gotIt: "Got it",
  changedSinceVisit: "Changed by Claude since your last visit",
  hasDetail: "has a detail",
  openNotesOn: (count) => (count === 1 ? "1 open note" : `${count} open notes`),
  theirTurn: "Your turn",
  claudeWaits: "Claude waits for you",
  claudeWaitsOn: (title) => `Claude waits · ${title}`,
  claudeBlocked: "Claude is blocked on you",
  claudeBlockedOn: (title) => `Claude is blocked · ${title}`,
  handOver: "Send to Claude",
  handOverTo: "To the session",

  history: "Board history",
  previousEvent: "Previous event",
  nextEvent: "Next event",
  historyScope: "The history steps through",
  thisBoard: "This board",
  everything: "Everything",
  live: (events) => `Live · ${events} event${plural(events)}`,
  beforeFirst: "Before the first event",
  past: "You are looking at the past: the board is read-only.",
  backToLive: "Back to live",

  cardLabel: "Title",
  laneName: "Column name",
  laneHintName: "Column subtitle (empty: the workshop's)",
  addLaneHint: "Add a subtitle",
  axisName: "Axis name (empty: the workshop's)",
  axisLow: "Where the axis starts (empty: the workshop's)",
  axisHigh: "Where the axis ends (empty: the workshop's)",
  axisKey: (word) => `Axis ${word}`,
  axisEndKey: (bound, word) =>
    `${bound === "low" ? "Where the axis starts" : "Where the axis ends"}: ${word}`,
  axisKeys: "Enter or F2 writes it",
  wordsOrphaned: (id, words) => `${id} was removed while you were typing. Your words: “${words}”`,
  rename: "Rename",
  detail: "Detail",
  link: "Link",
  done: "Mark done",
  notDone: "Not done",
  noteForClaude: "Note for Claude",
  moreActions: "More actions: link, done, remove",
  remove: "Remove",
  noteOnPlaceholder: (id) => `Note for Claude on ${id}…`,
  linkBetween: (src, dst) => `Link ${src} → ${dst}`,
  removeLink: "Remove the link",
  wired: (link, cut) => (link ? `${link} ${cut ? "removed" : "made"}` : "No card aimed at"),
  nameLink: "Name",
  linkName: "Name of the link, such as yes or no",
  linkNameOf: (src, dst) => `Name of the link ${src} → ${dst}`,

  agentRemovedBoard: (title) => `Claude removed the board “${title}”.`,
  agentRestoredBoard: (title) => `Claude restored the board “${title}”.`,
  boardRemoved: (title) => `Board “${title}” removed.`,
  agentCreatedBoard: (title) => `Claude created the board “${title}”: it is in the board list, at the top.`,

  updated: "Sideco was updated.",
  reload: "Reload",

  colon: ":",

  detailOf: (id) => `Detail of ${id}`,
  noteOn: (id) => `Note for Claude on ${id}`,
  saveLines: "Enter saves, Shift + Enter starts a new line, Esc cancels",
  withKey: (action, key) => `${action} (${key})`,
  cardRemoved: (id) => `${id} removed.`,
  boardCards: (title) => `Cards of “${title}”`,
  step: (n) => `step ${n}`,
  cell: (step, row, rank) => `step ${step}, row ${row}${rank ? `, ${rank[0]} of ${rank[1]}` : ""}`,
  leadsTo: (ends) => `leads to ${ends}`,
  comesFrom: (ends) => `comes from ${ends}`,
  undone: (what) => `Undone: ${what}`,
  redone: "Done again",
  moved: (id, place) => `${id} moved to ${place}.`,
  skipToBoard: "Skip to the board",

  find: "Find a card",
  findPlaceholder: "An id or words, on every board…",
  findCount: (at, of) => `${at} / ${of}`,
  findNone: "No card",
  findInLabels: "labels",
  findInDetail: "detail",
  findInNote: (id) => `note ${id}`,
  findMore: (n) => `${n} more: add a word`,
  fit: "Fit",
  fitHint: "Fit the whole board in the window, or back to 100 %",
  resolvedNotes: (count) => `Resolved (${count})`,
  shortcuts: "Keys and gestures",
  shortcutList: (how, doneLast, axes) => [
    ["Tab", "Into the board, then out of it"],
    ["← → ↑ ↓", "To the next card; the card chosen goes along"],
    [
      "Shift + ← → ↑ ↓",
      how === "graph"
        ? "Nudge the card; Snap then keeps it there"
        : how === "timeline"
          ? "Move the card: ← → a step, ↑ ↓ its place in its cell"
          : how === "grid"
            ? `Move the card a cell: ↑ ↓ ${axes?.y ?? "impact"}, ← → ${axes?.x ?? "effort"}`
            : "Move the card: ← → a column, ↑ ↓ its place in its column",
    ],
    how === "graph"
      ? ["Alt + → ↓", "Add the next step, linked from the card"]
      : ["Alt + ← → ↑ ↓", "Add a card of its kind on that side"],
    ["Enter or F2", "Rename the card"],
    ["Space", "Choose the card"],
    ["D", doneLast ? "Move the card to the last column, or out of it" : "Done, or not done"],
    ["L", "Link: then Space on the other card"],
    ["E", "Write its detail, in the right panel"],
    ["N", "Write a note for Claude on the card"],
    ["Delete", "Remove the card; Undo brings it back"],
    ["/ or ⌘K / Ctrl+K", "Find a card, on any board"],
    ["⌘Z / Ctrl+Z", "Undo your last change"],
    ["⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y", "Redo the change undone"],
    ["⌘↵ / Ctrl+Enter", "Send to Claude"],
    ["Esc", "Close, cancel, deselect"],
    ["?", "This sheet, and out of it"],
    ["< and >, or [ and ]", "Fold the left panel, the right one; or show it"],
  ],
  mouseList: (how) => [
    [
      "Drag a card",
      how === "graph" ? "Put it there; Snap then keeps it there" : "Move it; a line shows where it lands",
    ],
    ...(how === "timeline"
      ? ([
          ["+ between two step numbers", "Insert a column there"],
          ["× on an empty step", "Remove it (Undo brings it back)"],
          ["Drag a step number", "Move the step, its cards with it"],
        ] as [string, string][])
      : []),
    ...(how === "kanban"
      ? ([
          ["+ between two column headings", "Add a column there"],
          ["× in the heading of an empty column", "Remove it (Undo brings it back)"],
          ["Drag a column heading", "Move the column, its cards with it"],
        ] as [string, string][])
      : []),
    ...(how === "graph" || how === "timeline"
      ? []
      : ([
          ["Double-click a column's name", "Rename it for this board"],
          [
            "Double-click a column's subtitle, or Add a subtitle under its name",
            "Write what the column stands for; emptied, the workshop's words come back",
          ],
        ] as [string, string][])),
    ...(how === "grid"
      ? ([
          [
            "Double-click an axis, or a word at one of its ends",
            "Rename it for this board; emptied, the workshop's words come back",
          ],
        ] as [string, string][])
      : []),
  ],
  withTheMouse: "With the mouse",
  onACard: "On a card",
  marks: {
    detail: "Has a detail: press ≡ to read it",
    done: "Done",
    notes: "Open notes on it: press the count to read them",
    unread: "Changed by you, not read by Claude yet",
    changed: "Changed by Claude since your last visit",
  },
  snap: { name: "Snap", tip: "Snap: the cards stay where you put them; off, their links place them" },
  close: "Close",
};

const fr: Messages = {
  languageName: "Français",
  language: "Langue",

  noSession: "Aucune session Claude Code reliée",
  idle: "Claude est au repos",
  thinking: "Claude réfléchit",
  running: (what) => `Claude exécute ${what ?? "un outil"}`,
  waitingInTerminal: (tool) => `Claude t'attend dans le terminal${tool ? ` pour autoriser ${tool}` : ""}`,
  listening: "Claude attend ton envoi",
  disconnected: "Compagnon déconnecté, reconnexion…",
  saving: "Enregistrement…",
  noAnswer: "Le compagnon n'a pas répondu : rien n'est enregistré.",
  unreachable: "Le compagnon est injoignable : rien n'est enregistré.",

  hintListening: "Claude les lit dès que tu envoies.",
  hintNoSession: "Pas encore de session Claude ici : ils seront lus quand une session démarrera.",
  hintWorking: "Claude les lira après son action en cours.",
  hintIdle: "Claude les lira à ton prochain message dans le terminal.",
  handedOverNoSession: "Envoyé. Pas encore de session Claude ici : ce sera lu quand une session démarrera.",
  handedOverWorking: "Envoyé. Claude le lira après son action en cours.",
  handedOverIdle: "Envoyé. Claude n'écoute pas : il le lira à ton prochain message dans le terminal.",

  boardShown: "Tableau affiché",
  sessionShown: "Session de Claude affichée",
  newBoardButton: "+ Tableau",
  showPanel: { left: "Afficher la palette", right: "Afficher le panneau latéral" },
  hidePanel: { left: "Replier la palette", right: "Replier le panneau latéral" },
  boardMenu: "Tableau : nouveau, export, suppression",
  newBoardItem: "Nouveau tableau…",
  removeBoardItem: "Supprimer ce tableau…",
  zoomOut: "Dézoomer",
  zoomIn: "Zoomer",
  undo: (keys) => `Annuler ton dernier changement (${keys})`,
  redo: (keys) => `Rétablir (${keys})`,
  undoAction: "Annuler",
  redoAction: "Rétablir",
  export: "Exporter",
  exportAs: {
    md: "Markdown (note de conception)",
    html: "Page HTML autonome",
    svg: "Image SVG",
    mermaid: "Diagramme Mermaid",
    json: "Modèle JSON (réimportable)",
  },
  copyMermaid: "Copier le Mermaid",
  publishAll: "Tout publier d'un coup : sideco publish",
  mermaidCopied: "Mermaid copié dans le presse-papiers.",
  clipboardRefused: "Le navigateur a refusé l'accès au presse-papiers ; utilise l'export Mermaid.",

  palette: "Cartes à ajouter",
  add: (type) => `Ajouter : ${type}`,
  insertColumn: "Insérer une colonne ici",
  addLane: "Ajouter une colonne ici",
  removeLane: (name) => `Supprimer la colonne ${name}`,
  laneHeading: (name, count) => `Colonne ${name}, ${count} carte${count > 1 ? "s" : ""}`,
  laneKeys:
    "Entrée : renommer · Maj + Entrée : sous-titre · Maj et une flèche : déplacer · Suppr : supprimer si vide · + ou Alt et une flèche : ajouter une colonne",
  laneMovedTo: (name, position, of) => `Colonne ${name} déplacée : ${position} sur ${of}.`,
  laneNotEmpty: (name) => `La colonne ${name} a encore des cartes : déplace-les ou supprime-les d'abord.`,
  laneRemoved: (name) => `Colonne ${name} supprimée.`,
  removeStep: (col) => `Supprimer l'étape ${col}`,
  stepRemoved: (col) => `Étape ${col} supprimée.`,
  howGraphFrom: (id) => `La nouvelle carte sera reliée à ${id}.`,
  newCard: (type, hint) => `${type} : ${hint.toLowerCase()}`,

  notes: "Notes",
  openNotes: (count) => `Notes ouvertes (${count})`,
  wholeBoard: "Tout le tableau",
  cardGone: (id) => `${id} (supprimé)`,
  author: { human: "Toi", agent: "Claude", system: "Sideco" },
  waits: { you: "Attend ta réponse", claude: "Attend Claude" },
  replyTo: (id) => `Répondre à ${id}`,
  showCard: (id) => `Montrer ${id} sur le tableau`,
  replyPlaceholder: "Répondre…",
  reply: "Répondre",
  notePlaceholder: "Une question, une remarque…",
  newNote: "Nouvelle note",
  addNote: "Noter",
  resolve: "Résoudre",
  replyAndResolve: "Répondre et résoudre",
  focus: (ids) => `Focus : ${ids}`,
  clearFocus: "Lever le focus",

  emptyTitle: "Que veux-tu modéliser ?",
  emptyHint:
    "Choisis un atelier, ou demande-le à Claude dans le terminal : il écrira ici pendant qu'il travaille.",
  newBoard: "Nouveau tableau",
  title: "Titre",
  boardTitle: "Titre du tableau",
  titleExample: "Passage de commande",
  workshop: "Atelier",
  cancel: "Annuler",
  create: "Créer",

  removeBoard: (title) => `Supprimer le tableau « ${title} »`,
  removeBoardQuestion: (title) => `Supprimer le tableau « ${title} » ?`,
  removeBoardConsequence: (elements) =>
    `${elements === 0 ? "Il est vide." : `Il contient ${elements} carte${plural(elements)}.`} Il quitte la page, pour toi comme pour Claude. Annuler le fait revenir.`,

  sessionPanel: "Session Claude Code",
  session: "Session",
  turnInProgress: "(tour en cours)",
  earlierSteps: (count) => `… ${count} étape${plural(count)} avant`,
  sessionHint:
    "Les étapes de Claude apparaîtront ici dès qu'une session Claude Code tournera dans ce projet.",
  cardPanel: "Carte choisie",
  cardPanelOf: (id) => `Carte ${id}`,
  sidePanel: "Panneau latéral",
  tabs: { session: "Session", notes: "Notes", history: "Historique", detail: "Détail" },
  notesOpened: "Claude a écrit une note qui t'attend : l'onglet Notes est ouvert.",
  notesTab: (open, yours) =>
    yours > 0
      ? `Notes : ${open} ouverte${open > 1 ? "s" : ""}, ${yours} attend${yours > 1 ? "ent" : ""} ta réponse`
      : open > 0
        ? `Notes : ${open} ouverte${open > 1 ? "s" : ""}`
        : "Notes",
  cardNotes: (count) =>
    count === 1 ? "1 note ouverte sur cette carte" : `${count} notes ouvertes sur cette carte`,
  labelledWith: (labels) => `labels ${labels}`,
  labelsHeading: "Labels",
  addLabel: "Ajouter un label : type:bug, @nom… (Entrée)",
  removeLabel: (label) => `Retirer le label ${label}`,
  labelsAdded: (labels) => `Labels ajoutés : ${labels}`,
  labelRemoved: (label) => `Label ${label} retiré`,
  liveNow: "● En direct",
  earlier: (more) => `Plus ancien… (encore ${more})`,
  detailTabEmpty: "Détail : choisis une carte sur le tableau",
  noDetail: "Pas encore de détail.",
  editDetail: "Modifier le détail",
  addDetail: "Ajouter un détail",
  saveDetail: "Enregistrer",
  detailKeys: (key) =>
    `${key} enregistre, Échap annule. Markdown : **gras**, *italique*, \`code\`, - listes, [mots](https://…)`,
  detailSaved: (id) => `Détail de ${id} enregistré`,

  messageForClaude: "Message pour Claude",
  messagePlaceholder: "Un mot pour Claude (facultatif)",
  upToDate: "Claude est à jour",
  pending: (count) => `${count} changement${plural(count)} pas encore lu${plural(count)}`,
  unread: "Pas encore lu par Claude",
  sinceVisit: (count) => `Depuis ta dernière visite, Claude a fait ${count} changement${plural(count)} ici.`,
  seeInHistory: "Les voir dans l'historique",
  nextChanged: (cards) => `Carte changée suivante (${cards})`,
  gotIt: "Vu",
  changedSinceVisit: "Changé par Claude depuis ta dernière visite",
  hasDetail: "a un détail",
  openNotesOn: (count) => (count === 1 ? "1 note ouverte" : `${count} notes ouvertes`),
  theirTurn: "À toi",
  claudeWaits: "Claude t'attend",
  claudeWaitsOn: (title) => `Claude attend · ${title}`,
  claudeBlocked: "Claude est bloqué sur toi",
  claudeBlockedOn: (title) => `Claude est bloqué · ${title}`,
  handOver: "Envoyer à Claude",
  handOverTo: "Pour la session",

  history: "Historique du tableau",
  previousEvent: "Événement précédent",
  nextEvent: "Événement suivant",
  historyScope: "L'historique parcourt",
  thisBoard: "Ce tableau",
  everything: "Tout",
  live: (events) => `En direct · ${events} événement${plural(events)}`,
  beforeFirst: "Avant le premier événement",
  past: "Tu regardes le passé : le tableau est en lecture seule.",
  backToLive: "Revenir au direct",

  cardLabel: "Titre",
  laneName: "Nom de la colonne",
  laneHintName: "Sous-titre de la colonne (vide : celui de l'atelier)",
  addLaneHint: "Ajouter un sous-titre",
  axisName: "Nom de l'axe (vide : celui de l'atelier)",
  axisLow: "Début de l'axe (vide : celui de l'atelier)",
  axisHigh: "Fin de l'axe (vide : celle de l'atelier)",
  axisKey: (word) => `Axe ${word}`,
  axisEndKey: (bound, word) => `${bound === "low" ? "Début de l'axe" : "Fin de l'axe"} : ${word}`,
  axisKeys: "Entrée ou F2 l'écrit",
  wordsOrphaned: (id, words) => `${id} a été supprimée pendant ta saisie. Ton texte : « ${words} »`,
  rename: "Renommer",
  detail: "Détail",
  link: "Relier",
  done: "Marquer fait",
  notDone: "Pas fait",
  noteForClaude: "Note pour Claude",
  moreActions: "Autres actions : lier, fait, retirer",
  remove: "Supprimer",
  noteOnPlaceholder: (id) => `Note pour Claude sur ${id}…`,
  linkBetween: (src, dst) => `Lien ${src} → ${dst}`,
  removeLink: "Supprimer le lien",
  wired: (link, cut) => (link ? `${link} ${cut ? "retiré" : "posé"}` : "Aucune carte visée"),
  nameLink: "Nommer",
  linkName: "Nom du lien, comme oui ou non",
  linkNameOf: (src, dst) => `Nom du lien ${src} → ${dst}`,

  agentRemovedBoard: (title) => `Claude a supprimé le tableau « ${title} ».`,
  agentRestoredBoard: (title) => `Claude a restauré le tableau « ${title} ».`,
  boardRemoved: (title) => `Tableau « ${title} » supprimé.`,
  agentCreatedBoard: (title) =>
    `Claude a créé le tableau « ${title} » : il est dans la liste des tableaux, en haut.`,

  updated: "Sideco a été mis à jour.",
  reload: "Recharger",

  colon: " :",

  detailOf: (id) => `Détail de ${id}`,
  noteOn: (id) => `Note pour Claude sur ${id}`,
  saveLines: "Entrée enregistre, Maj + Entrée va à la ligne, Échap annule",
  withKey: (action, key) => `${action} (${key})`,
  cardRemoved: (id) => `${id} supprimée.`,
  boardCards: (title) => `Cartes de « ${title} »`,
  step: (n) => `étape ${n}`,
  cell: (step, row, rank) => `étape ${step}, rangée ${row}${rank ? `, ${rank[0]} sur ${rank[1]}` : ""}`,
  leadsTo: (ends) => `mène à ${ends}`,
  comesFrom: (ends) => `vient de ${ends}`,
  undone: (what) => `Annulé : ${what}`,
  redone: "Refait",
  moved: (id, place) => `${id} déplacée en ${place}.`,
  skipToBoard: "Aller au tableau",

  find: "Trouver une carte",
  findPlaceholder: "Un id ou des mots, sur tous les tableaux…",
  findCount: (at, of) => `${at} / ${of}`,
  findNone: "Aucune carte",
  findInLabels: "labels",
  findInDetail: "détail",
  findInNote: (id) => `note ${id}`,
  findMore: (n) => `${n} de plus : ajoutez un mot`,
  fit: "Ajuster",
  fitHint: "Faire tenir tout le tableau dans la fenêtre, ou revenir à 100 %",
  resolvedNotes: (count) => `Résolues (${count})`,
  shortcuts: "Touches et gestes",
  shortcutList: (how, doneLast, axes) => [
    ["Tab", "Entrer dans le tableau, puis en sortir"],
    ["← → ↑ ↓", "À la carte suivante ; la carte choisie suit"],
    [
      "Maj + ← → ↑ ↓",
      how === "graph"
        ? "Pousser un peu la carte ; Snap s'active, elle y reste"
        : how === "timeline"
          ? "Déplacer la carte : ← → une étape, ↑ ↓ sa place dans sa case"
          : how === "grid"
            ? `Déplacer la carte d'une case : ↑ ↓ ${axes?.y ?? "l'impact"}, ← → ${axes?.x ?? "l'effort"}`
            : "Déplacer la carte : ← → une colonne, ↑ ↓ sa place dans la colonne",
    ],
    how === "graph"
      ? ["Alt + → ↓", "Ajouter l'étape suivante, reliée depuis la carte"]
      : ["Alt + ← → ↑ ↓", "Ajouter une carte du même type de ce côté"],
    ["Entrée ou F2", "Renommer la carte"],
    ["Espace", "Choisir la carte"],
    ["D", doneLast ? "Envoyer la carte dans la dernière colonne, ou l'en sortir" : "Faite, ou non faite"],
    ["L", "Relier : puis Espace sur l'autre carte"],
    ["E", "Écrire son détail, dans le panneau de droite"],
    ["N", "Écrire une note pour Claude sur la carte"],
    ["Suppr", "Supprimer la carte ; Annuler la ramène"],
    ["/ ou ⌘K / Ctrl+K", "Trouver une carte, sur tous les tableaux"],
    ["⌘Z / Ctrl+Z", "Annuler ton dernier changement"],
    ["⇧⌘Z / Ctrl+Maj+Z ou Ctrl+Y", "Rétablir le changement annulé"],
    ["⌘↵ / Ctrl+Entrée", "Envoyer à Claude"],
    ["Échap", "Fermer, annuler, désélectionner"],
    ["?", "Cette feuille, et en sortir"],
    ["< et >, ou [ et ]", "Replier le panneau de gauche, celui de droite ; ou le rouvrir"],
  ],
  mouseList: (how) => [
    [
      "Glisser une carte",
      how === "graph"
        ? "La poser là ; Snap s'active, elle y reste"
        : "La déplacer ; une ligne montre où elle tombe",
    ],
    ...(how === "timeline"
      ? ([
          ["+ entre deux numéros d'étape", "Insérer une colonne là"],
          ["× sur une étape vide", "La supprimer (Annuler la ramène)"],
          ["Glisser un numéro d'étape", "Déplacer l'étape, ses cartes avec elle"],
        ] as [string, string][])
      : []),
    ...(how === "kanban"
      ? ([
          ["+ entre deux en-têtes", "Ajouter une colonne là"],
          ["× dans l'en-tête d'une colonne vide", "La supprimer (Annuler la ramène)"],
          ["Glisser un en-tête", "Déplacer la colonne, ses cartes avec elle"],
        ] as [string, string][])
      : []),
    ...(how === "graph" || how === "timeline"
      ? []
      : ([
          ["Double-clic sur le nom d'une colonne", "La renommer pour ce tableau"],
          [
            "Double-clic sur le sous-titre d'une colonne, ou sur Ajouter un sous-titre sous son nom",
            "Écrire ce que la colonne représente ; vidé, les mots de l'atelier reviennent",
          ],
        ] as [string, string][])),
    ...(how === "grid"
      ? ([
          [
            "Double-clic sur un axe, ou un mot à l'un de ses bouts",
            "Le renommer pour ce tableau ; vidé, les mots de l'atelier reviennent",
          ],
        ] as [string, string][])
      : []),
  ],
  withTheMouse: "À la souris",
  onACard: "Sur une carte",
  marks: {
    detail: "A un détail : appuie sur ≡ pour le lire",
    done: "Faite",
    notes: "Notes ouvertes sur elle : appuie sur le nombre pour les lire",
    unread: "Changée par toi, pas encore lue par Claude",
    changed: "Changée par Claude depuis ta dernière visite",
  },
  snap: { name: "Snap", tip: "Snap : les cartes restent où tu les poses ; sinon, leurs liens les placent" },
  close: "Fermer",
};

export const MESSAGES: Record<Locale, Messages> = { en, fr };

/**
 * The page's language: what the reader chose here, else what the companion
 * serves the page in, else English.
 */
export function pickLocale(chosen: string | null | undefined, served: string | null | undefined): Locale {
  return asLocale(chosen) ?? asLocale(served) ?? DEFAULT_LOCALE;
}
