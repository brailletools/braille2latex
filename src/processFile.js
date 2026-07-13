// @ts-nocheck
import { nemeth_to_latex, ascii2Braille } from './brailleMap.js';

let asyncLiblouis = null;
let liblouisReadyPromise = null;

/**
 * Configure the liblouis backend. Must be called before parse().
 *
 * Expects `globalThis.LiblouisEasyApiAsync` to already be available — load the
 * vendored easy-api.js (fetched at build time by @brailletools/liblouis-env-web's
 * `liblouis-fetch-web`) via a plain <script> tag in your app's HTML template
 * before calling configure(). braille2latex doesn't fetch or inject that script
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
 *   import { configure } from '@brailletools/braille2latex';
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
				'[braille2latex] configure() needs `LiblouisEasyApiAsync` to already be available as a ' +
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
 * rejects if setup failed). parse() already awaits this internally before
 * translating — this is exposed separately for callers that want to gate UI
 * state (e.g. a loading indicator) on readiness without triggering a parse.
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
// configured via configure(). Callers with a different backend (e.g. the CLI's
// lou_translate binary) pass their own translate function to to_latex()/parseWithTranslator().
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
		// Offsets into the braille source / generated LaTeX string. Only populated
		// for top-level (ROOT-child) nodes — see assignTopLevelBrailleRanges() and
		// the ROOT case of to_latex().
		this.brailleRange = null;
		this.latexRange = null;
		this.reset_latex();
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
		// defaults to the liblouis WASM backend used by configure()/parse().
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
						this.add_latex(childLatex);
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
}

export async function parse(text, table = defaultTable) {
	if (typeof text !== 'string') throw new Error('Input must be a string');
	if (!liblouisReadyPromise) throw new Error('Call configure() before parse()');

	await liblouisReadyPromise;
        const parseTree = lex(text);
	return await parseTree.to_latex(table);
}

/**
 * Like parse(), but for callers supplying their own back-translation backend
 * instead of the liblouis WASM Easy API (e.g. the CLI, which shells out to
 * lou_translate). Does not require configure() to have been called.
 *
 * @param {string} text
 * @param {string} table - liblouis table name
 * @param {(unicodeBraille: string, table: string) => Promise<string>} translate
 */
export async function parseWithTranslator(text, table = defaultTable, translate) {
	if (typeof text !== 'string') throw new Error('Input must be a string');
	if (typeof translate !== 'function') throw new Error('parseWithTranslator requires a translate(unicodeBraille, table) function');

	const parseTree = lex(text);
	return await parseTree.to_latex(table, translate);
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

					if (word.length === 1) {
						switch (currentToken.token) {
							case tokens.NEMETH:
							case tokens.BOLD:
							case tokens.ITALIC:
								currentToken.add_character(word);
								return;
							default:
								{
									const stringToken = currentToken.push(tokens.STRING);
									stringToken.add_character(word);
									stringToken.add_character(' ');
								}
								return;
						}
					}

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
			
			// Add newline after each line within NEMETH blocks (but not after last line)
			if (lineIndex < lines.length - 1 && currentToken.token === tokens.NEMETH) {
				currentToken.add_character('\n');
			}
		});

		paraNode.check_for_equation();
	});

	assignTopLevelBrailleRanges(parseTree, text);
	parseTree.sourceText = text; // normalized (\n-only) — ranges above are relative to this, not the raw input

	return parseTree;
}
