# Sideco

[![CI](https://github.com/bastien-gallay/sideco/actions/workflows/ci.yml/badge.svg)](https://github.com/bastien-gallay/sideco/actions/workflows/ci.yml)

**A visual companion for Claude Code: a live board, open beside your terminal, that you and your agent model on together.**

![An event storming in Sideco: the palette on the left, the board in the middle, Claude's session on the right, the hand-over bar at the bottom](docs/img/sideco-event-storming.png)

<sub>Captured by the end-to-end test `tests/e2e/companion.test.ts`. A diamond marks a card Claude placed, a dot one you placed; the blue outline shows what just changed.</sub>

You ask Claude to model something (an ordering flow, a backlog, a retrospective). Claude lays out the cards; you rename, move, link and annotate them in the page; you hand over, and Claude reads exactly what you changed. The conversation stays in the terminal.

## Install

You need [Bun](https://bun.sh) 1.4 or later and Claude Code. Sideco has no other runtime dependency.

```sh
git clone https://github.com/bastien-gallay/sideco.git ~/sideco
claude plugin marketplace add ~/sideco
claude plugin install sideco@sideco
```

Then, in any project, start Claude Code and ask: *"let's model the checkout flow on the board"*. Claude creates the workspace, starts the companion and opens the page. There is nothing else to launch.

To try it without installing, pass the plugin for one session:

```sh
claude --plugin-dir ~/sideco
```

## The loop

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Page as Sideco page
    participant Sideco as Companion (local server)
    participant Claude as Claude Code (terminal)

    Claude->>Sideco: sideco apply (a batch of cards)
    Sideco-->>Page: events, shown in ~20 ms
    Claude->>Sideco: sideco pass "Who reserves the stock?"
    You->>Page: rename, move, link, annotate
    You->>Page: Hand over to Claude
    Sideco-->>Claude: your changes, summarised
    Claude->>Sideco: sideco show, then the next step
```

<sub>Source: `src/server/http.ts`, `src/cli/hook.ts`. Latency measured by `tests/e2e/companion.test.ts`.</sub>

Your changes reach Claude whatever it is doing: waiting on you, working, or idle with the page open (it is woken up). The summary is net of back-and-forth: a card added then renamed reads as one addition.

## Workshops

| Workshop | The question it asks |
| --- | --- |
| `event-storming` | What happens in the domain, in what order? |
| `flow` | Which way do we go, and where does the path split? |
| `kanban` | Where is the work, and what blocks it? |
| `story-map` | Which journey, and what do we ship first? |
| `retro` | What do we keep, stop and try? |
| `impact-effort` | What do we do first, for what it brings and what it costs? |

Every board exports to Markdown, HTML, SVG, Mermaid or JSON, and `sideco publish` turns all of them into a static site.

## Your data stays local

- Everything is an event in an append-only log, `.sideco/boards.jsonl`, in your project. Commit it: the board's history travels with the code.
- The companion listens on `127.0.0.1` only and refuses requests from another origin.
- Undo, redo and a history slider come from the same log.

## Status

Early: version 0.1.0. One person and one active agent per workspace; two people editing the same `boards.jsonl` will get a merge conflict.

## Learn more

| Document | What is in it |
| --- | --- |
| [Detailed guide](docs/guide.fr.md) (French) | Every gesture in the page, the CLI, the Claude Code sandbox, the test suites, known limits |
| [PRD](docs/PRD.md) (French) | Why Sideco is built the way it is |
| `sideco help` | The full command list |

## License

[MIT](LICENSE)
