/** What `sideco help` prints: every verb of the terminal, by what it is for. */
export const HELP = `sideco — a visual companion for Claude Code

  sideco open                         start the companion if needed and show the page (a page already open is left alone)
  sideco url [BOARD | ID]             print its address, or a board's or a card's in the page
  sideco statusline                   its address for Claude Code's status line (the session's JSON on stdin)
  sideco statusline --install         put it in Claude Code's status line (~/.claude/settings.json)
  sideco serve [--port N] [--lang L]  run it in the foreground
  sideco stop                         stop the companion; the journal stays. It also stops by itself
                                      5 min after the last page and session leave ($SIDECO_IDLE_MS, or off)
  sideco init                         create a workspace (.sideco/) here
  sideco status                       boards, sessions, server

Model (BOARD defaults to the only board, or --board ID, or $SIDECO_BOARD)
  sideco formats                      the workshops and their element types
  sideco board new "Title" [--format F] [--id ID]
  sideco board rm ID                  remove a board; its history stays in the journal
  sideco retitle "Title"              give the board a new title; its id stays
  sideco boards
  sideco show [BOARD]                 a board as text; a part of it with --lane L, --col N, --brief (no details),
                                    --notes (the open notes only). The first line names the part.
  sideco show ID                      one card: where it is, its links, its threads
  sideco add TYPE "Label" [--col N | --lane L] [--before ID] [--id E1] [--from ID [--edge "label"]] [--detail "…"]
  sideco rename ID "Label"            sideco detail ID "Text"
  sideco move ID --col N | --lane L [--before ID]   (--before alone: before that card, in its cell)
  sideco place ID X Y                 on a flow or a C4: the card goes to that point, and the whole diagram is
                                    placed by hand, its other cards where they stand; links then move nothing
  sideco placing hand|auto            a diagram placed by hand, or by its links again; the places are kept
  sideco done ID                      sideco undone ID
  sideco undo [--dry-run]             take back your own last gesture, named; sideco redo puts it back.
                                    Never the human's: one they changed since is refused, and says why
  sideco rm ID                        sideco insert-col N         sideco rm-col N (an empty column)
  sideco move-col FROM TO             a column takes the number TO, its cards with it
  sideco renumber ID [NEW]            a card takes a new id, NEW or the next of its letter; its links, notes and
                                    focus follow, and show and find still name the old one
  sideco renumber --all [--dry-run]   so do the cards under a former letter, or whose id another board keeps
  sideco retype ID TYPE [NEW]         a card takes another kind, and the next id of its letter, or NEW
  sideco lane LANE "Name"             call a lane of this board your own way
  sideco label ID type:bug @name ...  put labels on a card, shared by every board; unlabel ID LABEL... takes them off
  sideco labels [LABEL|KEY]           every label of the project and its cards, across boards (labels type: every type:…)
  sideco relabel OLD NEW              a label renamed on every card, on every board (a name in use: the two
                                      become one); one undo a board takes it back
  sideco colour KEY COLOUR|auto       the colour of every label of a key (type, epic, @), on every board:
                                      blue, green, purple, orange, teal, pink, olive or grey; auto leaves it to chance
  sideco find WORDS [--board B]       the cards holding every word, in name, labels, detail or notes, across boards
  sideco sessions                     the sessions open on this project, and what each follows
  sideco session name "Name"          name this session, so the page can tell it from another
  sideco purpose "Question?"          ask this board its own question; "" gives the workshop's back
  sideco lane hint LANE "What for"     say what a lane stands for on this board; "" gives the workshop's back
  sideco axis x|y "Name" [Low] [High] name an axis of a plan and its ends (left/bottom, right/top); "" gives it back
  sideco lane add "Name" [--before L] a kanban lane of this board's own; lane rm L (empty) · lane move L [--before L]
  sideco slice add "Name" [--before S] a story map's slice, a named line under its stories; slice rm S
  sideco link SRC DST ["label"]       sideco unlink SRC DST
  sideco reverse SRC DST              turn the link round, its name kept
  sideco relink SRC DST --from ID | --to ID   move one end of the link to another card, its name kept
  sideco focus [ID…] [--why "…"]      no id clears the focus
  sideco note "Text" [--on ID]        open a discussion, on the board or on one element
  sideco reply N1 "Text"              answer in the thread of a note
  sideco resolve N1                   close the thread
  sideco apply [FILE]                 run a batch of the commands above, all or nothing (stdin by default)
                                    in a batch, \`add … --alias NAME\` (or \`note … --alias NAME\`) names what the line
                                    creates, and @NAME is its id on the lines after it: \`link @NAME E1\`

Work with the human
  sideco changes                      what the human changed since you last asked
  sideco pass ["message"]             hand the turn to the human (--to agent [--for SESSION]: to one session)
  sideco follow BOARD…                take these boards: you are told what the human changes on the boards you
                                    follow (those you wrote on or read with \`sideco show\`), not on another session's
  sideco unfollow BOARD…              let go of boards, until you write on one again
  sideco wait [--timeout SECONDS]     block until the human hands it back, then print their changes

Share
  sideco export [BOARD] --format md|html|svg|mermaid|json [-o FILE] [--lang L]
  sideco import FILE [--id ID]        a model.json, as export --format json writes it
  sideco publish [--out DIR] [--lang L]  every board as a static site

Options: --as human|agent   --session ID   --board ID

Language: this terminal speaks English. The page and the exports are in English too,
or in French with --lang fr or SIDECO_LANG=fr; in the page, each reader picks their own.
`;
