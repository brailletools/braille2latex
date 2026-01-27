import { nemeth_to_latex, ascii2Braille } from './brailleMap';
import liblouis from 'liblouis/easy-api';
import { base } from '$app/paths';

// Use liblouis 3.2.0-rc with tables loaded on demand from static/liblouis/tables
const capi_url = base + 'liblouis/build-no-tables-utf16.js';
const easyapi_url = base + 'liblouis/easy-api.js';
const tables_url = base + 'liblouis/tables/';

const asyncLiblouis = new liblouis.EasyApiAsync({
	capi: capi_url,
	easyapi: easyapi_url
});
asyncLiblouis.setLogLevel(0);

function enableOnDemandTables() {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => reject(new Error('enableOnDemandTableLoading timed out')), 10000);
		asyncLiblouis.enableOnDemandTableLoading(tables_url, () => {
			clearTimeout(timeoutId);
			resolve();
		});
	});
}

function initializeLiblouis() {
	const versionReady = new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => reject(new Error('version() timed out')), 10000);
		asyncLiblouis.version(() => {
			clearTimeout(timeoutId);
			resolve();
		});
	});

	return Promise.all([enableOnDemandTables(), versionReady]);
}

const liblouisReadyPromise = initializeLiblouis().catch(error => {
	console.error('[liblouis] Initialization failed', error);
	throw error;
});

// Default liblouis table for back-translation if caller does not override
const defaultTable = 'en-ueb-g2.ctb';

const tokens = {
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
		this.token = token; // token type stored at this node
		this.value = undefined; // text content for STRING/NEMETH/etc.
		this.children = []; // nested token nodes
		this.parent = parent; // parent node pointer
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

	async to_latex(table = defaultTable) {
		// Walk the tree and build LaTeX using the chosen translation table
		this.reset_latex();
		switch (this.token) {
			case tokens.ROOT:
				for (const child of this.children) {
					try {
						this.add_latex(await child.to_latex(table));
					} catch (error) {
						console.error('[processFile] Error processing ROOT child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				break;
			case tokens.PARA:
				for (const child of this.children) {
					try {
						const childLatex = await child.to_latex(table);
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
			case tokens.NEMETH:
				// Handle multi-line Nemeth blocks as display math
		                const nemethLines = (this.value || '').split('\n');
				if (nemethLines.length > 1) {
					// Multi-line: use display math
					this.add_latex('$$');
					nemethLines.forEach((line, idx) => {
						const latex = nemeth_to_latex(line);
						if (latex) {
							if (idx > 0) this.add_latex('\\\\\n');
							this.add_latex(latex);
						}
					});
					this.add_latex('$$');
				} else {
					// Single line: inline math
					this.add_latex('$' + nemeth_to_latex(this.value || '') + '$');
				}
				break; // inline math from Nemeth
			case tokens.EQUATION:
				// EQUATION contains a single NEMETH child that will add its own $ delimiters
				for (const child of this.children) {
					try {
						this.add_latex(await child.to_latex(table));
					} catch (error) {
						console.error('[processFile] Error processing EQUATION child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				this.add_latex('\n\n');
				break;
			case tokens.BOLD:
				this.add_latex('\\textbf{');
				for (const child of this.children) {
					try {
						this.add_latex(await child.to_latex(table));
					} catch (error) {
						console.error('[processFile] Error processing BOLD child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				this.add_latex('}');
				break;
			case tokens.ITALIC:
				this.add_latex('\\textit{');
				for (const child of this.children) {
					try {
						this.add_latex(await child.to_latex(table));
					} catch (error) {
						console.error('[processFile] Error processing ITALIC child:', error.message, 'token:', child.token);
						// Continue processing remaining children
					}
				}
				this.add_latex('}');
				break;
			case tokens.STRING:
				if (this.value) {
					const stringValue = this.get_value(); 
					
					// Convert ASCII braille to Unicode braille first
					const unicodeBraille = ascii2Braille(stringValue);
					
					// Validate that the conversion was successful
					if (!unicodeBraille || unicodeBraille.length === 0) {
						console.warn('[processFile] Warning: ascii2Braille returned empty string for:', JSON.stringify(stringValue));
						this.add_latex(stringValue); // Fallback to original ASCII string
						break;
					}
					
					let translationResult = stringValue; // default fallback
					try {
						const result = await new Promise((resolve, reject) => {
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
						translationResult = result;
					} catch (error) {
						console.warn('[processFile] Back-translation failed, using fallback:', error.message);
						// translationResult already set to stringValue above
					}
					this.add_latex(translationResult);
				}
				break;
			default:
				console.info('Unknown token: ' + this.token);
		}
		return this.get_latex();
	}
}

export async function parse(text, table = defaultTable) {
	if (typeof text !== 'string') {
		throw new Error('Input must be a string');
	}

	await liblouisReadyPromise;
        const parseTree = lex(text);
	return await parseTree.to_latex(table);
}

function lex(text) {
	if (typeof text !== 'string') throw new Error('Input must be a string');

	text = text.replace(/(\r\n|\n|\r)/g, '\n');
	
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
				words.forEach((word, wordIndex) => {
					if (!word) return;

					if (word.length === 1) {
						switch (currentToken.token) {
							case tokens.NEMETH:
							case tokens.BOLD:
							case tokens.ITALIC:
								currentToken.add_character(word);
								return;
							default:
								const stringToken = currentToken.push(tokens.STRING);
								stringToken.add_character(word);
								stringToken.add_character(' ');
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

	return parseTree;
}
