import { nemeth_to_latex, ascii2Braille } from './brailleMap'; // import the ASCII to Braille mapping function
import liblouis from 'liblouis/easy-api';

import { assets } from '$app/paths';

// includes the following tables: unicode.dis, en-ueb-g2.ctb, en-ueb-g1.ctb, en-ueb-chardefs.uti, latinLetterDef8Dots.uti, en-ueb-math.ctb, braille-patterns.cti
const capi_url = assets + 'liblouis/build-tables-embeded-root-utf16.js';
const easyapi_url = assets + 'liblouis/easy-api.js'
console.info(liblouis);

console.info(capi_url);
console.info(easyapi_url);
//console.info(liblouis)

const asyncLiblouis = new liblouis.EasyApiAsync({
	capi: capi_url,
	easyapi: easyapi_url
});
asyncLiblouis.setLogLevel(0);

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
}

const tokenStrings = {
	[tokens.NEMETHSTART]: '_%',
	[tokens.NEMETHSTOP]: '_:',
	[tokens.BOLD]: '_.',
	[tokens.ITALIC]: '_/',
}
class Element {
	constructor(token, parent = null) {
		this.token = token; // a type is always needed
		this.value; // The data stored in the node
		this.children = []; // An array to hold references to child nodes
		this.parent = parent; // A reference to the parent node, if any
	}

	/**
	 * Add a new child element with the given token to this element
	 * @param {*} token 
	 * @returns the new element
	 */
	push(token) {
		this.children.push(new Element(token, this));
		return this.children[this.children.length - 1];
	}

	/**
	 * Add a character to the value of this element
	 * @param {*} char 
	 */
	add_character(char) {
		if (this.value === undefined) this.value = '';
		this.value += char;
	}

	/**
	 * Update the value of this element
	 * @param {*} value 
	 */
	set_value(value) {
		this.value = value;
	}

	/**
	 * 
	 * @returns the value of this element
	 */
	get_value() {
		return this.value || '';
	}

	/**
	 * 
	 * @returns the value of this element
	 */
	get_unicode_value() {
		if (!this.value) return '';
		return ascii2Braille(this.value) || '';
	}


	/**
	 * 
	 * @returns the token of this element
	 */
	get_token() {
		return this.token;
	}

	/**
	 * If the current element is a PARA and its only child is a NEMETH, change this to an EQUATION
	 */
	check_for_equation() {
		// if the current element is a PARA and its first child is a NEMETH, change it to an EQUATION
		if (this.token == tokens.PARA && this.children.length == 1) {
			if (this.children[0].token == tokens.NEMETH) {
				this.token = 'EQUATION';
			}
		}
	}

	/**
	 * Prints the parse tree to the console for debugging
	 * @param {*} indent 
	 */
	print(indent = 0) {
		console.info(' '.repeat(indent) + this.token + ":" + this.get_unicode_value() + ":");
		this.children.forEach(child => child.print(indent + 2));
	}


	to_latex() {
		let latex = '';
		switch (this.token) {
			case tokens.ROOT:
				console.info("ROOT");
				this.children.forEach(child => {
					latex += child.to_latex();
				});
				break;
			case tokens.PARA:
				console.info("PARA");
				this.children.forEach(child => {
					latex += child.to_latex();
				});
				latex += '\n\n'; // paragraphs are separated by double newlines
				break;
			case tokens.NEMETH:
				console.info("NEMETH");
				latex += '$';
				latex += nemeth_to_latex(this.value);
				latex += '$';
				break;
			case tokens.EQUATION:
				console.info("EQUATION");
				latex += '$';
				this.children.forEach(child => {
					latex += child.to_latex();
				});
				latex += '$\n\n'; // equations are separated by double newlines
				break;
			case tokens.BOLD:
				console.info("BOLD");
				latex += '\\textbf{';
				this.children.forEach(child => {
					latex += child.to_latex();
				});
				latex += '}';
				break;
			case tokens.ITALIC:
				console.info("ITALIC");
				latex += '\\textit{';
				this.children.forEach(child => {
					latex += child.to_latex();
				});
				latex += '}';
				break;
			case tokens.STRING:
				console.info("STRING");
				// if there is a value, translate it using liblouis
				// otherwise, just return an empty string
				if (this.value) {
					let asciiString = '';
					asyncLiblouis.backTranslateString(
						'en-ueb-g2.ctb',
						this.get_value(),
						e => {
							console.info("liblouis: translating to: " + e);
							asciiString = e;
						});
					latex += asciiString;
				}
				break;
			default:
				console.info("Unknown token: " + this.token);
		}
		return latex;
	}
}

/**
 * First we have to break the text up into tokens ('lexing')
 */

export function parse(text) {
	if (typeof text !== 'string') {
		throw new Error('Input must be a string');
	}
	console.info("parsing text: ");

	// Use the lex function to break the text into tokens
	const parseTree = lex(text);
	console.info("tokens list: ");
	parseTree.print();
	// Now we can generate the LaTeX from the parse tree
	let result = parseTree.to_latex();
	console.info("generated latex: ");
	console.info(result);

	return result;
}

/**
 * 
 * @param {*} text 
 * @returns  a list of tokens and strings found between tokens.
 */
function lex(text) {
	// This function breaks the text into tokens based on whitespace and special characters
	if (typeof text !== 'string') {
		throw new Error('Input must be a string');
	}

	console.info(text);

	// Normalize newlines and remove whitespace around them
	text = text.replace(/(\r\n|\n|\r)/g, '\n'); // Normalize newlines to \n
	text = text.split('\n').map(line => line.trim()).join('\n');
	console.info("removed excess whitespace and newlines: ")
	let escapedText = text.replace(/\n/g, "\\n");
	console.info(escapedText);

	// array to hold list of token type and data 
	const parseTree = new Element(tokens.ROOT);
	let currentToken = parseTree;

	// Iterate through the text character by character
	// Check for special characters (tokens)
	let paragraphs = text.split('\n\n'); // split on double newlines
	console.info("found " + paragraphs.length + " paragraphs");
	paragraphs.forEach(para => {
		console.log("new para");
		currentToken.check_for_equation();
		currentToken = parseTree.push(tokens.PARA);

		let lines = para.split('\n');
		lines.forEach(line => {
			console.log("new line");
			// split the line into words
			let words = line.split(' ');
			words.forEach(word => {
				console.info("new word: " + word);
				// iterate through the characters in the word
				// up to the second to last character
				// so we can check for two-character tokens
				if (word.length == 0) return; // skip empty words
				if (word.length == 1) {
					switch (currentToken.token) {
						case tokens.NEMETH:
						case tokens.BOLD:
						case tokens.ITALIC:
							// if we are in a special mode, just add the character
							console.info("adding single char to: " + currentToken.get_token() + ": " + word[0]);
							currentToken.add_character(word[0]);
							return;
					}
					// if we are not in a special mode, create a new STRING token
					let stringToken = currentToken.push(tokens.STRING);
					// if the word is a single character, just add it
					console.log("adding single char to: " + stringToken.get_token() + ": " + word[0]);
					stringToken.add_character(word[0]);
					return;
				}
				// otherwise, iterate through the characters
				// looking for tokens

				for (let i = 0; i < word.length - 1; i++) {
					// extract the first two characters
					const firsttwo = word.substring(i, i + 2);
					console.info("checking: " + firsttwo);
					// check if the first two characters match any token
					switch (firsttwo) {
						case tokenStrings.NEMETHSTART:
							console.log("nemeth start");
							currentToken = currentToken.push(tokens.NEMETH);
							i++; // skip the next character
							continue;
						case tokenStrings.NEMETHSTOP:
							console.log("nemeth stop");
							// if we are in a NEMETH section, close it
							// otherwise, this is an error
							if (currentToken.token == tokens.NEMETH) {
								currentToken = currentToken.parent;
							} else {
								console.log("Error: unmatched NEMETHSTOP token");
							}
							i++; // skip the next character
							continue;
						case tokenStrings.BOLD:
							console.log("bold");
							if (currentToken.token == tokens.BOLD) {
								// if we are already in bold, close it
								currentToken = currentToken.parent;
							} else {
								// otherwise start a new bold section
								currentToken = currentToken.push(tokens.BOLD);
							}
							i++; // skip the next character
							continue;
						case tokenStrings.ITALIC:
							console.log("italic");
							if (currentToken.token == tokens.ITALIC) {
								// if we are already in italic, close it
								currentToken = currentToken.parent;
							} else {
								// otherwise start a new italic section
								currentToken = currentToken.push(tokens.ITALIC);
							}
							i++; // skip the next character
							continue;
						default:
							console.log("adding char to: " + currentToken.get_token() + ": " + word[i]);
							currentToken.add_character(word[i]);
					}

					// add the last character of the word
					if (i == word.length - 2) {
						console.log("adding last char: " + word[i + 1]);
						currentToken.add_character(word[i + 1]);
					}
				}
				// add a space after each word
				currentToken.add_character(' ');
			});
			// remove the last space added
			if (currentToken.get_value().endsWith(' ')) {
				currentToken.value = currentToken.value.slice(0, -1);
			}
		});
	});

	console.log("parse tree: ");
	console.log(parseTree);

	return parseTree;
}