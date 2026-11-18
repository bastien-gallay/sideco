---
name: vico
description: Model with the user on Vico, the live visual board open in a browser window beside the terminal. Use it when the user wants to see, map, model or discuss something visually - an event storming, a flow with decisions, a kanban, a story map, a retrospective, a sort by impact and effort - or says "vico", "le tableau", "montre-le sur le board", "modélisons", "on fait un atelier". Also use it when the session context says the user edited the Vico board.
---

# Vico

Vico is a board the user and you edit together. It **complements** the
terminal and never replaces it: the conversation stays here; the board is
the shared model. You write with the `vico` CLI; the user edits in the page;
each side sees the other's changes within a second.

## The loop

1. **Open the board yourself.** `vico open`, once, before your first write:
   it creates the workspace if the project has none, starts the companion and
   shows the page in the user's browser. The user has nothing to type. With
   the page already open it only prints the address, so it is safe to repeat.
2. **Read first.** `vico boards`, then `vico show BOARD`. Never write to a
   board you have not read in this turn: the user may have changed it.
3. **Write in small batches** with `vico apply`, five to nine elements at a
   time, so the user watches the model grow and can stop you early.
4. **Point** at what you want discussed: `vico focus E3 P1 --why "…"`.
5. **Hand over** with one question: `vico pass "Qui réserve le stock ?"`.
6. **Wait** when the next step depends on the user: `vico wait`. It blocks
   until they press "Hand over to Claude" ("Passer la main à Claude" when
   their page is in French), then prints what they changed.
   If it prints `no hand-over yet`, run it again or carry on with other work.
7. **Take their edits as input.** A digest of their changes also arrives in
   your context on their next prompt. `vico changes` asks for it explicitly.

```sh
vico open
vico board new "Passage de commande" --format event-storming
vico apply <<'EOF'
add actor "Client" --col 1
add command "Passer commande" --col 1 --alias passer
add event "Commande passée" --col 1 --alias passee
add policy "Réserver le stock" --col 2 --alias reserver
link @passer @passee
link @passee @reserver
EOF
vico focus P1 --why "La règle de réservation n'est pas claire"
vico pass "Qui réserve le stock : nous ou l'entrepôt ?"
vico wait
```

## Rules

- **Ids come from Vico.** Each `add` prints the id it minted (`E1`, `C2`);
  `vico apply` prints them in order. Do not guess an id: read it from the
  output or from `vico show`. A removed id is never used again, unless the
  user brings the element back.
- **In a batch, name what you add.** A line cannot know the id an earlier
  line will get: write `add event "Payée" --alias payee`, then `@payee` where
  an id goes on the lines after it (`link @payee P1`, `detail @payee "…"`,
  `note "…" --on @payee`). A name is lowercase letters, digits and dashes.
  It lives for that one `vico apply`: afterwards, use the id that was printed.
- **Positions are semantic**, never pixels: a column (`--col N`), a lane
  (`--lane doing`), or a link (`--from S1`). The layout is computed.
- **A batch is all or nothing.** One bad line and nothing is applied; the
  error names the line. A `@name` no earlier line gave is a bad line.
- **The user's edits win.** Do not undo a rename, a move or a removal they
  made. If you disagree, say why in the terminal or pin a note. They can
  undo their own gestures in the page: you are told the net result, and
  `restored` marks an element or a board they brought back, id unchanged.
- **Labels are short** (six words or fewer). Rules, examples and sources go
  in the detail: `vico detail E1 "…"`.
- **One question at a time.** A hand-over carries a single question; a
  `hotspot` or a note marks the others.
- **Answer a note in its thread**: `vico reply N1 "…"`. Never answer by
  opening a new note, or only by editing a card: the user could not tell
  what your answer is to. If the answer changed the board, say what changed
  in the reply. In `vico changes`, `reply N7 to N1 on S3: …` is the user's
  answer to note N1; `vico show` lists each thread with its replies.
- **Close a thread when it is settled**: `vico resolve N1` closes the whole
  thread. Close yours once the user has answered and you have acted on it;
  leave the user's own notes for them to close, unless they say otherwise.
- **Write in the user's language** on the board.
- **Never touch the files under `.vico/`.** The journal is the history: do
  not edit, move or delete it. To clear the table, remove boards with
  `vico board rm ID`; the page follows at once.
- **A sandbox may be in the way.** If `vico` answers `this shell may not …`
  or `could not open the browser`, the Bash sandbox blocks it: run that same
  `vico` command outside the sandbox. Reading (`vico boards`, `vico show`)
  works either way.

## Choosing a workshop

| The user asks | Format | Elements are placed with |
| --- | --- | --- |
| what happens in the domain, in what order | `event-storming` | `--col N` |
| which path, where it branches | `flow` | `--from ID`, `--edge "oui"` |
| where the work stands, what blocks it | `kanban` | `--lane todo`, `doing` or `done` |
| which journey, what ships first | `story-map` | `--col N` |
| what to keep, stop, try | `retro` | `--lane keep`, `drop` or `try` |
| what to do first, for what it brings and costs | `impact-effort` | `--lane quick`, `bet`, `fill` or `avoid` |

`vico formats` lists every element type with its id prefix, and what each lane
of `impact-effort` stands for (`quick` is high impact for a low effort, `avoid`
the reverse).

## Commands

```text
vico boards                       vico show [BOARD]
vico board new "Title" [--format F] [--id ID]
vico board rm ID                  (removes the board; its history stays)
vico add TYPE "Label" [--col N | --lane L] [--from ID [--edge "label"]] [--detail "…"]
vico rename ID "Label"            vico detail ID "Text"
vico move ID --col N | --lane L [--before ID]   # --before alone: before that card, in its cell
vico rm ID                        vico insert-col N
vico lane LANE "Name"             call a lane of this board your own way
vico done ID                      vico undone ID
vico link SRC DST ["label"]       vico unlink SRC DST
vico focus [ID…] [--why "…"]      (no id clears the focus)
vico note "Text" [--on ID]        (opens a thread, on the board or on one element)
vico reply N1 "Text"              vico resolve N1    (answer in a thread; close it)
vico apply [FILE]                 (a batch of the lines above, stdin by default)
  in a batch: add … --alias NAME     (then @NAME for its id on the lines below)
vico changes                      vico pass ["question"]      vico wait
vico export [BOARD] --format md|html|svg|mermaid|json [-o FILE]
vico publish                      vico status                 vico url
vico open                         vico stop
```

With several boards, add `--board ID` to a command, or start a batch with
the `board new` line that creates it.

## Keeping the model

- `vico export BOARD --format md -o docs/design/BOARD.md` writes a design
  note: the diagram as Mermaid, then every element with its detail.
- `vico publish` writes every board as a static site under `.vico/site`.
- `.vico/boards.jsonl` is the model's history and can be committed.
- A Mermaid flowchart you write in a reply is captured as a `flow` board
  when your turn ends; prefer writing to the board directly.
