# @brailletools/braille2latex

JavaScript library and CLI for converting Braille Readiness Format (BRF) files to LaTeX,
Markdown, or (via [Pandoc](https://pandoc.org/)) any other format Pandoc can write —
and for building a live-synced braille⟷LaTeX/Markdown editor (see `DualDocument` below).
Supports Nemeth math notation and UEB text via [liblouis](https://github.com/liblouis/liblouis.js).

## Install

Not yet published to the npm registry. Until then, install directly from GitHub:

```bash
npm install github:brailletools/braille2latex
```

Once published, the usual form will work:

```bash
npm install @brailletools/braille2latex
```

`configure()` (browser-side back-translation, see below) needs `liblouis.EasyApiAsync`
loaded as a global via a `<script>` tag; braille2latex has no npm dependency for that.

This package depends on [`pandoc-wasm`](https://github.com/pandoc/pandoc-wasm) (~56MB
unpacked) for `convertText()`/`convertToBinaryFormat()`/`convertFromBinaryFormat()` and
for the CLI's non-`latex`/`markdown` `--format` values — that's a one-time install-time
disk cost, not a runtime download cost: in Node it reads its wasm binary straight from
disk, and in a browser bundler it's only fetched over the network the first time one of
those functions is actually called (see [`src/pandoc.js`](./src/pandoc.js)'s doc comment —
a bundler that respects lazy `import()` code-splitting, e.g. Vite, will never fetch it for
a consumer that never calls those functions at all).

## API

### `configure({ liblouisCapiUrl, liblouisEasyApiUrl, liblouisTablesUrl? })`

Must be called once before `DualDocument.fromBraille()`/`fromMarkdown()` (or any other
translation in this package that doesn't supply its own `translate`/`translateForward`
override). Provides the URLs to the liblouis WebAssembly build. Requires
`liblouis.EasyApiAsync` to already be available as a global — load the vendored
`easy-api.js` via a `<script>` tag before calling `configure()`; braille2latex doesn't fetch
or inject that script itself (see [Usage in SvelteKit / browser](#usage-in-sveltekit--browser)
below). `liblouisTablesUrl` is only needed for a "no-tables" build (tables loaded on demand
rather than compiled in).

### `whenReady()`

Resolves once `configure()` has finished setting up the liblouis backend (or rejects if
setup failed). Exposed separately for callers that want to gate UI state (e.g. a loading
indicator) on readiness without triggering a load.

### `lex(text)`

The BRF tokenizer — parses braille (ASCII/NABCC) text into the token tree `DualDocument`
and `Element.to_latex()`/`to_markdown()` operate on. Exposed for callers who want the
parsed token tree directly, without going through `DualDocument`.

### `fromMarkdown(text, { table?, translateForward? })`

The reverse direction: parses Markdown source into the same token tree shape `lex()`
builds from braille, forward-translating recognized prose/bold/italic/math into
braille-ASCII as it goes. Unrecognized Markdown constructs (headings, lists, tables,
etc.) are never dropped — their raw source is translated like ordinary prose and the
enclosing paragraph is flagged (see `DualDocument.errors` below). Used internally by
`DualDocument.fromMarkdown()`.

### `ascii2Braille(str)` / `braille2Ascii(str)`

Convert between ASCII Braille notation and Unicode Braille characters.

### `nemeth_to_latex(str)`

Convert a line of Nemeth Braille (ASCII or Unicode) to a LaTeX math string.

### `latex_to_nemeth(str, options?)`

The reverse of `nemeth_to_latex()`: converts a LaTeX math expression (no surrounding
`$`/`$$` delimiters) to Nemeth Braille (ASCII). Unlike `nemeth_to_latex()`, this does
**not** tolerate incomplete/unbalanced LaTeX and does **not** fall back to passing
input through unchanged — it throws on invalid input, so callers can distinguish "no
translation available" from "here's a (possibly wrong) result." `options` is
forwarded to the underlying Abraham parser (e.g. `operatorNames`).

### `translateForward(text, table?)`

Forward-translates print text to Braille-ASCII using the liblouis WASM backend
configured via `configure()` — the mirror of back-translation. Requires `configure()`
to have been called first. If you need Unicode braille glyphs, pass the result through
`ascii2Braille()`.

### `convertText(text, from, to, extraOptions?)`

Converts text from one [Pandoc reader format](https://pandoc.org/MANUAL.html#general-options)
to another Pandoc writer format (e.g. `'latex'` → `'markdown'`, or `'markdown'` → `'rst'`).
Not for formats that need binary input/output (Word, ODT — see below). `extraOptions` is
merged verbatim into Pandoc's own options object — e.g. `{ standalone: true }` to wrap the
output as a complete document instead of a body fragment. Lazily loads `pandoc-wasm` on
first call (see the note in Install above).

### `convertToBinaryFormat(text, from, to, extraOptions?)`

Converts text to a binary-format document (Word `.docx`, ODT, …) via Pandoc, returning a
`Blob`. Any Pandoc writer name is accepted.

### `convertFromBinaryFormat(data, from, to, extraOptions?)`

Converts a binary-format document (`Blob`/`ArrayBuffer` — e.g. an uploaded `.docx` file) to
text via Pandoc. Any Pandoc reader name is accepted.

### `DualDocument`

A canonical braille⟷LaTeX/Markdown document model for building a side-by-side editor
where braille and one other format are directly editable and stay in sync at
paragraph/equation granularity (not full-document, not character-by-character). Wraps
the same `lex()`/`to_latex()`/`to_markdown()` tree.

```js
import { DualDocument } from '@brailletools/braille2latex';

const doc = await DualDocument.fromBraille(brfText, { table: 'en-ueb-g2.ctb' });
doc.brailleText; // current braille source
doc.latexText;   // current generated LaTeX (kept eagerly in sync)
await doc.renderMarkdown(); // current generated Markdown (rendered on demand, not kept eagerly in sync)

// Apply an edit made in the braille pane (full new value + caret offset):
const { latexText, latexCursor } = await doc.applyBrailleEdit(newBrailleText, cursorOffset);

// Apply an edit made in the LaTeX pane:
const { brailleText, brailleCursor, nodeError } = await doc.applyLatexEdit(newLatexText, cursorOffset);

// Or, symmetrically, an edit made in the Markdown pane (call renderMarkdown() at
// least once first so its ranges are populated):
const { brailleText: b2, brailleCursor: c2 } = await doc.applyMarkdownEdit(newMarkdownText, cursorOffset);

// Nodes currently out of sync, or flagged at import time (e.g. an unrecognized
// Markdown construct — see fromMarkdown() above):
doc.errors; // [{ nodeId, pane, label, range, brailleRange, message }, ...]
```

`applyBrailleEdit`/`applyLatexEdit`/`applyMarkdownEdit` all only re-derive the top-level
node(s) (paragraph or equation) actually touched by the edit, splice the result into the
existing text, and return a best-effort proportional cursor position for the other pane
(`mapCursor()` is also exposed directly for mapping an arbitrary offset on demand). On a
translation failure (bad syntax, or an edit spanning more than one paragraph/equation —
there's no LaTeX/Markdown lexer to rediscover new boundaries), the braille pane is left
untouched and the affected node appears in `doc.errors` instead. `fromBraille()`/
`fromMarkdown()` accept the same `translate`/`translateForward` override hooks used
throughout this package, for testing without a live liblouis worker.

---

## Usage in SvelteKit / browser

liblouis's own npm packages (`liblouis`/`liblouis-build`) are unmaintained (years behind current liblouis) and no longer importable as a bundler dependency. Fetch a current browser build instead with
[`@brailletools/liblouis-env-web`](https://github.com/brailletools/liblouis-env/tree/main/js/packages/web),
which writes a `manifest.json` describing what it fetched (filenames and build variant vary by pinned upstream commit — read the manifest rather than hardcoding them), then load the vendored `easy-api.js` as a plain `<script>` so it's available as a global before `configure()` runs — braille2latex itself has no dependency on `@brailletools/liblouis-env-web` or on any script-loading mechanism; where static assets live and how they're loaded is app-specific, so that step belongs here, in the consuming app:

```json
// package.json
"scripts": {
  "dev":   "liblouis-fetch-web static/liblouis && vite dev",
  "build": "liblouis-fetch-web static/liblouis && vite build"
}
```

```html
<!-- app.html -->
<script src="%sveltekit.assets%/liblouis/easy-api.js"></script>
```

```js
// +page.svelte
import { base } from '$app/paths';
import { configure, whenReady, DualDocument } from '@brailletools/braille2latex';
import manifest from '../../static/liblouis/manifest.json';

const b = base === '/' ? '' : base;
configure({
  liblouisCapiUrl:    `.${b}/liblouis/${manifest.buildFile}`,
  liblouisEasyApiUrl: `.${b}/liblouis/${manifest.easyApiFile}`,
  // Only needed when manifest.variant === 'no-tables':
  liblouisTablesUrl:  `.${b}/liblouis/${manifest.tablesDir}/`,
});
await whenReady();

const doc = await DualDocument.fromBraille(brfFileContents);
const latex = doc.latexText;
```

## Command-line usage

```bash
braille2latex <file.brf> [--table TABLE | --dictionary TABLE] [--format FORMAT] [--full-doc] [--braille-only] [-o FILE]
```

- `--table TABLE` / `--dictionary TABLE` — liblouis table to translate with (default: `en-ueb-g2.ctb`).
- `--format FORMAT` — output format (default: `latex`). `latex` and `markdown` are hand-rolled
  by this package directly (no Pandoc involved). Any other value is treated as a
  [Pandoc writer name](https://pandoc.org/MANUAL.html#general-options) (e.g. `docx`, `odt`,
  `rst`, `html`, `epub`) — the braille is rendered to Markdown first, then Pandoc converts
  Markdown → `FORMAT`. Binary writers (`docx`, `odt`, `pptx`, `epub`, `epub2`, `epub3`)
  require `-o`, since their output can't sensibly go to stdout.
- `--full-doc` — wrap the output in a complete document instead of just the translated body.
  For `latex`/`markdown` this is a hand-rolled wrapper (`\documentclass`...`\end{document}`,
  or a Markdown frontmatter block); for any Pandoc-routed format it maps to Pandoc's own
  `standalone` option.
- `--braille-only` — skip text back-translation entirely and always emit Unicode Braille for text sections
  (no external binary needed; Nemeth math is always converted regardless via the bundled Abraham parser).
- `-o, --output FILE` — write to `FILE` instead of stdout.

Nemeth math sections are fully converted via the bundled [Abraham](#credits) parser (pure JS, no
setup required). Text sections are back-translated by shelling out to a `lou_translate` binary,
resolved via [`@brailletools/liblouis-env`](https://github.com/brailletools/liblouis-env/tree/main/js/packages/node)
(checks the `LOU_TRANSLATE_PATH` environment variable, then `PATH`); if none is found, text falls back
to Unicode Braille and a note is printed to stderr. This command never installs anything itself — to
install `lou_translate` in one step, run:

```bash
npx liblouis-fetch
```

Examples:

```bash
braille2latex "Sample Quiz.brf" --full-doc -o quiz.tex
braille2latex "Sample Quiz.brf" --dictionary en-ueb-g2.ctb
braille2latex "Sample Quiz.brf" --format rst
braille2latex "Sample Quiz.brf" --format docx -o quiz.docx
```

## Credits

- [Abraham](https://www.desmos.com/api/v1.11/docs/abraham.html) (Desmos) — Nemeth to LaTeX
- [liblouis](https://github.com/liblouis/liblouis.js) — Braille back-translation (LGPL v2.1+)
