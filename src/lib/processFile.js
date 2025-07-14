import { nemeth_to_latex } from './brailleMap'; // import the ASCII to Braille mapping function

const tokens = {
	NEMETHSTART: 'NEMETHSTART',
	NEMETHSTOP: 'NEMETHSTOP',
	BOLD: 'BOLD',
	ITALIC: 'ITALIC',
	STRING: 'STRING',
	NEWPARA: 'NEWPARA'
}
const tokenStrings = {
	[tokens.NEMETHSTART]: '_%',
	[tokens.NEMETHSTOP]: '_:',
	[tokens.BOLD]: '_.',
	[tokens.ITALIC]: '_/',
	[tokens.NEWPARA]: '\n\n'
}

const state = {
	PARA: 'PARA',
	NEMETH: 'NEMETH',
	EQUATION: 'EQUATION',
	UNKNOWN: 'UNKNOWN',
	BOLDSTART: 'BOLDSTART',
	BOLDEND: 'BOLDEND',
	ITALICSTART: 'ITALICSTART',
	ITALICEND: 'ITALICEND',
}

/**
 * First we have to break the text up into tokens ('lexing')
 */

export function parse(text) {
	if (typeof text !== 'string') {
		throw new Error('Input must be a string');
	}

	let result = '';

	// Use the lex function to break the text into tokens
	const tokensList = lex(text);
	console.log("[" + tokensList.map(i => i['token'] + ":" + i['data']).join() + "]");

	// Now we can process the tokens to convert them to LaTeX
	let status = [];
	let nextToken;

	while (true) {
		nextToken = tokensList.pop();
		if (nextToken === undefined) break;

		switch (nextToken['token']) {
			// if there is a newline
			case tokens.NEWPARA:
				status.push(state.PARA);
				break;
			case tokens.NEMETHSTART:
				// if a new paragraph starts with math, treat it as an equation
				if (status[status.length - 1] === state.PARA) {
					status.pop();
					status.push(state.EQUATION);
					result += "$$";
					// otherwise treat it as inline math
				} else {
					status.push(state.NEMETH)
					result += "$"
				}
				break;
			case tokens.NEMETHSTOP:
				if (status.includes(state.EQUATION)) {
					result += "$$\n\n";
					status.filter(s => s != state.EQUATION)
				} else {
					result += "$"
				}
				console.log("end nemeth" + status.pop());
				break;
			case tokens.BOLD:
				if (status.includes(state.BOLDSTART)) {
					result += "}";
					status.filter(s => s != state.BOLDSTART)
					break;
				} else {
					result += "\\textbf{"
					status.push(state.BOLDSTART);
					break;
				}
			case tokens.ITALIC:
				if (status.includes(state.ITALICSTART)) {
					result += "}";
					status.filter(s => s != state.ITALICSTART)
					break;
				} else {
					result += "\\textit{"
					status.push(state.ITALICSTART);
					break;
				}
			case tokens.STRING:
				switch (status[status.length - 1]) {
					case state.NEMETH:
						result += nemeth_to_latex(nextToken['data']);
						break;
					case state.EQUATION:
						result += nemeth_to_latex(nextToken['data']);
						break;
					case state.PARA:
						result += nextToken['data'];
						result += "\n\n";
						break;
					default:
						result += nextToken['data'];
				}
		}
	}
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

	// array to hold list of token type and data 
	const tokensList = [];

	// Initialize current token and token found
	// currentToken is used to build up strings between tokens
	let currentToken = '';

	// tokenFound is used to track the current token found
	// It will be reset after each token is processed
	let tokenFound = '';

	console.log(text);
	// remove unimportant whitespace
	// This will replace multiple spaces with a single space
	// and trim leading/trailing whitespace
	text = text.replace(/' '+/g, ' ').trim();

	// Normalize newlines and remove whitespace around them
	text = text.replace(/(\r\n|\n|\r)/g, '\n'); // Normalize newlines to \n
	text = text.replace(/\n' '+/g, '\n'); // Remove whitespace after newlines
	text = text.replace(/' '+\n/g, '\n'); // Remove whitespace before newlines

	console.log(text);
	// Iterate through the text character by character
	// Check for special characters (tokens)
	for (let i = 0; i < text.length - 1; i++) {
		const char = text[i];
		const nextchar = text[i + 1];

		// Iterate through the tokens dictionary to find matches
		for (let token in tokens) {
			// Ignore the STRING token, that should only be used
			// if we find a token toatore what came before it. 
			if (token === tokens.STRING) {
				continue;
				// Check if the current character or the next character matches the token value
			} else if (token === tokens.NEWPARA) {
				if (char === '\n') {
					if (nextchar === '\n') {
						tokensList.push({ 'token': tokens.NEWPARA, 'data': "" });
					}
				}
			} else if (char === tokenStrings[token]) {
				// If we have a match, and had been
				// collecting a string before that, push the 
				// current string token
				// and reset the current token
				if (currentToken !== '') {
					tokensList.push({ 'token': tokens.STRING, 'data': currentToken });
					currentToken = '';
				}

				// store the token found
				tokenFound = token;
				break;
			} else if (char + nextchar === tokenStrings[token]) {
				if (currentToken !== '') {
					console.log("pushing string")
					tokensList.push({ 'token': tokens.STRING, 'data': currentToken });
					currentToken = '';
				}
				tokenFound = token;
				i++;
				break;
			}
		}

		if (tokenFound === '') {
			// If no token found, continue building the current token
			currentToken += char;
		} else {
			// Push the token found
			tokensList.push({ token: tokenFound, data: '' });
			tokenFound = ''; // Reset current token
		}
	}

	return tokensList.reverse();
}