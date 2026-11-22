# Sideco

[![CI](https://github.com/bastien-gallay/sideco/actions/workflows/ci.yml/badge.svg)](https://github.com/bastien-gallay/sideco/actions/workflows/ci.yml)

**Turn your coding agent's walls of text into a conversation you can see and reshape.**

A live, structured board beside the terminal: the agent lays out a flow, a backlog or an event storming; you answer right on the card in question; one click hands the turn back, and the agent reads what you changed. Local and MIT. Claude Code today; MCP for other agents on the roadmap.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/sideco-two-workshops-dark.png">
  <img alt="Two boards in Sideco, cut by an oblique line. On the left an event storming of an ordering domain: Claude waits for you to send, and the two cards it just changed are outlined. On the right a flow: Claude asked on a decision how many attempts before blocking the card, and your answer sits in the thread with a field to reply" src="docs/img/sideco-two-workshops.png">
</picture>

<sub>A diamond marks a card Claude placed, a dot one you touched, a blue outline what Claude just changed.</sub>

> [!NOTE]
> Early: version 0.1.0, for one person and one active agent per workspace. [Tell me what breaks](https://github.com/bastien-gallay/sideco/issues).

## Install

You need Claude Code and [Bun](https://bun.sh) 1.4 or later, on macOS or Linux (Windows is untried). Claude Code installs the plugin straight from GitHub, no clone needed:

```sh
claude plugin marketplace add bastien-gallay/sideco && claude plugin install sideco@sideco
```

`claude plugin list` then shows `sideco`. The plugin adds a skill, and hooks that run a local command on the events of a session: that is how the board shows what Claude does and how your edits reach it. The hooks talk to a server on `127.0.0.1` only, and exit at once outside a Sideco workspace. One of them stays parked at the end of a turn, for 12 hours at most, to wake Claude when you send.

## Your first board

In any project, start Claude Code and ask:

```text
Let's model the checkout flow on the Sideco board
```

Claude creates the workspace (a `.sideco/` folder in the project), starts a local server and opens the board in your browser, at `http://127.0.0.1:4747`. The cards appear as Claude writes them. There is nothing else to launch, and no command for you to type: Claude runs them.

## One turn of the loop

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/sideco-loop-dark.gif">
  <img alt="A terminal beside the board. Claude writes four cards of a flow, asks what to offer when the bank says no, and waits. In the page, one card is renamed and Send to Claude is clicked: the terminal shows the rename, and Claude adds the card that follows" src="docs/img/sideco-loop.gif">
</picture>

<sub>The board is the real page, driven by the real commands and hooks; the terminal is redrawn from what the hook hands to Claude. Made by `bun scripts/loop.ts`.</sub>

You edit the board yourself: add, rename, drag, link, answer in a card's thread, undo. One click on **Send to Claude** hands the turn back.

| When you send, Claude | It reads your changes |
| --- | --- |
| waits for you | At once: the click wakes it |
| is working | After its current action |
| had stopped before the page was open | At your next message in the terminal |

## Workshops

Ask for one by its name, or let Claude choose from your question.

| Workshop | The question it asks |
| --- | --- |
| Event storming | What happens in the domain, in what order? |
| Flow | Which way do we go, and where does the path split? |
| Kanban | Where is the work, and what blocks it? |
| Story map | Which journey, and what do we ship first? |
| Retrospective | What do we keep, stop and try? |
| Impact / Effort | What do we do first, for what it brings and what it costs? |
| C4 context | Who uses the system, and what does it depend on? |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/sideco-next-dark.png">
  <img alt="An Impact / Effort board: four quadrants, Quick wins, Big bets, Fill-ins and Avoid, with the ideas of a shop sorted into them" src="docs/img/sideco-next.png">
</picture>

To show a board to your team, export it to Markdown, HTML, SVG, Mermaid or JSON, or let `sideco publish` turn every board into a static site. [Each workshop has its picture in the guide](docs/guide.md#workshops).

## Your data stays local

- Everything is an event in an append-only log, `.sideco/boards.jsonl`, in your project. Commit it: the board's history travels with the code. One writer at a time: two people who edit it each on their side get a merge conflict.
- The server listens on `127.0.0.1` only and refuses requests from another origin.
- Undo, redo and a history slider come from the same log.

## If something goes wrong

Ask Claude in plain words, or name the command.

| What you see | What to do |
| --- | --- |
| Claude answers in the terminal and no board opens | Name it: *"on the Sideco board"*. If nothing changes, start Claude Code again and check that `claude plugin list` shows `sideco` |
| The page did not open | Ask Claude to run `sideco url`: it prints the address to open, `http://127.0.0.1:4747` unless that port was taken |
| Claude reports `this shell may not connect to the companion` | Claude Code's sandbox blocks local connections: let Claude run the command outside it, or [allow them once](docs/guide.md#with-claude-codes-sandbox) |
| `sideco: Sideco runs on Bun 1.4 or later, not found` | Install [Bun](https://bun.sh), then start Claude Code again. An older Bun is not detected: check with `bun --version` |
| The board is stuck or out of date | Ask Claude to run `sideco stop`, then `sideco url`: the server starts again from the same log |
| You want it gone | `claude plugin uninstall sideco@sideco`; the `.sideco/` folder of each project is yours to keep or delete |

Anything else: [open an issue](https://github.com/bastien-gallay/sideco/issues), with the output of `sideco status`.

## Learn more

| Document | What is in it |
| --- | --- |
| [Guide](docs/guide.md) | Other ways to install, the gestures of the page, every workshop, the sandbox, known limits |
| [Guide détaillé](docs/guide.fr.md), in French | The same and more: the full CLI, labels, search, the data format |
| [Contributing](CONTRIBUTING.md) | How to work on Sideco, with links to the coding standards and the PRD |

The code is under the [MIT](LICENSE) license.
