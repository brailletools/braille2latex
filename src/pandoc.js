// @ts-nocheck
// Thin, lazily-loaded wrapper around pandoc-wasm's convert(). pandoc-wasm's
// browser entry does a top-level `await import('./pandoc.wasm')` the instant
// its own module is evaluated — there's no built-in laziness, and the wasm
// binary is ~56MB — so this module exists specifically to make sure
// 'pandoc-wasm' itself is only ever dynamically imported on first actual use,
// never eagerly just because something imported this file (or, transitively,
// this whole package). Consuming bundlers (e.g. Vite) correctly code-split a
// lazy `import()` like loadPandoc()'s into its own chunk, only fetched if a
// function here is actually called — so depending on this module does NOT
// pull pandoc-wasm's ~56MB into a browser bundle by itself. A consuming
// bundler will still need its own build-side config for pandoc-wasm's wasm
// asset + top-level-await syntax regardless of where in the source tree the
// import lives (see webeditor/vite.config.js's build.target/assetsInclude
// for a worked example, and its doc comments for why).
//
// Node's entry point (used automatically when this file is imported from
// Node, e.g. by bin/braille-bridge.js) reads the wasm binary straight from
// disk (already unpacked by npm/pnpm install) — no network fetch, no
// top-level-await bundler restrictions, nothing extra to configure there.
//
// API notes (verified empirically against pandoc-wasm 1.1.0, since its README
// examples for binary input formats are incomplete): convert(options, stdin,
// files) takes the *text* input via `stdin` for text formats (e.g. latex,
// markdown), but binary input formats (e.g. docx) require BOTH the file's
// bytes in `files` AND its name repeated in `options['input-files']` --
// passing it only via `files` silently produces a "not enough bytes" error
// instead of reading the file.

/** @type {Promise<typeof import('pandoc-wasm')> | null} */
let pandocModulePromise = null;

function loadPandoc() {
	if (!pandocModulePromise) {
		pandocModulePromise = import('pandoc-wasm');
	}
	return pandocModulePromise;
}

/**
 * Converts text from one Pandoc-supported text format to another (e.g. LaTeX
 * -> Markdown, or Markdown -> reStructuredText). Not for formats that need
 * binary input/output (e.g. Word, ODT) — use convertToBinaryFormat()/
 * convertFromBinaryFormat() for those.
 * @param {string} text
 * @param {string} from - Pandoc reader format name (e.g. 'latex', 'markdown')
 * @param {string} to - Pandoc writer format name (e.g. 'markdown', 'rst')
 * @param {object} [extraOptions] - additional Pandoc options merged in verbatim
 *   (e.g. `{ standalone: true }` to wrap the output as a complete document
 *   instead of a body fragment)
 * @returns {Promise<string>}
 */
export async function convertText(text, from, to, extraOptions = {}) {
	const { convert } = await loadPandoc();
	const result = await convert({ from, to, ...extraOptions }, text, {});
	if (result.stderr) throw new Error(result.stderr);
	return result.stdout;
}

/**
 * Converts text to a binary-format document (e.g. Word .docx, ODT) via
 * Pandoc. Any Pandoc writer name is accepted, not just docx — this is the
 * generic path for target formats that can't just be a stdout string.
 * @param {string} text
 * @param {string} from - Pandoc reader format name (e.g. 'markdown')
 * @param {string} to - Pandoc writer format name (e.g. 'docx', 'odt')
 * @param {object} [extraOptions] - additional Pandoc options merged in verbatim
 * @returns {Promise<Blob>}
 */
export async function convertToBinaryFormat(text, from, to, extraOptions = {}) {
	const { convert } = await loadPandoc();
	const outputFile = `output.${to}`;
	const result = await convert({ from, to, 'output-file': outputFile, ...extraOptions }, text, {});
	if (result.stderr) throw new Error(result.stderr);
	const blob = result.files[outputFile];
	if (!blob) throw new Error(`Conversion to ${to} produced no output file.`);
	return blob;
}

/**
 * Converts a binary-format document (e.g. an uploaded Word .docx file) to
 * text, via Pandoc. Any Pandoc reader name is accepted, not just docx.
 * @param {ArrayBuffer | Blob} data
 * @param {string} from - Pandoc reader format name (e.g. 'docx', 'odt')
 * @param {string} to - Pandoc writer format name (e.g. 'markdown')
 * @param {object} [extraOptions] - additional Pandoc options merged in verbatim
 * @returns {Promise<string>}
 */
export async function convertFromBinaryFormat(data, from, to, extraOptions = {}) {
	const { convert } = await loadPandoc();
	const inputFile = `input.${from}`;
	const blob = data instanceof Blob ? data : new Blob([data]);
	const result = await convert({ from, to, 'input-files': [inputFile], ...extraOptions }, null, { [inputFile]: blob });
	if (result.stderr) throw new Error(result.stderr);
	return result.stdout;
}
