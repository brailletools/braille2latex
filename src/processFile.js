// @ts-nocheck
import { nemeth_to_latex, latex_to_nemeth, ascii2Braille } from './brailleMap.js';

let asyncLiblouis = null;
let liblouisReadyPromise = null;

/**
 * Configure the liblouis backend. Must be called before DualDocument.fromBraille()/
 * fromMarkdown() (or any other translation in this package that doesn't supply
 * its own translate/translateForward override).
 *
 * Expects `globalThis.LiblouisEasyApiAsync` to already be available — load the
 * vendored easy-api.js (fetched at build time by @brailletools/liblouis-env-web's
 * `liblouis-fetch-web`) via a plain <script> tag in your app's HTML template
 * before calling configure(). braille-bridge doesn't fetch or inject that script
 * itself: where static assets live and how they're loaded is app-specific (e.g.
 * SvelteKit's app.html), so that's the consuming app's job, not this library's.
 *
 * (easy-api.js's UMD "browser globals" branch sets `globalThis.liblouis` to an
 * *instance* of the sync EasyApi, and the async class as its own top-level global
 * `globalThis.LiblouisEasyApiAsync` — not nested under `liblouis`. See brailletools/braille2latex#16.)
 *
 * @param {object} options
 * @param {string} options.liblouisCapiUrl   - URL to the liblouis build (e.g. build-no-tables-utf32.js)
 * @param {string} options.liblouisEasyApiUrl - URL to easy-api.js
 * @param {string} [options.liblouisTablesUrl] - URL to a tables/ directory, required
 *   when the build behind liblouisCapiUrl doesn't have tables compiled in (e.g. a
 *   "no-tables" build from @brailletools/liblouis-env-web's manifest.json); enables
 *   on-demand table loading instead.
 *
 * Example (SvelteKit):
 *   <!-- app.html -->
 *   <script src="%sveltekit.assets%/liblouis/easy-api.js"></script>
 *
 *   // +page.svelte
 *   import { base } from '$app/paths';
 *   import { configure } from '@brailletools/braille-bridge';
 *   const b = base === '/' ? '' : base;
 *   configure({
 *     liblouisCapiUrl:    `.${b}/liblouis/build-no-tables-utf32.js`,
 *     liblouisEasyApiUrl: `.${b}/liblouis/easy-api.js`,
 *     liblouisTablesUrl:  `.${b}/liblouis/tables`,
 *   });
 */
export function configure({ liblouisCapiUrl, liblouisEasyApiUrl, liblouisTablesUrl }) {
	liblouisReadyPromise = (async () => {
		const EasyApiAsync = globalThis.LiblouisEasyApiAsync;
		if (!EasyApiAsync) {
			throw new Error(
				'[braille-bridge] configure() needs `LiblouisEasyApiAsync` to already be available as a ' +
				'global. Load the vendored easy-api.js (see @brailletools/liblouis-env-web) via a <script> ' +
				'tag before calling configure() — see this package\'s README for a working example.'
			);
		}
		asyncLiblouis = new EasyApiAsync({
			capi:    liblouisCapiUrl,
			easyapi: liblouisEasyApiUrl,
		});
		asyncLiblouis.setLogLevel(0);
		if (liblouisTablesUrl) {
			asyncLiblouis.enableOnDemandTableLoading(liblouisTablesUrl);
		}
		await new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => reject(new Error('liblouis version() timed out')), 10000);
			asyncLiblouis.version(() => { clearTimeout(timeoutId); resolve(); });
		});
	})().catch(error => {
		console.error('[liblouis] Initialization failed', error);
		throw error;
	});
}

/**
 * Resolves once configure() has finished setting up the liblouis backend (or
 * rejects if setup failed). DualDocument.fromBraille()/fromMarkdown() already
 * await this internally before translating — this is exposed separately for
 * callers that want to gate UI state (e.g. a loading indicator) on readiness
 * without triggering a load.
 *
 * @returns {Promise<void>}
 */
export function whenReady() {
	if (!liblouisReadyPromise) throw new Error('Call configure() before whenReady()');
	return liblouisReadyPromise;
}

// Default liblouis table for back-translation if caller does not override
const defaultTable = 'en-ueb-g2.ctb';

// Default translate(unicodeBraille, table) backend: the liblouis WASM Easy API
// configured via configure(). Callers with a different backend (e.g. tests, or
// a non-browser translation source) pass their own translate function to
// to_latex()/DualDocument.fromBraille() instead.
async function defaultLiblouisTranslate(unicodeBraille, table) {
	return await new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error('backTranslateString timeout after .5 seconds'));
		}, 500);

		try {
			asyncLiblouis.backTranslateString(
				table,
				unicodeBraille,
				e => {
					clearTimeout(timeoutId);
					if (e === null || e === undefined) {
						reject(new Error('backTranslateString returned null or undefined'));
					} else {
						resolve(e);
					}
				}
			);
		} catch (syncError) {
			clearTimeout(timeoutId);
			reject(syncError);
		}
	});
}

// Unique within a single lex() call (reset at the top of lex()). Not stable across
// edits/re-parses — DualDocument (document.js) assigns its own persistent id to
// top-level nodes for that purpose.
let elementIdCounter = 0;

// Forward liblouis translation (print text -> braille), the mirror of
// defaultLiblouisTranslate's back-translation. Same worker, same promise/timeout
// shape; only `backtranslate` flips to false. Used by DualDocument.applyLatexEdit
// (document.js) to translate an edited prose (STRING/BOLD/ITALIC) node's LaTeX text
// back into braille.
async function defaultLiblouisTranslateForward(text, table) {
	return await new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error('translateString timeout after .5 seconds'));
		}, 500);

		try {
			asyncLiblouis.translateString(
				table,
				text,
				false,
				e => {
					clearTimeout(timeoutId);
					if (e === null || e === undefined) {
						reject(new Error('translateString returned null or undefined'));
					} else {
						resolve(e);
					}
				}
			);
		} catch (syncError) {
			clearTimeout(timeoutId);
			reject(syncError);
		}
	});
}

/**
 * Forward-translates print text to braille using the liblouis WASM backend
 * configured via configure(). This returns liblouis's braille output in
 * braille-ASCII (not Unicode braille glyphs); use ascii2Braille() if you need Unicode.
 *
 * @param {string} text
 * @param {string} table
 * @returns {Promise<string>} Braille-ASCII
 */
export async function translateForward(text, table = defaultTable) {
	if (typeof text !== 'string') throw new Error('Input must be a string');
	if (!liblouisReadyPromise) throw new Error('Call configure() before translateForward()');

	await liblouisReadyPromise;
	return await defaultLiblouisTranslateForward(text, table);
}

export const tokens = {
	ROOT: 'ROOT',
	NEMETH: 'NEMETH',
	NEMETHSTART: 'NEMETHSTART',
	NEMETHSTOP: 'NEMETHSTOP',
	EQUATION: 'EQUATION',
	BOLD: 'BOLD',
	ITALIC: 'ITALIC',
	STRING: 'STRING',
	PARA: 'PARA'
};

const tokenStrings = {
	[tokens.NEMETHSTART]: '_%',
	[tokens.NEMETHSTOP]: '_:',
	[tokens.BOLD]: '_.',
	[tokens.ITALIC]: '_/'
};

class Element {
	constructor(token, parent = null) {
		this.id = elementIdCounter++;
		this.token = token; // token type stored at this node
		this.value = undefined; // text content for STRING/NEMETH/etc.
		this.children = []; // nested token nodes
		this.parent = parent; // parent node pointer
		// Offsets into the braille source / generated LaTeX or Markdown string.
		// Only populated for top-level (ROOT-child) nodes — see
		// assignTopLevelBrailleRanges() and the ROOT case of to_latex()/
		// to_markdown(). latexRange/markdownRange are populated lazily, only for
		// whichever format was most recently rendered (see DualDocument's
		// renderLatex()/renderMarkdown()/setLiveFormat() in document.js) — this
		// package doesn't keep both eagerly in sync.
		this.brailleRange = null;
		this.latexRange = null;
		this.markdownRange = null;
		// PARA nodes only: true once assignParaChildBrailleRanges() has verified its
		// marker-only boundary scan exactly matches this node's real children (count
		// + token-type-in-order), meaning every child's brailleRange above is safe to
		// use for splicing. Left undefined (falsy) otherwise -- applyLatexEdit treats
		// that as "fall back to regenerating the whole node," never guesses.
		this.childRangesReliable = undefined;
		// Top-level nodes built by fromMarkdown() only: the exact source slice this
		// node was parsed from, verbatim. Not read by anything in this package yet —
		// seeded for a future "ground truth format" feature (see the webeditor
		// plan's "Round-trip fidelity" notes) so re-exporting an imported document
		// won't need to retrofit the import path to recover this later.
		this.importedSource = undefined;
		this.reset_latex();
		this.reset_markdown();
	}

	push(token) {
		this.children.push(new Element(token, this));
		return this.children[this.children.length - 1];
	}

	add_character(char) {
		if (this.value === undefined) this.value = '';
		this.value += char;
	}

	set_value(value) {
		this.value = value;
	}

	get_value() {
		return this.value || '';
	}

	get_unicode_value() {
		if (!this.value) return '';
		return ascii2Braille(this.value) || '';
	}

	get_token() {
		return this.token;
	}

	check_for_equation() {
		if (this.token === tokens.PARA && this.children.length === 1 && this.children[0].token === tokens.NEMETH) {
			this.token = tokens.EQUATION;
		}
	}

	print(indent = 0) {
		console.info(' '.repeat(indent) + this.token + ':' + this.get_unicode_value() + ':');
		this.children.forEach(child => child.print(indent + 2));
	}

	async add_latex(string) {
		this.latex += string;
	}

	async reset_latex() {
		this.latex = '';
	}

	get_latex() {
		return this.latex;
	}

	async add_markdown(string) {
		this.markdown += string;
	}

	async reset_markdown() {
		this.markdown = '';
	}

	get_markdown() {
		return this.markdown;
	}

	// Back-translates this node's own .value (used by STRING, BOLD, and ITALIC
	// nodes, which all hold their text directly rather than in child nodes).
	// Falls back to the raw ASCII value if conversion or translation fails.
	async translate_value(table, translate) {
		const stringValue = this.get_value();
		const unicodeBraille = ascii2Braille(stringValue);

		if (!unicodeBraille || unicodeBraille.length === 0) {
			console.warn('[processFile] Warning: ascii2Braille returned empty string for:', JSON.stringify(stringValue));
			return stringValue;
		}

		try {
			return await translate(unicodeBraille, table);
		} catch (error) {
			console.warn('[processFile] Back-translation failed, using fallback:', error.message);
			return stringValue;
		}
	}

	async to_latex(table = defaultTable, translate = defaultLiblouisTranslate) {
		// Walk the tree and build LaTeX using the chosen translation table.
		// translate(unicodeBraille, table) back-translates a STRING node's text;
		// defaults to the liblouis WASM backend set up via configure().
		this.reset_latex();
		switch (this.token) {
			case tokens.ROOT:
				for (const child of this.children) {
					try {
						const startLen = this.latex.length;
						const childLatex = await child.to_latex(table, translate);
						this.add_latex(childLatex);
						child.latexRange = { start: startLen, end: startLen + childLatex.length };
					} catch (error) {
						console.error('[processFile] Error processing ROOT child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				break;
			case tokens.PARA:
				for (const child of this.children) {
					try {
						const childLatex = await child.to_latex(table, translate);
						const startsWithDisplayMath = /^\s*\$\$/.test(childLatex);
						if (startsWithDisplayMath && this.latex.length > 0 && !this.latex.endsWith('\n\n')) {
							// Ensure display math starts on its own line when it follows text
							this.add_latex('\n\n');
						}
						// Node-relative (0-based at this PARA's own latex start), mirroring
						// the ROOT case above one level down — see applyLatexEdit's use of
						// this for splicing only the touched child(ren)'s braille.
						const startLen = this.latex.length;
						this.add_latex(childLatex);
						child.latexRange = { start: startLen, end: startLen + childLatex.length };
					} catch (error) {
						console.error('[processFile] Error processing PARA child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				this.add_latex('\n\n');
				break;
			case tokens.NEMETH: {
				// Handle multi-line Nemeth blocks as display math
		        const nemethLines = (this.value || '').split('\n');
				if (nemethLines.length > 1) {
					// Multi-line: wrap each line individually in display math
					// Ensure display math starts on its own line when following text
					if (this.latex.length > 0 && !this.latex.endsWith('\n\n')) {
						this.add_latex('\n');
					}
					nemethLines.forEach((line) => {
						const latex = nemeth_to_latex(line);
						if (latex && latex.trim() !== '') {
							this.add_latex('$$' + latex + '$$\n');
						}
					});
				} else {
					// Single line: inline math
					this.add_latex('$' + nemeth_to_latex(this.value || '') + '$');
				}
				break; // inline math from Nemeth
			}
			case tokens.EQUATION:
				// EQUATION contains a single NEMETH child that will add its own $ delimiters
				for (const child of this.children) {
					try {
						this.add_latex(await child.to_latex(table, translate));
					} catch (error) {
						console.error('[processFile] Error processing EQUATION child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				this.add_latex('\n\n');
				break;
			case tokens.BOLD:
				this.add_latex('\\textbf{');
				if (this.value) this.add_latex(await this.translate_value(table, translate));
				for (const child of this.children) {
					try {
						this.add_latex(await child.to_latex(table, translate));
					} catch (error) {
						console.error('[processFile] Error processing BOLD child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				this.add_latex('}');
				break;
			case tokens.ITALIC:
				this.add_latex('\\textit{');
				if (this.value) this.add_latex(await this.translate_value(table, translate));
				for (const child of this.children) {
					try {
						this.add_latex(await child.to_latex(table, translate));
					} catch (error) {
						console.error('[processFile] Error processing ITALIC child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				this.add_latex('}');
				break;
			case tokens.STRING:
				if (this.value) this.add_latex(await this.translate_value(table, translate));
				break;
			default:
				console.info('Unknown token: ' + this.token);
		}
		return this.get_latex();
	}

	// Renders the same tree to Markdown instead of LaTeX. Structurally a sibling
	// of to_latex() above (same walk, same per-node startLen/childLatex-style
	// range bookkeeping) — kept as its own parallel switch rather than a shared
	// abstraction, since the two grammars only really agree on the math
	// delimiters (Pandoc's Markdown math extension uses the identical
	// $...$/$$...$$ syntax we already emit for LaTeX, so nemeth_to_latex() is
	// reused as-is here too).
	async to_markdown(table = defaultTable, translate = defaultLiblouisTranslate) {
		this.reset_markdown();
		switch (this.token) {
			case tokens.ROOT:
				for (const child of this.children) {
					try {
						const startLen = this.markdown.length;
						const childMarkdown = await child.to_markdown(table, translate);
						this.add_markdown(childMarkdown);
						child.markdownRange = { start: startLen, end: startLen + childMarkdown.length };
					} catch (error) {
						console.error('[processFile] Error processing ROOT child:', error.message, 'token:', child.token);
					}
				}
				break;
			case tokens.PARA:
				for (const child of this.children) {
					try {
						const childMarkdown = await child.to_markdown(table, translate);
						const startsWithDisplayMath = /^\s*\$\$/.test(childMarkdown);
						if (startsWithDisplayMath && this.markdown.length > 0 && !this.markdown.endsWith('\n\n')) {
							this.add_markdown('\n\n');
						}
						const startLen = this.markdown.length;
						this.add_markdown(childMarkdown);
						child.markdownRange = { start: startLen, end: startLen + childMarkdown.length };
					} catch (error) {
						console.error('[processFile] Error processing PARA child:', error.message, 'token:', child.token);
					}
				}
				this.add_markdown('\n\n');
				break;
			case tokens.NEMETH: {
				const nemethLines = (this.value || '').split('\n');
				if (nemethLines.length > 1) {
					if (this.markdown.length > 0 && !this.markdown.endsWith('\n\n')) {
						this.add_markdown('\n');
					}
					nemethLines.forEach((line) => {
						const md = nemeth_to_latex(line);
						if (md && md.trim() !== '') {
							this.add_markdown('$$' + md + '$$\n');
						}
					});
				} else {
					this.add_markdown('$' + nemeth_to_latex(this.value || '') + '$');
				}
				break;
			}
			case tokens.EQUATION:
				for (const child of this.children) {
					try {
						this.add_markdown(await child.to_markdown(table, translate));
					} catch (error) {
						console.error('[processFile] Error processing EQUATION child:', error.message, 'token:', child.token);
					}
				}
				this.add_markdown('\n\n');
				break;
			case tokens.BOLD:
				this.add_markdown('**');
				if (this.value) this.add_markdown(await this.translate_value(table, translate));
				for (const child of this.children) {
					try {
						this.add_markdown(await child.to_markdown(table, translate));
					} catch (error) {
						console.error('[processFile] Error processing BOLD child:', error.message, 'token:', child.token);
					}
				}
				this.add_markdown('**');
				break;
			case tokens.ITALIC:
				this.add_markdown('*');
				if (this.value) this.add_markdown(await this.translate_value(table, translate));
				for (const child of this.children) {
					try {
						this.add_markdown(await child.to_markdown(table, translate));
					} catch (error) {
						console.error('[processFile] Error processing ITALIC child:', error.message, 'token:', child.token);
					}
				}
				this.add_markdown('*');
				break;
			case tokens.STRING:
				if (this.value) this.add_markdown(await this.translate_value(table, translate));
				break;
			default:
				console.info('Unknown token: ' + this.token);
		}
		return this.get_markdown();
	}
}

// Top-level (ROOT-child) node ranges only — the granularity DualDocument's
// paragraph/equation-level sync operates at. paragraphs[i] is an exact contiguous
// substring of normalizedText (split('\n\n') loses nothing at this level, unlike
// the word-rejoining lower in the tree), so these offsets are exact, not
// approximate.
function assignTopLevelBrailleRanges(root, normalizedText) {
	const paragraphs = normalizedText.split('\n\n');
	let cursor = 0;
	paragraphs.forEach((para, i) => {
		const node = root.children[i];
		if (node) {
			node.brailleRange = { start: cursor, end: cursor + para.length };
		}
		cursor += para.length + 2; // '\n\n' separator
	});
}

// Maps each of the four structural markers lex() recognizes to the span type it
// opens — 'nemeth'/'bold'/'italic' spans nest (a NEMETH, BOLD, or ITALIC region
// can contain any of the others); plain content between/outside them is 'text'.
const SPAN_TYPE_FOR_MARKER = {
	[tokenStrings[tokens.BOLD]]: 'bold',
	[tokenStrings[tokens.ITALIC]]: 'italic'
};

// A lightweight, marker-only scan of one paragraph's raw braille text, computing
// the top-level (direct-PARA-child) span boundaries a correctly-formed input
// would produce, WITHOUT re-running lex()'s word-splitting/character-loop logic.
// Returns an ordered, gapless, non-overlapping partition of [0, rawParaText.length):
// [{ type: 'text'|'nemeth'|'bold'|'italic', start, end }, ...].
//
// This mirrors lex()'s marker push/pop rules (verified by hand against the word-
// and character-based branches there) closely enough to get well-formed input
// right, but it is deliberately NOT a full reimplementation of the lexer (e.g. it
// doesn't replicate every pre-existing lexer quirk around markers landing mid-word
// with no surrounding space). That's fine: assignParaChildBrailleRanges() below
// cross-checks this scan's output against the real parse tree and discards it on
// any mismatch, so a wrong guess here only costs the fast path for that one
// paragraph — see braille2latex#19.
function computeTopLevelBrailleSpans(rawParaText) {
	const spans = [];
	const stack = []; // entries: 'nemeth' | 'bold' | 'italic', innermost last
	let spanStart = 0;
	let spanType = null; // null until the first character of the current span decides it

	const closeSpanIfOpen = (end) => {
		if (spanType !== null && end > spanStart) {
			spans.push({ type: spanType, start: spanStart, end });
		}
		spanType = null;
	};

	let i = 0;
	while (i < rawParaText.length) {
		const two = rawParaText.substring(i, i + 2);

		if (two === tokenStrings[tokens.NEMETHSTART]) {
			if (stack.length === 0) {
				closeSpanIfOpen(i);
				spanStart = i;
				spanType = 'nemeth';
			}
			stack.push('nemeth'); // always pushes, even nested inside another NEMETH
			i += 2;
			continue;
		}

		if (two === tokenStrings[tokens.NEMETHSTOP]) {
			if (stack[stack.length - 1] === 'nemeth') stack.pop(); // else: stray marker, no-op
			i += 2;
			if (stack.length === 0) closeSpanIfOpen(i);
			continue;
		}

		const markerType = SPAN_TYPE_FOR_MARKER[two];
		if (markerType) {
			if (stack.length === 0) {
				closeSpanIfOpen(i);
				spanStart = i;
				spanType = markerType;
			}
			// Toggle relative to the *immediate* top of stack only, matching lex()'s
			// `currentToken.token === BOLD ? parent : push(BOLD)` (not a deep search).
			if (stack[stack.length - 1] === markerType) {
				stack.pop();
			} else {
				stack.push(markerType);
			}
			i += 2;
			if (stack.length === 0) closeSpanIfOpen(i);
			continue;
		}

		// Plain character — starts a new top-level 'text' span if one isn't already open.
		if (stack.length === 0 && spanType === null) {
			spanStart = i;
			spanType = 'text';
		}
		i += 1;
	}
	closeSpanIfOpen(rawParaText.length);

	return spans;
}

const TOKEN_FOR_SPAN_TYPE = {
	text: tokens.STRING,
	nemeth: tokens.NEMETH,
	bold: tokens.BOLD,
	italic: tokens.ITALIC
};

// Runs computeTopLevelBrailleSpans() and cross-checks it against paraNode's real
// children (count + token-type-in-order) before trusting it for anything. On a
// match, stamps each child's brailleRange from the scan and marks the node
// childRangesReliable; on any mismatch, leaves children's brailleRange untouched
// (null) and childRangesReliable false, so applyLatexEdit's PARA branch falls back
// to regenerating the whole node rather than guessing at a wrong splice point.
function assignParaChildBrailleRanges(paraNode, paraRawText) {
	const spans = computeTopLevelBrailleSpans(paraRawText);
	const children = paraNode.children;

	const matches =
		children.length > 0 &&
		spans.length === children.length &&
		spans.every((span, i) => TOKEN_FOR_SPAN_TYPE[span.type] === children[i].token);

	if (!matches) {
		paraNode.childRangesReliable = false;
		return;
	}

	spans.forEach((span, i) => {
		children[i].brailleRange = { start: span.start, end: span.end };
	});
	paraNode.childRangesReliable = true;
}

export function lex(text) {
	if (typeof text !== 'string') throw new Error('Input must be a string');

	text = text.replace(/(\r\n|\n|\r)/g, '\n');
	elementIdCounter = 0;

	const parseTree = new Element(tokens.ROOT);

	const paragraphs = text.split('\n\n');
	paragraphs.forEach(para => {
		const paraNode = parseTree.push(tokens.PARA);
		let currentToken = paraNode;

		const lines = para.split('\n');
		lines.forEach((line, lineIndex) => {
			// For NEMETH content, don't split by spaces - preserve them
			if (currentToken.token === tokens.NEMETH) {
				for (let i = 0; i < line.length; i++) {
					const firsttwo = line.substring(i, i + 2);
					switch (firsttwo) {
						case tokenStrings.NEMETHSTART:
							currentToken = currentToken.push(tokens.NEMETH);
							i++;
							continue;
						case tokenStrings.NEMETHSTOP:
							if (currentToken.token === tokens.NEMETH) currentToken = currentToken.parent;
							i++;
							continue;
						case tokenStrings.BOLD:
							if (currentToken.token === tokens.BOLD) currentToken = currentToken.parent;
							else currentToken = currentToken.push(tokens.BOLD);
							i++;
							continue;
						case tokenStrings.ITALIC:
							if (currentToken.token === tokens.ITALIC) currentToken = currentToken.parent;
							else currentToken = currentToken.push(tokens.ITALIC);
							i++;
							continue;
						default:
							currentToken.add_character(line[i]);
					}
				}
			} else {
				// For non-NEMETH content, use word-based processing
				const words = line.split(' ').filter(Boolean);
				words.forEach((word) => {
					if (!word) return;

					let needsStringToken = false;
					if (currentToken.token === tokens.PARA) {
						const firsttwo = word.substring(0, 2);
						if (
							firsttwo !== tokenStrings.NEMETHSTART &&
							firsttwo !== tokenStrings.NEMETHSTOP &&
							firsttwo !== tokenStrings.BOLD &&
							firsttwo !== tokenStrings.ITALIC
						) {
							needsStringToken = true;
							// Only create a new STRING token if we're not already in one
							if (currentToken.token !== tokens.STRING) {
								currentToken = currentToken.push(tokens.STRING);
							}
						}
					}

					for (let i = 0; i < word.length; i++) {
						const firsttwo = word.substring(i, i + 2);
						switch (firsttwo) {
							case tokenStrings.NEMETHSTART:
							// Close STRING token if we're in one
							if (currentToken.token === tokens.STRING) {
								currentToken = currentToken.parent;
							}
								currentToken = currentToken.push(tokens.NEMETH);
								i++;
								continue;
							case tokenStrings.NEMETHSTOP:
								// A NEMETH block opened mid-word/mid-line (via NEMETHSTART above) closes here 
								if (currentToken.token === tokens.NEMETH) currentToken = currentToken.parent;
								i++;
								continue;
							case tokenStrings.BOLD:
								if (currentToken.token === tokens.BOLD) currentToken = currentToken.parent;
								else currentToken = currentToken.push(tokens.BOLD);
								i++;
								continue;
							case tokenStrings.ITALIC:
								if (currentToken.token === tokens.ITALIC) currentToken = currentToken.parent;
								else currentToken = currentToken.push(tokens.ITALIC);
								i++;
								continue;
							default:
								currentToken.add_character(word[i]);
						}
					}

					if (needsStringToken && currentToken.token === tokens.STRING) {
						if (currentToken.get_value().endsWith(' ')) {
							currentToken.value = currentToken.value.slice(0, -1);
						}
						// Don't close the STRING token yet - keep it open for consecutive words
						// currentToken = currentToken.parent;
					}

					if (
						currentToken.token === tokens.STRING ||
						currentToken.token === tokens.NEMETH ||
						currentToken.token === tokens.BOLD ||
						currentToken.token === tokens.ITALIC
					) {
						currentToken.add_character(' ');
					}
				});

				if (currentToken.get_value && currentToken.get_value().endsWith(' ')) {
					currentToken.value = currentToken.value.slice(0, -1);
				}
			}
			
			// A single '\n' inside a paragraph is a line wrap, not a paragraph break
			// (that's '\n\n', split out above) -- it still stands for whitespace between
			// the last word of this line and the first word of the next, or the last
			// word of one line and the last word of the next line fuse together with
			// no separator at all. NEMETH content preserves the literal newline instead
			// (verbatim rendering of Nemeth math); everything else gets a space.
			if (lineIndex < lines.length - 1) {
				if (currentToken.token === tokens.NEMETH) {
					currentToken.add_character('\n');
				} else if (
					currentToken.token === tokens.STRING ||
					currentToken.token === tokens.BOLD ||
					currentToken.token === tokens.ITALIC
				) {
					currentToken.add_character(' ');
				}
			}
		});

		paraNode.check_for_equation();
		assignParaChildBrailleRanges(paraNode, para);
	});

	assignTopLevelBrailleRanges(parseTree, text);
	parseTree.sourceText = text; // normalized (\n-only) — ranges above are relative to this, not the raw input

	return parseTree;
}

// --- Markdown import (Markdown -> Element tree) -----------------------
//
// The reverse direction of to_markdown(): builds the same tree shape lex()
// produces, but starting from Markdown source instead of NABCC braille text.
// Unlike lex() (pure structural parsing -- the input is already braille, so
// no translation happens until to_latex()/to_markdown() is called later),
// this function actively forward-translates print text to braille-ASCII
// while parsing, since Markdown is print text, not braille.

// Same $...$/$$...$$ math delimiters segmentMixedLatex()/extractMathBody()
// in document.js already recognize for LaTeX -- Pandoc's default Markdown
// math extension uses identical syntax, so braille-bridge speaks one math
// delimiter dialect across both target formats.
const MARKDOWN_MATH_RE = /\$\$([\s\S]*?)\$\$|\$([^$\n]*)\$/g;

// Bold/italic: **bold** / *italic*, the CommonMark/Pandoc-default emphasis
// markers to_markdown() emits and this function expects back. Underscore
// style (__bold__/_italic_) is intentionally not recognized here -- it falls
// through to plain forward-translated text like any other unrecognized
// construct, per the "never strip, just translate directly" policy below.
// Known limitation, not attempted here: real CommonMark emphasis "flanking"
// rules (to correctly tell `3 * 4 and 5 * 6` apart from actual italics) --
// this uses a simpler greedy-earliest-match heuristic instead.
const MARKDOWN_BOLD_RE = /\*\*([\s\S]+?)\*\*/;
const MARKDOWN_ITALIC_RE = /\*([^*\n]+)\*/;

// Block-level constructs this parser doesn't model structurally: headings,
// lists, blockquotes, code fences/indented code, tables, horizontal rules,
// footnote definitions. A whole paragraph matching one of these shapes isn't
// segmented into bold/italic/math spans -- per the "never strip, translate
// directly" decision, it's forward-translated as one literal run instead,
// and flagged (see flagUnsupported()) so the sync-issues UI surfaces it
// rather than the user losing track of what happened to that paragraph. A
// deliberately coarse heuristic, not a full block-structure parser: good
// enough for the common shapes Pandoc emits converting a real Word/LaTeX
// document, not a guarantee of catching every case.
const MARKDOWN_UNSUPPORTED_BLOCK_RE =
	/^(#{1,6}\s|>|```|~~~|\s{4}\S|[-*+]\s|\d+\.\s|\|.*\|\s*$|-{3,}\s*$|\[\^[^\]]+\]:)/m;

/**
 * Splits one paragraph's raw Markdown text into an ordered list of
 * { type: 'text'|'bold'|'italic'|'math', text } segments -- mirrors
 * segmentMixedLatex() in document.js, but for Markdown's emphasis/math
 * syntax instead of \textbf{}/\textit{}/LaTeX math. Only ever called on
 * paragraphs that already passed the MARKDOWN_UNSUPPORTED_BLOCK_RE check.
 */
function segmentMarkdown(paraText) {
	const segments = [];
	let rest = paraText;
	while (rest.length > 0) {
		MARKDOWN_MATH_RE.lastIndex = 0;
		const mathMatch = MARKDOWN_MATH_RE.exec(rest);
		const boldMatch = MARKDOWN_BOLD_RE.exec(rest);
		const italicMatch = MARKDOWN_ITALIC_RE.exec(rest);

		// Pick whichever recognized span starts earliest. This also resolves the
		// bold-vs-italic ambiguity for e.g. "**bold**": MARKDOWN_ITALIC_RE can
		// match starting one character later (using the second '*' as its own
		// opening delimiter), but the earlier-starting bold match always wins.
		const candidates = [
			mathMatch && { type: 'math', match: mathMatch },
			boldMatch && { type: 'bold', match: boldMatch },
			italicMatch && { type: 'italic', match: italicMatch }
		].filter(Boolean);

		if (candidates.length === 0) {
			segments.push({ type: 'text', text: rest });
			break;
		}

		candidates.sort((a, b) => a.match.index - b.match.index);
		const { type, match } = candidates[0];

		if (match.index > 0) {
			segments.push({ type: 'text', text: rest.slice(0, match.index) });
		}
		const body = type === 'math' ? (match[1] !== undefined ? match[1] : match[2]) : match[1];
		segments.push({ type, text: body });
		rest = rest.slice(match.index + match[0].length);
	}
	return segments;
}

// Flags a top-level node as needing attention without clobbering an earlier
// flag from the same paragraph (first message wins). Errors/status are
// tracked at top-level-node granularity throughout this package (see
// document.js's module doc comment) -- a paragraph with e.g. two
// unparseable math spans still surfaces as one sync issue, not two.
function flagUnsupported(topLevelNode, message) {
	if (topLevelNode.status === 'unsupported' || topLevelNode.status === 'error') return;
	topLevelNode.status = 'unsupported';
	topLevelNode.errorPane = 'markdown';
	topLevelNode.errorMessage = message;
}

// Builds one PARA Element's children (STRING/BOLD/ITALIC/NEMETH, or a single
// flagged literal child for unrecognized block-level markdown) from one
// blank-line-separated chunk of Markdown source.
async function buildParaFromMarkdown(paraNode, paraSource, table, forward) {
	if (MARKDOWN_UNSUPPORTED_BLOCK_RE.test(paraSource)) {
		const child = paraNode.push(tokens.STRING);
		child.set_value(await forward(paraSource, table));
		flagUnsupported(
			paraNode,
			"This paragraph uses Markdown syntax braille-bridge doesn't parse (e.g. a heading, list, table, or code block) — shown as plain translated text rather than being lost."
		);
		return;
	}

	for (const segment of segmentMarkdown(paraSource)) {
		const text = segment.text;
		if (segment.type === 'text') {
			if (text.trim() === '') continue;
			const child = paraNode.push(tokens.STRING);
			child.set_value(await forward(text, table));
		} else if (segment.type === 'bold' || segment.type === 'italic') {
			const child = paraNode.push(segment.type === 'bold' ? tokens.BOLD : tokens.ITALIC);
			child.set_value(await forward(text, table));
		} else if (segment.type === 'math') {
			const child = paraNode.push(tokens.NEMETH);
			try {
				child.set_value(latex_to_nemeth(text));
			} catch (error) {
				// Invalid/unbalanced math -- same "surface, don't corrupt" policy as
				// the rest of this parser: fall back to translating the raw source
				// (delimiters included) as plain text, flagged for the user.
				child.token = tokens.STRING;
				child.set_value(await forward('$' + text + '$', table));
				flagUnsupported(paraNode, `Couldn't parse this as math (${error.message}) — shown as plain translated text.`);
			}
		}
	}
}

// Reconstructs the flat, marker-based braille text (the same shape lex()
// parses -- NEMETHSTART/STOP, BOLD, and ITALIC toggle markers inline) for a
// PARA/EQUATION node from its already-translated children. The inverse of
// lex()'s per-word marker scanning, operating on whole children instead.
function brailleTextOf(node) {
	switch (node.token) {
		case tokens.PARA:
		case tokens.EQUATION:
			return node.children.map(brailleTextOf).join('');
		case tokens.NEMETH:
			return tokenStrings[tokens.NEMETHSTART] + node.get_value() + tokenStrings[tokens.NEMETHSTOP];
		case tokens.BOLD:
			return tokenStrings[tokens.BOLD] + node.get_value() + tokenStrings[tokens.BOLD];
		case tokens.ITALIC:
			return tokenStrings[tokens.ITALIC] + node.get_value() + tokenStrings[tokens.ITALIC];
		case tokens.STRING:
		default:
			return node.get_value();
	}
}

/**
 * Parses Markdown source into the same Element tree shape lex() builds from
 * braille, forward-translating recognized prose/bold/italic/math into
 * braille-ASCII as it goes (braille is still ground truth -- see the
 * webeditor plan's "Round-trip fidelity" notes for why, and what's
 * deliberately not built yet). Any construct this parser doesn't recognize
 * is never dropped: its raw source is forward-translated like ordinary
 * prose and the enclosing top-level node is flagged via `status`/
 * `errorPane`/`errorMessage` (same shape DualDocument.errors already reads).
 *
 * @param {string} text
 * @param {{ table?: string, translateForward?: (text: string, table: string) => Promise<string> }} [options]
 */
export async function fromMarkdown(text, { table = defaultTable, translateForward: forward } = {}) {
	if (typeof text !== 'string') throw new Error('Input must be a string');
	const translateFwd = forward || defaultLiblouisTranslateForward;

	const normalized = text.replace(/(\r\n|\n|\r)/g, '\n');
	elementIdCounter = 0;

	const parseTree = new Element(tokens.ROOT);
	// Markdown source commonly has runs of 2+ blank lines between blocks --
	// split on any such run, unlike lex()'s exact '\n\n' split (braille
	// paragraphs are always exactly '\n\n'-separated by construction; Markdown
	// source isn't).
	const chunks = normalized.split(/\n{2,}/).filter((chunk) => chunk.trim() !== '');

	for (const paraSource of chunks) {
		const paraNode = parseTree.push(tokens.PARA);
		paraNode.importedSource = paraSource;
		await buildParaFromMarkdown(paraNode, paraSource, table, translateFwd);
		paraNode.check_for_equation();
	}

	// Braille is ground truth: derive sourceText/brailleRange the same way
	// lex()/assignTopLevelBrailleRanges() do, from each top-level node's own
	// (already-translated) content.
	const brailleParas = parseTree.children.map(brailleTextOf);
	parseTree.sourceText = brailleParas.join('\n\n');
	let cursor = 0;
	parseTree.children.forEach((node, i) => {
		const para = brailleParas[i];
		node.brailleRange = { start: cursor, end: cursor + para.length };
		cursor += para.length + 2; // '\n\n' separator
	});

	return parseTree;
}
