---
name: sideco
description: Model with the user on Sideco, the live visual board open in a browser window beside the terminal. Use it when the user wants to see, map, model or discuss something visually - an event storming, a flow with decisions, a kanban, a story map, a retrospective, a sort by impact and effort, a C4 context - or says "sideco", "le tableau", "montre-le sur le board", "modélisons", "on fait un atelier". Also use it when the session context says the user edited the Sideco board.
---

# Sideco

Sideco is a board the user and you edit together. It **complements** the
terminal and never replaces it: the conversation stays here; the board is
the shared model. You write with the `sideco` CLI; the user edits in the page;
each side sees the other's changes within a second.

## The loop

1. **Open the board yourself.** `sideco open`, once, before your first write:
   it creates the workspace if the project has none, starts the companion and
   shows the page in the user's browser. The user has nothing to type. With
   the page already open it only prints the address, so it is safe to repeat.
2. **Read first.** `sideco boards`, then `sideco show BOARD`. Never write to a
   board you have not read in this turn: the user may have changed it.
3. **Write in small batches** with `sideco apply`, five to nine elements at a
   time, so the user watches the model grow and can stop you early.
4. **Point** at what you want discussed: `sideco focus E3 R1 --why "…"`.
5. **Hand over** with one question: `sideco pass "Qui réserve le stock ?"`.
6. **Wait** when the next step depends on the user: `sideco wait`. It blocks
   until they press "Send to Claude" ("Envoyer à Claude" when their page is
   in French), then prints what they changed.
   If it prints `no hand-over yet`, run it again or carry on with other work.
7. **Take their edits as input.** A digest of their changes also arrives in
   your context on their next prompt. `sideco changes` asks for it explicitly.
8. **Keep to your boards.** You are told the changes on the boards you follow:
   those you wrote on or read with `sideco show`, and those no other running
   session follows. Given boards by the user, `sideco follow A B`; `sideco unfollow A` lets go.

```sh
sideco open
sideco board new "Passage de commande" --format event-storming
sideco apply <<'EOF'
add actor "Client" --col 1
add command "Passer commande" --col 1 --alias passer
add event "Commande passée" --col 1 --alias passee
add policy "Réserver le stock" --col 2 --alias reserver
link @passer @passee
link @passee @reserver
EOF
sideco focus R1 --why "La règle de réservation n'est pas claire"
sideco pass "Qui réserve le stock : nous ou l'entrepôt ?"
sideco wait
```

## Rules

- **Ids come from Sideco.** Each `add` prints the id it minted (`E1`, `C2`);
  `sideco apply` prints them in order. Do not guess an id: read it from the
  output or from `sideco show`. A removed id is never used again, unless the
  user brings the element back.
- **In a batch, name what you add.** A line cannot know the id an earlier
  line will get: write `add event "Payée" --alias payee`, then `@payee` where
  an id goes on the lines after it (`link @payee R1`, `detail @payee "…"`,
  `note "…" --on @payee`). A name is lowercase letters, digits and dashes.
  It lives for that one `sideco apply`: afterwards, use the id that was printed.
- **Positions are semantic**: a column (`--col N`), a lane (`--lane doing`),
  or a link (`--from F1`); the layout is computed. Only a Snap diagram takes a point.
- **A batch is all or nothing.** One bad line and nothing is applied; the
  error names the line. A `@name` no earlier line gave is a bad line.
- **The user's edits win.** Do not undo a rename, a move or a removal they
  made. If you disagree, say why in the terminal or pin a note. They can
  undo their own gestures in the page: you are told the net result, and
  `restored` marks an element or a board they brought back, id unchanged.
- **Labels are short** (six words or fewer). Rules, examples and sources go
  in the detail: `sideco detail E1 "…"`.
- **One question at a time.** A hand-over carries a single question; a
  `hotspot` or a note marks the others.
- **Answer a note in its thread**: `sideco reply N1 "…"`. Never answer by
  opening a new note, or only by editing a card: the user could not tell
  what your answer is to. If the answer changed the board, say what changed
  in the reply. In `sideco changes`, `reply N7 to N1 on F3: …` is the user's
  answer to note N1; `sideco show` lists each thread with its replies.
- **Close a thread when it is settled**: `sideco resolve N1` closes the whole
  thread. Close yours once the user has answered and you have acted on it;
  leave the user's own notes for them to close, unless they say otherwise.
- **Link what you cite**: a board or element named in a reply is a link to
  it in the page, `[T152](URL/#/b/backlog/T152)`, as `sideco url T152` prints it.
- **Write in the user's language** on the board.
- **Never touch the files under `.sideco/`.** The journal is the history: do
  not edit, move or delete it. To clear the table, remove boards with
  `sideco board rm ID`; the page follows at once.
- **A sandbox may be in the way.** If `sideco` answers `this shell may not …`
  or `could not open the browser`, the Bash sandbox blocks it: run that same
  `sideco` command outside the sandbox. Reading (`sideco boards`, `sideco show`)
  works either way.

## Choosing a workshop

| The user asks | Format | Elements are placed with |
| --- | --- | --- |
| what happens in the domain, in what order | `event-storming` | `--col N` |
| which path, where it branches | `flow` | `--from ID`, `--edge "oui"` |
| where the work stands, what blocks it | `kanban` | `--lane todo`, `doing` or `done`; a `story` splits into `task`s: `add task "…" --from S1` |
| which journey, what ships first | `story-map` | `--col N` |
| what went well or not, what to keep, stop, try | `retro` | `--lane went-well`, `went-badly`, `keep`, `drop` or `try`; an action from a point: `add action "…" --from Q1` |
| what to do first, for what it brings and costs | `impact-effort` | `--lane quick`, `bet`, `fill` or `avoid` |
| who uses the system, what it depends on (C4 level 1) | `c4-context` | `--from ID --edge "uses"`; the detail is the description |

`sideco formats` lists every element type with its id prefix, and what each lane of `impact-effort` stands for (`quick`: high impact for a low effort; `avoid`: the reverse).

## Commands

```text
sideco boards      sideco show [BOARD] [--lane L | --col N] [--brief] [--notes]   (a part: its first line says so)
sideco show ID                      (one card: where it is, its links, its threads)
sideco board new "Title" [--format F] [--id ID]   sideco board rm ID (removes the board; its history stays)
sideco add TYPE "Label" [--col N | --lane L] [--before ID] [--from ID [--edge "label"]] [--detail "…"]
sideco rename ID "Label"            sideco detail ID "Text"
sideco move ID --col N | --lane L [--before ID] (--before alone: before that card, in its cell)   sideco place ID X Y   sideco placing hand|auto   # flow, C4: the card at that point, the whole diagram Snap (by hand, links move nothing); auto gives it back to its links, places kept
sideco rm ID   sideco insert-col N   sideco rm-col N (empty)   sideco move-col FROM TO (with its cards)   sideco renumber ID [NEW] (a new id for a card, the next of its letter by default; its links and notes follow)   sideco renumber --all [--dry-run] (every card under a former letter, or whose id another board keeps)   sideco retype ID TYPE [NEW] (a card takes another kind, and the next id of its letter)
sideco lane L "Name" (names it here) · lane hint L "What it stands for" · purpose "Its own question?" · plan: axis x|y "Name" [Low] [High] ("" gives the workshop's back) · kanban, retro: lane add "Name" [--before L] · lane rm L · lane move L [--before L] · story map: slice add "Lot 1" [--before S] (a line under the stories) · slice rm S
sideco done ID   sideco undone ID   sideco undo|redo [--dry-run] (your own last gesture, named; never the human's)
sideco link SRC DST ["label"]       sideco unlink SRC DST   (link again: renames the link)   sideco reverse SRC DST (turns the link round, its name kept)   sideco relink SRC DST --from ID | --to ID (moves one end of the link to another card, its name kept)
sideco focus [ID…] [--why "…"]      (no id clears the focus) · the user points too, by F in the page: `sideco changes` tells you `focus on E3: …`, or `focus lifted`
sideco note "Text" [--on ID] (opens a thread, on the board or one element) · reply N1 "Text" · resolve N1
sideco apply [FILE]   (a batch of the lines above, stdin by default; add … --alias NAME, then @NAME below)
sideco changes                      sideco pass ["question"]      sideco wait
sideco label ID type:bug @name · unlabel ID L (labels shared by every board; `sideco labels [KEY]` lists them) · sideco relabel OLD NEW (a label renamed on every card of every board) · sideco colour KEY blue|green|purple|orange|teal|pink|olive|grey|auto (the colour of every label of a key, on every board) · sideco find WORDS (cards holding every word, all boards) · sideco follow BOARD…                sideco unfollow BOARD…        (the boards whose changes you are told) · sideco sessions · sideco session name "Name" (with another session on the project, so the page tells you apart)
sideco export [BOARD] --format md|html|svg|mermaid|json [-o FILE]
sideco publish     sideco status     sideco url [BOARD | ID]   sideco open     sideco stop
```

With several boards, add `--board ID` to a command, or start a batch with
the `board new` line that creates it.

## Keeping the model

- `sideco export BOARD --format md -o docs/design/BOARD.md` writes a design
  note: the diagram as Mermaid, then every element with its detail.
- `sideco publish` writes every board as a static site under `.sideco/site`.
- `.sideco/boards.jsonl` is the model's history and can be committed.
- A Mermaid flowchart you write in a reply is captured as a `flow` board
  when your turn ends; prefer writing to the board directly.
