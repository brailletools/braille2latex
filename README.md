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

`liblouis` is an optional peer dependency, only needed if you call `configure()`/`parse()`
for browser-side back-translation (see below). The command-line tool doesn't need it.

## API

### `configure({ liblouisCapiUrl, liblouisEasyApiUrl })`

Must be called once before `parse()`. Provides the URLs (browser) or file paths (Node.js)
to the liblouis WebAssembly build.

### `parse(text, table?)`

Converts a BRF string (ASCII Braille) to LaTeX using the liblouis WASM backend. Returns a
`Promise<string>`. Requires `configure()` to have been called first.

Default table: `en-ueb-g2.ctb` (English UEB Grade 2).

### `parseWithTranslator(text, table, translate)`

Same as `parse()`, but with a caller-supplied back-translation backend instead of the
liblouis WASM Easy API — doesn't require `configure()`. `translate(unicodeBraille, table)`
should return `Promise<string>`. This is what the CLI uses (see below) to back-translate via
a `lou_translate` binary instead of the browser WASM build.

### `lex(text)`

The underlying BRF tokenizer, shared by `parse()` and `parseWithTranslator()`. Exposed for
callers who want the parsed token tree without running back-translation.

### `ascii2Braille(str)` / `braille2Ascii(str)`

Convert between ASCII Braille notation and Unicode Braille characters.

### `nemeth_to_latex(str)`

Convert a line of Nemeth Braille (ASCII or Unicode) to a LaTeX math string.

---

## Usage in SvelteKit / browser

```js
import { base } from '$app/paths';
import { configure, parse } from '@brailletools/braille2latex';

const b = base === '/' ? '' : base;
configure({
  liblouisCapiUrl:    `.${b}/liblouis/build-tables-embeded-root-utf16.js`,
  liblouisEasyApiUrl: `.${b}/liblouis/easy-api.js`,
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
setup required). Text sections are back-translated by shelling out to a `lou_translate` binary if one
can be found (the `LOU_TRANSLATE_PATH` environment variable, or `lou_translate` already on `PATH`); if
none is found, text falls back to Unicode Braille and a note is printed to stderr. This command never
installs anything itself — for a one-step, cross-platform way to install `lou_translate`, use
[liblouis-env](https://github.com/brailletools/liblouis-env) (run `liblouis-fetch` once).

Examples:

```bash
braille2latex "Sample Quiz.brf" --full-doc -o quiz.tex
braille2latex "Sample Quiz.brf" --dictionary en-ueb-g2.ctb
```

## Credits

- [Abraham](https://www.desmos.com/api/v1.11/docs/abraham.html) (Desmos) — Nemeth to LaTeX
- [liblouis](https://github.com/liblouis/liblouis.js) — Braille back-translation (LGPL v2.1+)
