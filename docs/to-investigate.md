# To investigate

Oddities seen once, harmless so far, not yet understood. Each entry keeps what
was seen and what was ruled out, so whoever meets it again starts from there
rather than from zero.

An entry leaves this page when it is understood: as a bug card on the backlog
board if it needs a fix, or deleted if it was nothing.

| Field | What goes in it |
| --- | --- |
| Seen | Date, where, by whom, and the exact message |
| Ruled out | What was checked, and how |
| Hypothesis | Unverified, with what would verify it |
| If it comes back | What to note at that moment |

## I1 · Firefox's console says the page may not load `file:///`

**Seen**: 2026-11-21, by the user, in Firefox's web console (not Safari, as
first written here), on the `types-de-boards` board
(`http://127.0.0.1:4747/#/b/types-de-boards`). The message, in French:

```text
Erreur de sécurité : le contenu situé à http://127.0.0.1:4747/#/b/types-de-boards
ne peut pas charger de données ou établir un lien vers file:///.
```

Firefox prints this when something running in a page served over `http://`
tries to load or open a `file:` URL. It was a console line only: nothing
visible broke.

**Ruled out**, the same day:

| Where | How | Result |
| --- | --- | --- |
| The board's content | `sideco show types-de-boards` and its notes in the journal, searched for `file:` and Markdown links | none |
| The page as served | the HTML (230 kB, scripts inline, no source map) searched for `file:` | none |
| The page's code | `src/web/*.ts` searched for `location.href`, `location.assign`, `window.open`, `new URL(` and native drag and drop (`drop`, `dragover`, `dataTransfer`) | none |
| Links in details | `src/web/markdown.ts` renders a link only for `http(s)://` and `mailto:` | cannot produce `file:` |
| The worker | `/stream-worker.js` as served, searched for `file:`, `sourceMappingURL`, `sourceURL` | none |

**Hypotheses** (unverified), the page's own code being ruled out:

- Something that is not the page, also logged to its console: an extension,
  or the developer tools themselves. To verify: the same page in a private window without extensions.
- A native drag: a file dropped on the page makes Firefox try to open it, and
  the page does not catch native drops. To verify: drop a file from the
  Finder on the page with the console open. If it is that, the fix is small:
  `preventDefault` on `dragover` and `drop` for the whole page.

**If it comes back**: note the browser, the gesture just before (drop, click
on a link, reload, resolving a note), the source the console gives on the
right of the line, and whether anything failed.
