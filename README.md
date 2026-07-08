# @brailletools/braille2latex

JavaScript library for converting Braille Readiness Format (BRF) files to LaTeX.
Supports Nemeth math notation and UEB text via [liblouis](https://github.com/liblouis/liblouis.js).

## Install

```bash
npm install @brailletools/braille2latex liblouis
```

## API

### `configure({ liblouisCapiUrl, liblouisEasyApiUrl })`

Must be called once before `parse()`. Provides the URLs (browser) or file paths (Node.js)
to the liblouis WebAssembly build.

### `parse(text, table?)`

Converts a BRF string (ASCII Braille) to LaTeX. Returns a `Promise<string>`.
Requires `configure()` to have been called first.

Default table: `en-ueb-g2.ctb` (English UEB Grade 2).

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

## Command-line sample (Node.js)

For quick conversions from the terminal — Nemeth math sections are fully converted;
text sections are shown as Unicode Braille (liblouis back-translation requires a browser Worker):

```bash
node sample.mjs "Sample Quiz.brf"
```

See [sample.mjs](./sample.mjs) for the full script.

## Credits

- [Abraham](https://www.desmos.com/api/v1.11/docs/abraham.html) (Desmos) — Nemeth to LaTeX
- [liblouis](https://github.com/liblouis/liblouis.js) — Braille back-translation (LGPL v2.1+)
