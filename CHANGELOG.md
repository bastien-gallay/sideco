# Changelog

All notable changes to Sideco are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Claude Code installs Sideco straight from GitHub, no clone needed:
  `claude plugin marketplace add bastien-gallay/sideco && claude plugin install sideco@sideco`.
- `sideco statusline --install` puts the companion's address in Claude Code's
  status line, keeping the rest of `settings.json`; a status line of your own is
  left alone, and the command prints the two lines to append to it. Outside a
  Sideco project those lines leave the script's exit status at 0, so Claude Code
  keeps showing the rest of the status line.
- Without Bun, `sideco` says how to install it instead of `bun: not found`, and
  finds it in `~/.bun/bin` when a hook's shell does not have it in its `PATH`.
- `sideco renumber ID [NEW]` gives a card a new id: NEW, or the next of its
  letter in the project. Its links, the notes on it and the focus follow, and
  the old id is never given again. `sideco show` says the id the card had, and
  `sideco find` finds it by that id. An undo gives the old id back, and the
  gestures made before still undo. It settles the ids an older journal gave
  on several boards.
- `sideco renumber --all` settles a project in one batch: every card minted
  under a former letter takes the next id of its kind's letter, and every id an
  older journal gave on several boards stays on one, a kanban first since
  commits cite its ids, otherwise the board made first; the other holders take
  the next of their letter. `--dry-run` lists the plan and writes nothing.
- A kanban holds stories (`S`) beside tasks (`T`) and blockers: a task stands
  alone or splits a story, added from it and linked, and the page offers to
  split a story into a task. A story wears the story map's yellow, a task its
  green.
- `sideco retype ID TYPE [NEW]` turns a card into another kind of its board: it
  takes the next id of that kind's letter, or NEW, its ties follow, and it keeps
  its old id, as with `renumber`. An undo gives back the kind and the id.
- The wire pulled from a card's handle ends on an arrow, as the link it lays
  will, and held near an edge of the board it scrolls the board towards the
  cards out of sight.
- While a link is drawn from a card, the board says what comes next ("Choose
  the card to link to · Esc cancels"), and the bar of a link picked opens
  beside the line, off the cards around it.
- On a kanban, a story wears the count of its tasks done (`1/2`) and a task the
  id of the story it splits (`↳ S1`); the tooltip and the Detail tab say it in
  words.
- The Detail tab says, under a card's name, who added it, who changed it last
  and when, and that it is done.
- A label's chip, pressed on a card or in the Detail tab, filters the board by
  that label: the cards without it step back where they are, and a bar says how
  many wear it. `@name` gives "my cards"; "Show all" gives every card back.
- A C4 context leaves with its title and its key, as the notation asks: the
  `svg`, `md` and `html` exports are headed "System context: " and the board's
  title, and name the three kinds of card: drawn in their colours in the svg and
  the html, by their letters in the markdown.

### Changed

- One letter per concept in the whole project: a card's letter says what it is,
  on any board. Event Storming: actor P (was X), policy R (was P), read model V
  (was R), aggregate G (was A), external system X (was G). C4 context: system Y
  (was S). Flow: step F (was S). Retrospective: point Q (was P), action T (was
  A). Cards keep their ids until `sideco renumber --all`; `add --id` still takes
  a former letter while no kind of the format holds it now. `sideco import`
  gives a card written under a former letter the new one, its links following.

- An element id is given once in the whole project, per letter, no longer once
  per board: a new card takes the next number of its letter across every board,
  removed boards included, and `add --id` refuses an id another board holds or
  held, naming that board. Notes follow the same rule; lanes and slices stay
  numbered per board. `sideco import` gives a copied card a new id when the
  project already holds its own, and its links follow. `sideco status` lists
  the ids an older journal gave on several boards.
- The JSON export (`model.json`) says its `version`: version 2 counts `col` from
  1, as the board does, and writes edges as `{src, dst, label}`. A file with no
  version is read as version 1, as before: `col` from 0, `[src, dst]` pairs, and
  `external` for `system`. Sideco no longer promises files compatible with faceto.

## [0.1.0] - 2026-11-20

The first installable version: a live board, open in a browser beside the
terminal, that you and Claude Code model on together.

### Install

You need [Bun](https://bun.sh) (tested with 1.4.4) and Claude Code.

```sh
git clone https://github.com/bastien-gallay/sideco.git ~/sideco
claude plugin marketplace add ~/sideco
claude plugin install sideco@sideco
```

Then ask Claude, in any project: *"let's model the checkout flow on the board"*.

### The loop

- Claude writes on the board with the `sideco` command (`apply` takes a whole
  batch, all or nothing) and reads it back with `sideco show`, whole or in part.
- You rename, move, link, annotate and remove cards in the page, then press
  `Send to Claude`, with an optional word.
- Claude receives a net summary of what you changed: a card added then renamed
  reads as one addition. It gets it whether it is waiting on you, working, or
  idle with the page open, up to 12 hours after its last turn.
- Notes open threads on a card, addressed to one side, answered from the page or
  with `sideco reply`, and resolved when done.
- Claude can put your attention on a few cards (the focus); you clear it from
  the page. The page marks what Claude has not read yet, and what it changed
  since your last visit.
- Several Claude Code sessions can share a project: each follows the boards it
  writes on or reads, and a hand-over goes to the session chosen at the top of
  the page.

### Workshops

Seven formats, each with its own lanes, card types and layout:

| Workshop | The question it asks |
| --- | --- |
| `event-storming` | What happens in the domain, in what order, and what triggers it? |
| `flow` | Which way does it go, and where does the path split? |
| `kanban` | Where does the work stand, and what is blocking it? |
| `story-map` | What journey does the user follow, and what ships first? |
| `retro` | What do we keep, what do we stop, what do we try? |
| `impact-effort` | What do we do first, for what it brings and what it costs? |
| `c4-context` | Who uses the system, and what does it depend on? |

Kanban, retro and impact-effort boards can rename their lanes and give them
subtitles; kanban and retro boards can also add, remove and reorder lanes. An
impact-effort plan names its own axes, and any board can ask its own question
in place of the workshop's.

### In the page

- Add where you point: a `+` appears over a cell or a lane, one per card type.
- Cards size to their text, carry a description, labels (`type:bug`,
  `@someone`), shared across the project's boards, and a done mark.
- Search every board with `/` or `⌘K` / `Ctrl+K`.
- Undo and redo your own gestures; Claude undoes its own with `sideco undo`.
  A gesture the other side has changed since is refused, with the reason.
- History: replay any board as it was, event by event.
- Link names are written beside their own link, never over a card or another
  name; with no free spot, a name reads on hover.
- Keyboard: the cards of a board are one Tab stop and arrows move between
  them; kanban and retro lane headings and a plan's axis words are stops of
  their own. A sheet (`?`) lists the keys and gestures. Screen readers hear each
  card's place (step and row, or lane) and marks; on flow and C4 boards, its
  links.
- English by default, French at the reader's choice (`--lang`, `SIDECO_LANG`,
  or the page's picker). What Claude reads stays in English.
- While the companion runs, Mermaid flowcharts in Claude's answers become
  editable flow boards by themselves (the first 60 nodes).

### Export and data

- Every board exports to Markdown, HTML, SVG, Mermaid (C4 notation for
  `c4-context`) or JSON, and imports from JSON. `sideco publish` turns them all
  into a static site.
- Everything is an event in an append-only log, `.sideco/boards.jsonl`, in your
  project: commit it, and the board's history travels with the code.
- The companion listens on `127.0.0.1` only, refuses requests from another
  origin, and stops on its own 5 minutes after the last page and session leave
  (`SIDECO_IDLE_MS` changes the delay).

### Known limits

- One person and one active agent per workspace: two people editing the same
  `boards.jsonl` will get a merge conflict.
- A session run without an interface (`claude -p`) is never woken by a
  hand-over.
- Claude idle for more than 12 hours is no longer woken: it reads your changes
  at your next message in the terminal.
- Some page gestures are mouse only: inserting, moving or removing a step of a
  timeline, reaching a link, and naming an impact-effort quadrant or its
  subtitle.
- Workshops cannot yet be defined by the community in files.

[0.1.0]: https://github.com/bastien-gallay/sideco/releases/tag/v0.1.0
