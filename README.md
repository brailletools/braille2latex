# @brailletools/braille2latex

JavaScript library and CLI for converting Braille Readiness Format (BRF) files to LaTeX.
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

For the command tool, `@brailletools/liblouis-env` (resolving `lou_translate`) is its only dependency. `configure()`/`parse()` (browser-side back-translation,
see below) need `liblouis.EasyApiAsync` loaded as a global via a `<script>` tag; braille2latex has no npm dependency for that either.

## API

### `configure({ liblouisCapiUrl, liblouisEasyApiUrl, liblouisTablesUrl? })`

Must be called once before `parse()`. Provides the URLs to the liblouis WebAssembly build.
Requires `liblouis.EasyApiAsync` to already be available as a global — load the vendored
`easy-api.js` via a `<script>` tag before calling `configure()`; braille2latex doesn't fetch
or inject that script itself (see [Usage in SvelteKit / browser](#usage-in-sveltekit--browser)
below). `liblouisTablesUrl` is only needed for a "no-tables" build (tables loaded on demand
rather than compiled in).

### `parse(text, table?)`

Converts a BRF string (ASCII Braille) to LaTeX using the liblouis WASM backend. Returns a
`Promise<string>`. Requires `configure()` to have been called first.

Default table: `en-ueb-g2.ctb` (English UEB Grade 2).

### `parseWithTranslator(text, table, translate)`

Same as `parse()`, but with a caller-supplied back-translation backend instead of the
liblouis WASM Easy API — doesn't require `configure()`. `translate(unicodeBraille, table)`
should return `Promise<string>`. This is what the CLI uses (see below) to back-translate via
a `lou_translate` binary. 

### `lex(text)`

The underlying BRF tokenizer, shared by `parse()` and `parseWithTranslator()`. Exposed for
callers who want the parsed token tree without running back-translation.

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

Forward-translates print text to Unicode Braille using the liblouis WASM backend
configured via `configure()` — the mirror of `parse()`'s back-translation direction.
Requires `configure()` to have been called first, same as `parse()`.

### `DualDocument`

A canonical braille⟷LaTeX document model for building a side-by-side editor where
both representations are directly editable and stay in sync at paragraph/equation
granularity (not full-document, not character-by-character). Wraps the same `lex()`/
`to_latex()` tree used by `parse()`.

```js
import { DualDocument } from '@brailletools/braille2latex';

const doc = await DualDocument.fromBraille(brfText, { table: 'en-ueb-g2.ctb' });
doc.brailleText; // current braille source
doc.latexText;   // current generated LaTeX

// Apply an edit made in the braille pane (full new value + caret offset):
const { latexText, latexCursor } = await doc.applyBrailleEdit(newBrailleText, cursorOffset);

// Apply an edit made in the LaTeX pane:
const { brailleText, brailleCursor, nodeError } = await doc.applyLatexEdit(newLatexText, cursorOffset);

// Nodes currently out of sync (translation failed for that paragraph/equation):
doc.errors; // [{ nodeId, pane, label, range, message }, ...]
```

Both `applyBrailleEdit`/`applyLatexEdit` only re-derive the top-level node(s)
(paragraph or equation) actually touched by the edit, splice the result into the
existing text, and return a best-effort proportional cursor position for the other
pane. On a LaTeX-side translation failure (bad syntax, or an edit spanning more than
one paragraph/equation — there's no LaTeX lexer to rediscover new boundaries), the
braille pane is left untouched and the affected node appears in `doc.errors` instead.
`fromBraille()` accepts the same `translate`/`translateForward` override hooks as
`parseWithTranslator()`, for testing without a live liblouis worker.

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
import { configure, parse } from '@brailletools/braille2latex';
import manifest from '../../static/liblouis/manifest.json';

const b = base === '/' ? '' : base;
configure({
  liblouisCapiUrl:    `.${b}/liblouis/${manifest.buildFile}`,
  liblouisEasyApiUrl: `.${b}/liblouis/${manifest.easyApiFile}`,
  // Only needed when manifest.variant === 'no-tables':
  liblouisTablesUrl:  `.${b}/liblouis/${manifest.tablesDir}/`,
});

const latex = await parse(brfFileContents);
```

## Command-line usage

```bash
braille2latex <file.brf> [--table TABLE | --dictionary TABLE] [--full-doc] [--braille-only] [-o FILE]
```

- `--table TABLE` / `--dictionary TABLE` — liblouis table to translate with (default: `en-ueb-g2.ctb`).
- `--full-doc` — wrap the output in a complete, compilable LaTeX document (`\documentclass`...`\end{document}`).
  Without it, only the translated body is printed.
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
```

## Credits

- [Abraham](https://www.desmos.com/api/v1.11/docs/abraham.html) (Desmos) — Nemeth to LaTeX
- [liblouis](https://github.com/liblouis/liblouis.js) — Braille back-translation (LGPL v2.1+)
